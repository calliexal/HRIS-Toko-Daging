import type { LeaveBalance, LeaveInput, LeavePreview, LeaveType } from '@dagingpeople/contracts';
import { requireEmployee, requireLocation, requireRole, type Actor } from '../../common/actor';
import { writeAudit } from '../../common/audit';
import type { Clock } from '../../common/clock';
import { one, type Db } from '../../common/db';
import { conflict, forbidden, notFound, validation } from '../../common/errors';
import { addDays, localDate, weekday } from '../../common/time';

/** Hari kerja dalam rentang: pola 6 hari tanpa Minggu, pola 5 hari tanpa Sabtu-Minggu, tanpa libur nasional. */
export const countWorkingDays = (start: string, end: string, pattern: '6_DAY' | '5_DAY', holidays: ReadonlySet<string>): number => {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = weekday(d);
    const weekend = pattern === '6_DAY' ? wd === 0 : wd === 0 || wd === 6;
    if (!weekend && !holidays.has(d)) n += 1;
  }
  return n;
};

/** Pengingat 24 jam, eskalasi ke HR 48 jam (LV-01 AC3). */
export const REMIND_AFTER_HOURS = 24;
export const ESCALATE_AFTER_HOURS = 48;
const MAX_LEAVE_SPAN_DAYS = 60;

type EmployeeInfo = { id: string; location_id: string; work_pattern: '6_DAY' | '5_DAY'; join_date: string; full_name: string };

export class LeaveService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private async employee(id: string): Promise<EmployeeInfo> {
    const row = await one(this.db.query<EmployeeInfo>('SELECT id, location_id, work_pattern, join_date, full_name FROM employee WHERE id = $1 AND end_date IS NULL', [id]));
    if (!row) throw notFound('EMPLOYEE_NOT_FOUND', 'Data karyawan tidak ditemukan.');
    return row;
  }

  private async holidays(start: string, end: string): Promise<Set<string>> {
    const rows = await this.db.query<{ date: string }>('SELECT date FROM holiday WHERE date BETWEEN $1::date AND $2::date', [start, end]);
    return new Set(rows.map((r) => r.date));
  }

  async balance(actor: Actor): Promise<LeaveBalance> {
    const id = requireEmployee(actor);
    const year = Number(localDate(this.clock.now()).slice(0, 4));
    const row = await one(this.db.query<{ entitlement: number; remaining: number }>('SELECT entitlement, remaining FROM leave_balance_v WHERE employee_id = $1 AND year = $2', [id, year]));
    // Hak cuti tahunan 12 hari muncul setelah 12 bulan bekerja; sebelum itu entitlement belum dibuat.
    return { annualRemaining: row?.remaining ?? 0, annualEntitlement: row?.entitlement ?? 0 };
  }

  private validateDates(input: Pick<LeaveInput, 'startDate' | 'endDate'>) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(input.startDate) || !iso.test(input.endDate)) throw validation('INVALID_DATE', 'Isi tanggal mulai dan selesai.');
    if (input.endDate < input.startDate) throw validation('END_BEFORE_START', 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
    if (addDays(input.startDate, MAX_LEAVE_SPAN_DAYS) < input.endDate) throw validation('SPAN_TOO_LONG', `Pengajuan paling panjang ${MAX_LEAVE_SPAN_DAYS} hari. Untuk cuti lebih lama, hubungi HR.`);
  }

  async preview(actor: Actor, input: Pick<LeaveInput, 'type' | 'startDate' | 'endDate'>): Promise<LeavePreview> {
    const emp = await this.employee(requireEmployee(actor));
    this.validateDates(input);
    const workingDays = countWorkingDays(input.startDate, input.endDate, emp.work_pattern, await this.holidays(input.startDate, input.endDate));
    const balance = input.type === 'annual' ? await this.balance(actor) : null;
    const approver = await one(this.db.query<{ name: string }>(
      `SELECT coalesce(e.full_name, u.email) || ' (Kepala Toko)' AS name FROM app_user u LEFT JOIN employee e ON e.id = u.employee_id
        WHERE u.role = 'store_manager' AND u.active AND $1 = ANY(u.location_ids) ORDER BY u.created_at LIMIT 1`,
      [emp.location_id],
    ));
    return {
      workingDays,
      balanceAfter: balance ? balance.annualRemaining - workingDays : null,
      attachmentRequired: input.type === 'sick' && workingDays > 1,
      approverName: approver?.name ?? 'HR',
    };
  }

  async submit(actor: Actor, input: LeaveInput): Promise<{ id: string; status: 'pending' }> {
    const emp = await this.employee(requireEmployee(actor));
    this.validateDates(input);
    if (!(['annual', 'permit', 'sick'] as LeaveType[]).includes(input.type)) throw validation('INVALID_TYPE', 'Pilih jenis pengajuan: Cuti tahunan, Izin, atau Sakit.');
    if (!input.reason?.trim()) throw validation('REASON_REQUIRED', 'Tulis alasan singkat agar atasan bisa menyetujui.');
    const workingDays = countWorkingDays(input.startDate, input.endDate, emp.work_pattern, await this.holidays(input.startDate, input.endDate));
    if (workingDays === 0) throw validation('NO_WORKING_DAYS', 'Tanggal yang dipilih adalah hari libur. Tidak perlu mengajukan cuti.');
    if (input.type === 'sick' && workingDays > 1 && !input.attachmentName) throw validation('ATTACHMENT_REQUIRED', 'Surat dokter wajib untuk sakit lebih dari 1 hari. Foto atau unggah suratnya.');

    return this.db.transaction(async (tx) => {
      // Kunci baris karyawan agar dua pengajuan bersamaan tidak sama-sama lolos cek saldo.
      await tx.query('SELECT id FROM employee WHERE id = $1 FOR UPDATE', [emp.id]);
      const overlap = await one(tx.query<{ id: string }>(
        `SELECT id::text FROM leave_request WHERE employee_id = $1 AND status IN ('pending', 'approved')
          AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]') LIMIT 1`,
        [emp.id, input.startDate, input.endDate],
      ));
      if (overlap) throw conflict('LEAVE_OVERLAP', 'Sudah ada pengajuan di tanggal yang sama. Batalkan pengajuan lama dulu bila ingin mengubahnya.');
      if (input.type === 'annual') {
        const year = Number(input.startDate.slice(0, 4));
        const bal = await one(tx.query<{ remaining: number }>('SELECT remaining FROM leave_balance_v WHERE employee_id = $1 AND year = $2', [emp.id, year]));
        const remaining = bal?.remaining ?? 0;
        if (workingDays > remaining) throw validation('INSUFFICIENT_BALANCE', `Saldo cuti tidak cukup: sisa ${remaining} hari, diminta ${workingDays} hari. Ajukan Izin untuk sisanya.`);
      }
      const row = await one(tx.query<{ id: string }>(
        `INSERT INTO leave_request (employee_id, type, start_date, end_date, working_days, reason, attachment_key, submitted_at)
         VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8::timestamptz) RETURNING id::text`,
        [emp.id, input.type, input.startDate, input.endDate, workingDays, input.reason.trim(), input.attachmentName ?? null, this.clock.now()],
      ));
      return { id: row!.id, status: 'pending' as const };
    });
  }

  /**
   * Level 1 = Kepala Toko lokasi karyawan; setelah eskalasi (level 2) = HR.
   * Disetujui → sel jadwal pada hari-hari itu diisi LEAVE (terkunci di jadwal).
   */
  async decide(actor: Actor, id: string, decision: 'approve' | 'reject', note?: string) {
    requireRole(actor, 'store_manager', 'hr');
    if (decision === 'reject' && !note?.trim()) throw validation('NOTE_REQUIRED', 'Tulis alasan penolakan agar karyawan tahu langkah berikutnya.');
    return this.db.transaction(async (tx) => {
      const req = await one(tx.query<{ id: string; employee_id: string; location_id: string; start_date: string; end_date: string; approver_level: number; type: string }>(
        `SELECT lr.id::text, lr.employee_id, e.location_id, lr.start_date, lr.end_date, lr.approver_level, lr.type
           FROM leave_request lr JOIN employee e ON e.id = lr.employee_id
          WHERE lr.id = $1::uuid AND lr.status = 'pending' FOR UPDATE OF lr`,
        [id],
      ));
      if (!req) throw notFound('LEAVE_NOT_FOUND', 'Pengajuan tidak ditemukan atau sudah diputuskan.');
      requireLocation(actor, req.location_id);
      if (req.employee_id === actor.employeeId) throw forbidden('Anda tidak bisa menyetujui pengajuan sendiri.');
      if (req.approver_level >= 2 && actor.role !== 'hr') throw forbidden('Pengajuan ini sudah dieskalasi ke HR.');

      await tx.execute(
        `UPDATE leave_request SET status = $2, decided_by = $3, decided_at = $4::timestamptz, decision_note = $5 WHERE id = $1::uuid`,
        [id, decision === 'approve' ? 'approved' : 'rejected', actor.userId, this.clock.now(), note?.trim() || null],
      );
      if (decision === 'approve') {
        await tx.execute(
          // Hanya hari kerja (bukan Minggu/Sabtu sesuai pola kerja, bukan libur nasional, bukan sel Libur) yang menjadi Cuti,
        // agar hitungan hari terjadwal payroll tidak bertambah.
        `INSERT INTO schedule_entry (employee_id, work_date, location_id, cell, updated_by)
           SELECT $1, d::date, $2, 'LEAVE', $5
             FROM generate_series($3::date, $4::date, interval '1 day') AS d, employee e
            WHERE e.id = $1 AND extract(isodow FROM d) <> 7 AND (e.work_pattern = '6_DAY' OR extract(isodow FROM d) <> 6)
              AND NOT EXISTS (SELECT 1 FROM holiday h WHERE h.date = d::date)
           ON CONFLICT (employee_id, work_date) DO UPDATE SET cell = 'LEAVE', updated_by = EXCLUDED.updated_by, updated_at = now()
            WHERE schedule_entry.cell <> 'OFF'`,
          [req.employee_id, req.location_id, req.start_date, req.end_date, actor.userId],
        );
      }
      await writeAudit(tx, { actorId: actor.userId, action: `leave.${decision}`, entity: 'leave_request', entityId: id, diff: { employeeId: req.employee_id, type: req.type } });
      return { id, status: decision === 'approve' ? ('approved' as const) : ('rejected' as const) };
    });
  }

  /**
   * Dijalankan job terjadwal tiap jam: kembalikan pengajuan yang perlu diingatkan (≥ 24 jam)
   * dan eskalasikan yang ≥ 48 jam ke HR (level 2).
   */
  async runEscalation(): Promise<{ remind: string[]; escalated: string[] }> {
    const now = this.clock.now();
    const escalated = await this.db.query<{ id: string }>(
      `UPDATE leave_request SET approver_level = 2, escalated_at = $1::timestamptz
        WHERE status = 'pending' AND approver_level = 1 AND submitted_at <= $1::timestamptz - make_interval(hours => $2)
        RETURNING id::text`,
      [now, ESCALATE_AFTER_HOURS],
    );
    const remind = await this.db.query<{ id: string }>(
      `SELECT id::text FROM leave_request
        WHERE status = 'pending' AND approver_level = 1
          AND submitted_at <= $1::timestamptz - make_interval(hours => $2)`,
      [now, REMIND_AFTER_HOURS],
    );
    return { remind: remind.map((r) => r.id), escalated: escalated.map((r) => r.id) };
  }
}
