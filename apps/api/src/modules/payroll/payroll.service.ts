import type { Payslip, PayrollRow, PayrollRun, PayrollStep } from '@dagingpeople/contracts';
import { calculateEmployeePayroll, type EmployeePayrollResult, type MoneyLine } from '@dagingpeople/payroll-engine';
import { canSeeSalary, requireEmployee, requireRole, type Actor } from '../../common/actor';
import { writeAudit } from '../../common/audit';
import type { Clock } from '../../common/clock';
import { DbError, one, type Db } from '../../common/db';
import { conflict, forbidden, locked, notFound, validation } from '../../common/errors';
import { decrypt } from '../../common/security';
import { addDays, localDate, weekday } from '../../common/time';
import { toEmployee } from '../attendance/attendance.service';
import { buildMandiriMcmFile } from './bank-export';
import { buildPayrollInputs, type PeriodRow } from './payroll.inputs';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const periodLabel = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const shortDate = (iso: string) => `${Number(iso.slice(8))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;

/** Periode 26 bulan lalu – 25 bulan ini, dibayar tanggal 28 (keputusan client #3). */
export const PAY_DAY = 28;
export const CUTOFF_DAY = 25;

/** Tanggal bayar jatuh di Minggu/libur → hari kerja sebelumnya (default, menunggu konfirmasi client). */
export const resolvePayDate = (period: string, holidays: ReadonlySet<string>): string => {
  let d = `${period}-${String(PAY_DAY).padStart(2, '0')}`;
  while (weekday(d) === 0 || holidays.has(d)) d = addDays(d, -1);
  return d;
};

export const periodBounds = (period: string) => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return { start: `${prev}-${CUTOFF_DAY + 1}`, end: `${period}-${CUTOFF_DAY}` };
};

const ISSUE_KIND: Record<string, PayrollRow['issue'] extends infer I ? (I extends { kind: infer K } ? K : never) : never> = {
  MISSING_PTKP: 'missing_ptkp',
  MISSING_WAGE: 'missing_wage',
  MISSING_YTD: 'missing_ytd',
  DAILY_WAGE_ABOVE_TER: 'manual_tax',
};

const STEP_ORDER = ['draft', 'attendance_locked', 'calculated', 'hr_review', 'owner_approval', 'approved', 'locked', 'exported'] as const;

type ItemRow = {
  employee_id: string;
  status: 'ok' | 'needs_review';
  result: EmployeePayrollResult;
  input_snapshot: { attendance: { daysPresent: number }; overtime: { hours: number }[] };
  gross_pay: number | null;
  take_home_pay: number | null;
  code: string;
  full_name: string;
  position: string;
  location_id: string;
  location_name: string;
  employment_type: 'PKWTT' | 'PKWT' | 'HARIAN';
  bank_name: string | null;
  casual_months_21: number;
};

export class PayrollService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly dataKey: Buffer,
  ) {}

  private async period(id: string): Promise<PeriodRow & { attendance_locked_at: string | null; submitted_at: string | null; approved_at: string | null; locked_at: string | null; exported_at: string | null }> {
    const row = await one(this.db.query<PeriodRow & { attendance_locked_at: string | null; submitted_at: string | null; approved_at: string | null; locked_at: string | null; exported_at: string | null }>(
      `SELECT id, legal_entity_id, period, start_date, end_date, pay_date, status,
              to_char(attendance_locked_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS attendance_locked_at,
              to_char(submitted_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS submitted_at,
              to_char(approved_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS approved_at,
              to_char(locked_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS locked_at,
              to_char(exported_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS exported_at
         FROM payroll_period WHERE id = $1`,
      [id],
    ));
    if (!row) throw notFound('PERIOD_NOT_FOUND', 'Periode payroll tidak ditemukan.');
    return row;
  }

  /** Membuat periode bila belum ada (id = <entitas>-<YYYY-MM>). */
  async ensurePeriod(actor: Actor, legalEntityId: string, period: string): Promise<string> {
    requireRole(actor, 'hr');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw validation('INVALID_PERIOD', 'Format periode YYYY-MM.');
    const { start, end } = periodBounds(period);
    const holidays = new Set((await this.db.query<{ date: string }>(`SELECT date FROM holiday WHERE date BETWEEN $1::date AND $1::date + 31`, [`${period}-01`])).map((h) => h.date));
    const id = `${legalEntityId}-${period}`;
    await this.db.execute(
      `INSERT INTO payroll_period (id, legal_entity_id, period, start_date, end_date, pay_date) VALUES ($1, $2, $3, $4::date, $5::date, $6::date)
       ON CONFLICT (legal_entity_id, period) DO NOTHING`,
      [id, legalEntityId, period, start, end, resolvePayDate(period, holidays)],
    );
    return id;
  }

  /** extra boleh memakai $3 (waktu sekarang) dan $4 (user aktor). */
  private async transition(tx: Db, id: string, to: string, extra = '', actorId: string | null = null): Promise<void> {
    try {
      // Driver pg menolak parameter yang tidak dipakai, jadi kirim hanya yang dirujuk.
      const params: unknown[] = [id, to];
      if (extra.includes('$3')) params.push(this.clock.now());
      if (extra.includes('$4')) params.push(actorId);
      const rows = await tx.query<{ id: string }>(`UPDATE payroll_period SET status = $2${extra} WHERE id = $1 RETURNING id`, params);
      if (rows.length === 0) throw notFound('PERIOD_NOT_FOUND', 'Periode payroll tidak ditemukan.');
    } catch (e) {
      if (e instanceof DbError && e.sqlState === 'P0003') throw conflict('INVALID_TRANSITION', 'Langkah payroll ini belum bisa dilakukan. Selesaikan langkah sebelumnya dulu.');
      throw e;
    }
  }

  /** Langkah 1 (tgl 25): kunci absensi. Koreksi setelah ini masuk penyesuaian periode berikutnya. */
  async lockAttendance(actor: Actor, id: string): Promise<PayrollRun> {
    requireRole(actor, 'hr');
    await this.db.transaction(async (tx) => {
      await this.transition(tx, id, 'attendance_locked', ', attendance_locked_at = $3::timestamptz');
      await writeAudit(tx, { actorId: actor.userId, action: 'payroll.lock_attendance', entity: 'payroll_period', entityId: id });
    });
    return this.getRun(actor, id);
  }

  /** Langkah 2: hitung semua karyawan. Karyawan dengan data kurang ditandai, tidak menahan yang lain (PAY-01 AC3). */
  async calculate(actor: Actor, id: string): Promise<PayrollRun> {
    requireRole(actor, 'hr');
    const p = await this.period(id);
    if (!['attendance_locked', 'calculated', 'hr_review'].includes(p.status)) {
      throw conflict('INVALID_TRANSITION', p.status === 'draft' ? 'Kunci absensi dulu sebelum menghitung gaji.' : 'Periode ini sudah diajukan atau dikunci; perhitungan ulang tidak diizinkan.');
    }
    const inputs = await buildPayrollInputs(this.db, p, localDate(this.clock.now()));
    const results = inputs.map((input) => ({ input, result: calculateEmployeePayroll(input) }));

    await this.db.transaction(async (tx) => {
      // attendance_locked → calculated → hr_review; hitung ulang dari hr_review: → calculated → hr_review.
      if (p.status !== 'calculated') await this.transition(tx, id, 'calculated');
      await tx.execute('DELETE FROM payroll_item WHERE period_id = $1', [id]);
      for (const { input, result } of results) {
        const ok = result.status === 'ok' ? result : null;
        const sumCodes = (lines: MoneyLine[], codes: string[]) => lines.filter((l) => codes.includes(l.code)).reduce((a, l) => a + l.amount, 0);
        await tx.execute(
          `INSERT INTO payroll_item (period_id, employee_id, status, input_snapshot, result, gross_pay, taxable_gross, pph21, employee_pension,
                                     take_home_pay, ruleset_version, engine_version, input_hash, output_hash)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [id, input.employeeId, result.status, JSON.stringify(input), JSON.stringify(result), ok?.grossPay ?? null, ok?.taxableGross ?? null, ok ? ok.tax.amount : null,
            ok ? sumCodes(ok.employeeContributions, ['JHT_EE', 'JP_EE']) : null, ok?.takeHomePay ?? null, result.rulesetVersion,
            ok?.engineVersion ?? null, result.inputHash, ok?.outputHash ?? null],
        );
      }
      await this.transition(tx, id, 'hr_review');
      await writeAudit(tx, { actorId: actor.userId, action: 'payroll.calculate', entity: 'payroll_period', entityId: id, diff: { employees: results.length, needsReview: results.filter((r) => r.result.status === 'needs_review').length } });
    });
    return this.getRun(actor, id);
  }

  async submitForApproval(actor: Actor, id: string): Promise<PayrollRun> {
    requireRole(actor, 'hr');
    // Gaji diterima negatif tidak bisa ditransfer; wajib diperbaiki (mis. cicil potongan) sebelum ke Owner.
    const negative = await this.db.query<{ code: string }>(
      `SELECT e.code FROM payroll_item pi JOIN employee e ON e.id = pi.employee_id WHERE pi.period_id = $1 AND pi.take_home_pay < 0 ORDER BY e.code`,
      [id],
    );
    if (negative.length > 0) {
      throw conflict('NEGATIVE_TAKE_HOME', `Gaji diterima negatif untuk ${negative.map((n) => n.code).join(', ')}. Kurangi atau cicil potongannya, lalu hitung ulang.`);
    }
    await this.db.transaction(async (tx) => {
      await this.transition(tx, id, 'owner_approval', ', submitted_at = $3::timestamptz');
      await writeAudit(tx, { actorId: actor.userId, action: 'payroll.submit', entity: 'payroll_period', entityId: id });
    });
    return this.getRun(actor, id);
  }

  async decideApproval(actor: Actor, id: string, decision: 'approve' | 'reject', note?: string): Promise<PayrollRun> {
    requireRole(actor, 'owner');
    if (decision === 'reject' && !note?.trim()) throw validation('NOTE_REQUIRED', 'Tulis apa yang perlu diperbaiki HR.');
    await this.db.transaction(async (tx) => {
      if (decision === 'approve') {
        await this.transition(tx, id, 'approved', ', approved_by = $4, approved_at = $3::timestamptz', actor.userId);
      } else {
        await this.transition(tx, id, 'hr_review');
      }
      await writeAudit(tx, { actorId: actor.userId, action: `payroll.${decision}`, entity: 'payroll_period', entityId: id, diff: note ? { note } : {} });
    });
    return this.getRun(actor, id);
  }

  /** Kunci periode wajib konfirmasi bernama: ketik "Kunci periode April 2027". */
  async lockPeriod(actor: Actor, id: string, confirmation: string): Promise<PayrollRun> {
    requireRole(actor, 'hr');
    const p = await this.period(id);
    const expected = `Kunci periode ${periodLabel(p.period)}`;
    if (confirmation.trim() !== expected) throw validation('CONFIRMATION_MISMATCH', `Ketik persis "${expected}" untuk mengunci periode.`);
    await this.db.transaction(async (tx) => {
      await this.transition(tx, id, 'locked', ', locked_by = $4, locked_at = $3::timestamptz', actor.userId);
      await tx.execute(
        `UPDATE payroll_adjustment a SET target_period_id = $1 FROM employee e
          WHERE e.id = a.employee_id AND e.legal_entity_id = $2 AND a.target_period_id IS NULL AND a.source_period < $3`,
        [id, p.legal_entity_id, p.period],
      );
      await writeAudit(tx, { actorId: actor.userId, action: 'payroll.lock', entity: 'payroll_period', entityId: id });
    });
    return this.getRun(actor, id);
  }

  /** PAY-03: file bulk transfer. Total file wajib sama dengan total gaji diterima. */
  async exportBankFile(actor: Actor, id: string) {
    requireRole(actor, 'hr', 'finance');
    const p = await this.period(id);
    if (!['locked', 'exported'].includes(p.status)) throw locked('PERIOD_NOT_LOCKED', 'File bank hanya bisa dibuat setelah periode dikunci.');
    const rows = await this.db.query<{ code: string; full_name: string; bank_name: string | null; account: string | null; take_home_pay: number }>(
      `SELECT e.code, e.full_name, e.bank_name, encode(e.bank_account_ciphertext, 'hex') AS account, pi.take_home_pay
         FROM payroll_item pi JOIN employee e ON e.id = pi.employee_id
        WHERE pi.period_id = $1 AND pi.status = 'ok' AND pi.take_home_pay > 0 ORDER BY e.code`,
      [id],
    );
    const missing = rows.filter((r) => !r.account || !r.bank_name);
    if (missing.length > 0) throw validation('MISSING_BANK_ACCOUNT', `${missing.length} karyawan belum punya rekening: ${missing.map((m) => m.code).join(', ')}. Lengkapi lalu ekspor ulang.`);
    const file = buildMandiriMcmFile(
      rows.map((r) => ({
        employeeCode: r.code,
        name: r.full_name,
        bankName: r.bank_name!,
        accountNumber: decrypt(Buffer.from(r.account!, 'hex'), this.dataKey),
        amount: r.take_home_pay,
        remark: `Gaji ${periodLabel(p.period)}`,
      })),
      { period: p.period, payDate: p.pay_date },
    );
    const expected = rows.reduce((a, r) => a + r.take_home_pay, 0);
    if (file.total !== expected) throw new Error('Total file bank tidak sama dengan total gaji diterima.');
    await this.db.transaction(async (tx) => {
      if (p.status === 'locked') await this.transition(tx, id, 'exported', ', exported_at = $3::timestamptz');
      await writeAudit(tx, { actorId: actor.userId, action: 'payroll.export_bank', entity: 'payroll_period', entityId: id, diff: { count: file.count, total: file.total } });
    });
    return file;
  }

  async getRun(actor: Actor, id: string): Promise<PayrollRun> {
    if (!canSeeSalary(actor)) throw forbidden('Data gaji hanya untuk HR, Finance, dan Owner.');
    const p = await this.period(id);
    const items = await this.db.query<ItemRow>(
      `SELECT pi.employee_id, pi.status, pi.result, pi.input_snapshot, pi.gross_pay, pi.take_home_pay,
              e.code, e.full_name, e.position, e.location_id, l.name AS location_name, e.employment_type, e.bank_name,
              -- Harian lepas: jumlah bulan (dari 3 terakhir) dengan ≥ 21 hari hadir (PP 35/2021, perlu verifikasi pasal).
              CASE WHEN e.employment_type = 'HARIAN' THEN (
                SELECT count(*) FROM (
                  SELECT date_trunc('month', d.work_date) AS m FROM attendance_day_v d
                   WHERE d.employee_id = e.id AND d.clock_in IS NOT NULL AND d.work_date > $2::date - interval '3 months' AND d.work_date <= $2::date
                   GROUP BY 1 HAVING count(*) >= 21) months)
              ELSE 0 END::int AS casual_months_21
         FROM payroll_item pi JOIN employee e ON e.id = pi.employee_id JOIN location l ON l.id = e.location_id
        WHERE pi.period_id = $1 ORDER BY pi.status DESC, e.full_name`,
      [id, p.end_date],
    );

    const rows: PayrollRow[] = items.map((it) => {
      const r = it.result;
      let issue: PayrollRow['issue'];
      if (r.status === 'needs_review') {
        const first = r.issues[0]!;
        issue = { kind: ISSUE_KIND[first.code] ?? 'missing_wage', label: first.message.split(/[.;]/)[0]!, actionLabel: first.code === 'DAILY_WAGE_ABOVE_TER' ? 'Hitung manual' : 'Lengkapi data' };
      } else if (it.casual_months_21 >= 3) {
        issue = { kind: 'casual_21_days', label: '≥ 21 hari, 3 bulan berturut-turut', actionLabel: 'Tinjau status' };
      } else if (it.bank_name && !/mandiri/i.test(it.bank_name)) {
        issue = { kind: 'non_mandiri_account', label: 'Rekening bukan Mandiri', actionLabel: 'Periksa rekening' };
      }
      return {
        employee: toEmployee(it),
        locationName: it.location_name,
        daysPresent: it.input_snapshot.attendance.daysPresent,
        overtimeHours: it.input_snapshot.overtime.reduce((a, o) => a + o.hours, 0),
        gross: it.gross_pay ?? 0,
        takeHome: it.take_home_pay ?? 0,
        issue,
      };
    });

    const reached = (s: string) => STEP_ORDER.indexOf(p.status as (typeof STEP_ORDER)[number]) >= STEP_ORDER.indexOf(s as (typeof STEP_ORDER)[number]);
    const stepStatus = (doneAt: string, activeAt: string): PayrollStep['status'] => (reached(doneAt) ? 'done' : reached(activeAt) ? 'active' : 'todo');
    const steps: PayrollStep[] = [
      { key: 'lock_attendance', label: 'Kunci absensi', status: reached('attendance_locked') ? 'done' : 'active', dateLabel: p.attendance_locked_at ? shortDate(p.attendance_locked_at) : shortDate(p.end_date) },
      { key: 'calculate', label: 'Hitung gaji', status: stepStatus('calculated', 'attendance_locked'), dateLabel: shortDate(addDays(p.end_date, 1)) },
      { key: 'hr_review', label: 'Review HR', status: stepStatus('owner_approval', 'hr_review'), dateLabel: shortDate(addDays(p.end_date, 1)) },
      { key: 'owner_approval', label: 'Persetujuan Owner', status: stepStatus('approved', 'owner_approval'), dateLabel: p.approved_at ? shortDate(p.approved_at) : `Target ${shortDate(addDays(p.pay_date, -1))} 12.00` },
      { key: 'lock_period', label: 'Kunci periode', status: stepStatus('locked', 'approved'), dateLabel: p.locked_at ? shortDate(p.locked_at) : shortDate(addDays(p.pay_date, -1)) },
      { key: 'export_bank', label: 'Ekspor Mandiri MCM', status: reached('exported') ? 'done' : reached('locked') ? 'active' : 'todo', dateLabel: p.exported_at ? shortDate(p.exported_at) : shortDate(addDays(p.pay_date, -1)) },
    ];

    const ok = items.filter((i) => i.status === 'ok');
    return {
      period: p.period,
      periodLabel: periodLabel(p.period),
      periodStart: p.start_date,
      periodEnd: p.end_date,
      payDate: p.pay_date,
      steps,
      employeesTotal: items.length,
      employeesReady: ok.length,
      totals: { gross: ok.reduce((a, i) => a + (i.gross_pay ?? 0), 0), takeHome: ok.reduce((a, i) => a + (i.take_home_pay ?? 0), 0) },
      counts: {
        all: items.length,
        needsReview: rows.filter((r) => r.issue).length,
        casual: items.filter((i) => i.employment_type === 'HARIAN').length,
        withOvertime: rows.filter((r) => r.overtimeHours > 0).length,
      },
      rows,
    };
  }

  // ------------------------------------------------------------------ slip karyawan (PAY-02)
  async listPayslipPeriods(actor: Actor) {
    const employeeId = requireEmployee(actor);
    const rows = await this.db.query<{ period: string; pay_date: string }>(
      `SELECT pp.period, pp.pay_date FROM payroll_item pi JOIN payroll_period pp ON pp.id = pi.period_id
        WHERE pi.employee_id = $1 AND pi.status = 'ok' AND pp.status IN ('locked', 'exported') ORDER BY pp.period DESC`,
      [employeeId],
    );
    return rows.map((r) => ({ period: r.period, label: `${periodLabel(r.period)} · dibayar ${shortDate(r.pay_date)}` }));
  }

  /** Hanya slip milik sendiri, hanya periode yang sudah dikunci (PAY-02 AC2). */
  async getPayslip(actor: Actor, period: string): Promise<Payslip> {
    const employeeId = requireEmployee(actor);
    const row = await one(this.db.query<{ result: EmployeePayrollResult; start_date: string; end_date: string; pay_date: string; bank_name: string | null; bank_account_last4: string | null }>(
      `SELECT pi.result, pp.start_date, pp.end_date, pp.pay_date, e.bank_name, e.bank_account_last4
         FROM payroll_item pi JOIN payroll_period pp ON pp.id = pi.period_id JOIN employee e ON e.id = pi.employee_id
        WHERE pi.employee_id = $1 AND pp.period = $2 AND pi.status = 'ok' AND pp.status IN ('locked', 'exported')`,
      [employeeId, period],
    ));
    if (!row || row.result.status !== 'ok') throw notFound('PAYSLIP_NOT_FOUND', 'Slip gaji periode ini belum terbit.');
    const r = row.result;
    return {
      period,
      periodLabel: periodLabel(period),
      periodStart: row.start_date,
      periodEnd: row.end_date,
      payDate: row.pay_date,
      earnings: r.earnings.map((e) => ({ label: e.label, amount: e.amount })),
      deductions: r.deductions.map((d) => ({ label: d.label, amount: d.amount })),
      takeHome: r.takeHomePay,
      bankAccountMasked: row.bank_name ? `${row.bank_name} ••• ${row.bank_account_last4 ?? '????'}` : '—',
      pdfUrl: `/payslips/${period}.pdf`,
    };
  }
}
