import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { calculateEmployeePayroll, type EmployeePayrollInput } from '@dagingpeople/payroll-engine';
import { DbError } from '../src/common/db';
import { DomainError } from '../src/common/errors';
import { buildPayrollInputs, type PeriodRow } from '../src/modules/payroll/payroll.inputs';
import { periodBounds, resolvePayDate } from '../src/modules/payroll/payroll.service';
import { actors, freshDb, seedPeriodAttendance, type Services } from './support/env';

let s: Services;
const PERIOD_ID = 'dpn-2026-09';
const OT_DATES = ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17'];

before(async () => {
  s = await freshDb();
  // Periode September 2026 (26 Agu – 25 Sep). Joko: 26 hari terjadwal (27 Senin–Sabtu, satu dijadikan Libur), hadir semua.
  await s.db.execute(`UPDATE schedule_entry SET cell = 'OFF' WHERE employee_id = 'joko' AND work_date = '2026-09-19'`);
  // Semua shift terjadwal di periode itu hadir, kecuali Budi mangkir 9 Sep.
  await seedPeriodAttendance(s.db, '2026-08-26', '2026-09-25', [{ employeeId: 'budi', date: '2026-09-09' }]);
  for (const d of OT_DATES) {
    await s.db.execute(
      `INSERT INTO overtime_order (employee_id, work_date, hours, day_type, reason, status, requested_by, decided_by) VALUES ('joko', $1::date, 1, 'workday', 'Bongkar kiriman sapi', 'approved', 'u-hendra', 'u-hr')`,
      [d],
    );
  }
  // Lembur yang belum disetujui tidak boleh dibayar.
  await s.db.execute(`INSERT INTO overtime_order (employee_id, work_date, hours, day_type, reason, requested_by) VALUES ('joko', '2026-09-22', 2, 'workday', 'Stok opname', 'u-hendra')`);
});
after(async () => s.close());

describe('periode & tanggal bayar', () => {
  test('periode 26–25, bayar tgl 28; Minggu/libur mundur ke hari kerja sebelumnya', () => {
    assert.deepEqual(periodBounds('2027-01'), { start: '2026-12-26', end: '2027-01-25' });
    assert.equal(resolvePayDate('2026-09', new Set()), '2026-09-28');
    assert.equal(resolvePayDate('2027-02', new Set()), '2027-02-27', '28 Feb 2027 hari Minggu');
    assert.equal(resolvePayDate('2027-03', new Set(['2027-03-27'])), '2027-03-26');
  });
});

describe('PAY-01 alur payroll September 2026', () => {
  test('input dari database untuk Joko sama persis dengan kasus emas engine', async () => {
    await s.payroll.ensurePeriod(actors.hr, 'dpn', '2026-09');
    const [p] = await s.db.query<PeriodRow>(`SELECT id, legal_entity_id, period, start_date, end_date, pay_date, status FROM payroll_period WHERE id = $1`, [PERIOD_ID]);
    assert.deepEqual([p!.start_date, p!.end_date, p!.pay_date], ['2026-08-26', '2026-09-25', '2026-09-28']);
    const inputs = await buildPayrollInputs(s.db, p!, '2026-10-07');
    const joko = inputs.find((i) => i.employeeId === 'joko')!;
    const expected: EmployeePayrollInput = {
      employeeId: 'joko', employmentType: 'PKWTT', ptkpStatus: 'TK/0', workPattern: '6_DAY', jkkRisk: 'low', regionCode: 'DKI_JAKARTA',
      period: { year: 2026, month: 9, start: '2026-08-26', end: '2026-09-25', payDate: '2026-09-28' },
      monthly: { basicSalary: 5_500_000, fixedAllowances: [{ code: 'ALW_POSITION', label: 'Tunjangan tetap', amount: 300_000 }] },
      daily: undefined,
      attendance: { scheduledWorkDays: 26, daysPresent: 26, unpaidAbsenceDays: 0, employedWorkDays: undefined },
      overtime: OT_DATES.map((date) => ({ date, hours: 1, dayType: 'workday', shortestWorkday: undefined })),
      bpjsEnrollment: { kesehatan: true, ketenagakerjaan: true, pensiun: true },
      adjustments: [], otherDeductions: [], taxMonthKind: 'regular', yearToDate: undefined,
    };
    assert.deepEqual(joko, expected);
    const budi = inputs.find((i) => i.employeeId === 'budi')!;
    assert.equal(budi.attendance.unpaidAbsenceDays, 1, 'satu shift tanpa absen = mangkir');
  });

  test('hitung sebelum kunci absensi ditolak; setelah kunci → semua dihitung, data kurang ditandai', async () => {
    await assert.rejects(s.payroll.calculate(actors.hr, PERIOD_ID), (e: DomainError) => e.code === 'INVALID_TRANSITION');
    await s.payroll.lockAttendance(actors.hr, PERIOD_ID);
    const run = await s.payroll.calculate(actors.hr, PERIOD_ID);
    assert.equal(run.periodLabel, 'September 2026');
    assert.equal(run.employeesTotal, 14);
    const joko = run.rows.find((r) => r.employee.id === 'joko')!;
    assert.equal(joko.gross, 6_101_734);
    assert.equal(joko.takeHome, 5_805_910, 'THP sama dengan perhitungan manual (golden test engine)');
    assert.equal(joko.overtimeHours, 6, 'lembur belum disetujui tidak dihitung');
    const fajar = run.rows.find((r) => r.employee.id === 'fajar')!;
    assert.deepEqual(fajar.issue, { kind: 'missing_ptkp', label: 'Status PTKP kosong', actionLabel: 'Lengkapi data' });
    assert.equal(run.rows.find((r) => r.employee.id === 'sari')!.issue?.kind, 'non_mandiri_account');
    assert.equal(run.employeesReady, 13);
    const hendra = run.rows.find((r) => r.employee.id === 'hendra')!;
    assert.ok(Number.isInteger(hendra.takeHome) && hendra.takeHome > 8_000_000, `Kepala Toko tanpa jadwal shift tetap digaji penuh (${hendra.takeHome})`);
    assert.equal(run.counts.casual, 3);
    assert.equal(run.steps.find((x) => x.key === 'hr_review')!.status, 'active');
  });

  test('hasil tersimpan dapat diaudit: hash input & output cocok dengan engine', async () => {
    const [item] = await s.db.query<{ input_snapshot: EmployeePayrollInput; input_hash: string; output_hash: string; take_home_pay: number }>(
      `SELECT input_snapshot, input_hash, output_hash, take_home_pay FROM payroll_item WHERE period_id = $1 AND employee_id = 'joko'`,
      [PERIOD_ID],
    );
    const replay = calculateEmployeePayroll(item!.input_snapshot);
    assert.equal(replay.status, 'ok');
    assert.equal(replay.inputHash, item!.input_hash);
    assert.ok(replay.status === 'ok' && replay.outputHash === item!.output_hash && replay.takeHomePay === item!.take_home_pay);
  });

  test('hitung ulang di tahap review diizinkan (hasil sama); data gaji tertutup untuk Kepala Toko & karyawan', async () => {
    const again = await s.payroll.calculate(actors.hr, PERIOD_ID);
    assert.equal(again.rows.find((r) => r.employee.id === 'joko')!.takeHome, 5_805_910);
    await assert.rejects(s.payroll.getRun(actors.hendra, PERIOD_ID), (e: DomainError) => e.kind === 'forbidden');
    await assert.rejects(s.payroll.getRun(actors.joko, PERIOD_ID), (e: DomainError) => e.kind === 'forbidden');
    await assert.rejects(s.payroll.calculate(actors.finance, PERIOD_ID), (e: DomainError) => e.kind === 'forbidden');
  });

  test('gaji diterima negatif menahan pengajuan ke Owner sampai diperbaiki', async () => {
    await s.db.execute(`INSERT INTO payroll_adjustment (employee_id, source_period, label, amount, taxable, reason, created_by) VALUES ('dewi', '2026-08', 'Potongan kasbon', -9000000, FALSE, 'Kasbon', 'u-hr')`);
    await s.payroll.calculate(actors.hr, PERIOD_ID);
    await assert.rejects(s.payroll.submitForApproval(actors.hr, PERIOD_ID), (e: DomainError) => e.code === 'NEGATIVE_TAKE_HOME' && /DPN-2024-0051/.test(e.message));
    await s.db.execute(`DELETE FROM payroll_adjustment WHERE employee_id = 'dewi'`);
    await s.payroll.calculate(actors.hr, PERIOD_ID);
  });

  test('ajukan → Owner tolak (wajib catatan) kembali ke HR → ajukan ulang → Owner setuju', async () => {
    await s.payroll.submitForApproval(actors.hr, PERIOD_ID);
    await assert.rejects(s.payroll.calculate(actors.hr, PERIOD_ID), (e: DomainError) => e.code === 'INVALID_TRANSITION');
    await assert.rejects(s.payroll.decideApproval(actors.hr, PERIOD_ID, 'approve'), (e: DomainError) => e.kind === 'forbidden');
    await assert.rejects(s.payroll.decideApproval(actors.owner, PERIOD_ID, 'reject'), (e: DomainError) => e.code === 'NOTE_REQUIRED');
    const back = await s.payroll.decideApproval(actors.owner, PERIOD_ID, 'reject', 'Cek lembur Joko');
    assert.equal(back.steps.find((x) => x.key === 'hr_review')!.status, 'active');
    await s.payroll.submitForApproval(actors.hr, PERIOD_ID);
    const approved = await s.payroll.decideApproval(actors.owner, PERIOD_ID, 'approve');
    assert.equal(approved.steps.find((x) => x.key === 'owner_approval')!.status, 'done');
  });

  test('setelah disetujui, item payroll beku di database (trigger), bukan hanya di aplikasi', async () => {
    await assert.rejects(
      s.db.execute(`UPDATE payroll_item SET take_home_pay = take_home_pay + 1 WHERE period_id = $1 AND employee_id = 'joko'`, [PERIOD_ID]),
      (e: DbError) => e.sqlState === 'P0002',
    );
  });

  test('ekspor bank sebelum kunci ditolak; kunci wajib ketik konfirmasi persis', async () => {
    await assert.rejects(s.payroll.exportBankFile(actors.finance, PERIOD_ID), (e: DomainError) => e.code === 'PERIOD_NOT_LOCKED');
    await assert.rejects(s.payroll.lockPeriod(actors.hr, PERIOD_ID, 'kunci'), (e: DomainError) => e.code === 'CONFIRMATION_MISMATCH');
    const locked = await s.payroll.lockPeriod(actors.hr, PERIOD_ID, 'Kunci periode September 2026');
    assert.equal(locked.steps.find((x) => x.key === 'lock_period')!.status, 'done');
    const [row] = await s.db.query<{ locked_by: string; approved_by: string }>(`SELECT locked_by, approved_by FROM payroll_period WHERE id = $1`, [PERIOD_ID]);
    assert.deepEqual(row, { locked_by: 'u-hr', approved_by: 'u-owner' });
  });

  test('PAY-03 file Mandiri MCM: total = total gaji diterima, rekening didekripsi, status → diekspor', async () => {
    const file = await s.payroll.exportBankFile(actors.finance, PERIOD_ID);
    const run = await s.payroll.getRun(actors.finance, PERIOD_ID);
    assert.equal(file.total, run.totals.takeHome);
    assert.equal(file.count, 13);
    assert.equal(file.nonMandiriCount, 1);
    assert.match(file.content, /;1270007788990;Joko Prasetyo;Mandiri;5805910;Gaji September 2026;DPN-2024-0042\r\n/);
    assert.equal(file.filename, 'payroll-mcm-2026-09-bayar-2026-09-28.csv');
    assert.equal(run.steps.find((x) => x.key === 'export_bank')!.status, 'done');
    const audit = await s.db.query<{ action: string }>(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id`, [PERIOD_ID]);
    assert.deepEqual(audit.map((a) => a.action), [
      'payroll.lock_attendance', 'payroll.calculate', 'payroll.calculate', 'payroll.calculate', 'payroll.calculate', 'payroll.submit', 'payroll.reject', 'payroll.submit', 'payroll.approve', 'payroll.lock', 'payroll.export_bank',
    ]);
  });

  test('PAY-02 slip: hanya milik sendiri & hanya periode terkunci', async () => {
    const periods = await s.payroll.listPayslipPeriods(actors.joko);
    assert.deepEqual(periods, [{ period: '2026-09', label: 'September 2026 · dibayar 28 Sep' }]);
    const slip = await s.payroll.getPayslip(actors.joko, '2026-09');
    assert.equal(slip.takeHome, 5_805_910);
    assert.equal(slip.bankAccountMasked, 'Mandiri ••• 8990');
    assert.equal(slip.earnings.reduce((a, e) => a + e.amount, 0) - slip.deductions.reduce((a, d) => a + d.amount, 0), slip.takeHome);
    await assert.rejects(s.payroll.getPayslip(actors.joko, '2026-08'), (e: DomainError) => e.kind === 'not_found');
    await assert.rejects(s.payroll.getPayslip(actors.hr, '2026-09'), (e: DomainError) => e.kind === 'forbidden');
  });

  test('periode berikutnya memakai YTD dari periode terkunci', async () => {
    await s.payroll.ensurePeriod(actors.hr, 'dpn', '2026-10');
    const [p] = await s.db.query<PeriodRow>(`SELECT id, legal_entity_id, period, start_date, end_date, pay_date, status FROM payroll_period WHERE id = 'dpn-2026-10'`);
    const joko = (await buildPayrollInputs(s.db, p!, '2026-10-07')).find((i) => i.employeeId === 'joko')!;
    assert.deepEqual(joko.yearToDate, { taxableGross: 6_382_454, pph21Withheld: 63_824, employeePensionContributions: 174_000, monthsEmployed: 1 });
  });
});
