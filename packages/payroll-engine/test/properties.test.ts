/**
 * Uji properti dengan generator acak ber-seed (deterministik, tanpa dependensi):
 * invarian yang harus berlaku untuk SEMUA input, bukan hanya kasus golden.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateEmployeePayroll, overtimePay, resolveRuleSet, terMonthly } from '../src/index';
import type { EmployeePayrollInput, EmployeePayrollResult, JkkRisk, PtkpStatus } from '../src/types';

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const RUNS = 500;
const PTKP: PtkpStatus[] = ['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3'];
const RISK: JkkRisk[] = ['very_low', 'low', 'medium', 'high', 'very_high'];

const generate = (rand: () => number): EmployeePayrollInput => {
  const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)] as T;
  const harian = rand() < 0.3;
  const scheduled = int(20, 27);
  const unpaid = int(0, 3);
  return {
    employeeId: `e${int(1, 9999)}`,
    employmentType: harian ? 'HARIAN' : pick(['PKWTT', 'PKWT'] as const),
    ptkpStatus: pick(PTKP),
    workPattern: pick(['6_DAY', '5_DAY'] as const),
    jkkRisk: pick(RISK),
    regionCode: 'DKI_JAKARTA',
    period: { year: 2026, month: int(1, 11), start: '2026-08-26', end: '2026-09-25', payDate: pick(['2026-02-27', '2026-09-28', '2027-04-28']) },
    monthly: harian ? undefined : { basicSalary: int(4_000, 60_000) * 1_000, fixedAllowances: [{ code: 'ALW', label: 'Tunjangan tetap', amount: int(0, 3_000) * 1_000 }] },
    daily: harian ? { dailyWage: int(100, 600) * 1_000 } : undefined,
    attendance: { scheduledWorkDays: scheduled, daysPresent: scheduled - unpaid, unpaidAbsenceDays: harian ? 0 : unpaid },
    overtime: Array.from({ length: int(0, 6) }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      hours: int(1, 8) / 2,
      dayType: rand() < 0.7 ? ('workday' as const) : ('rest_day' as const),
    })),
    bpjsEnrollment: { kesehatan: rand() < 0.9, ketenagakerjaan: rand() < 0.95, pensiun: rand() < 0.8 },
    adjustments: rand() < 0.2 ? [{ label: 'Koreksi', amount: int(-200, 500) * 1_000, taxable: rand() < 0.5 }] : [],
    otherDeductions: rand() < 0.2 ? [{ code: 'LOAN', label: 'Kasbon', amount: int(50, 500) * 1_000 }] : [],
    taxMonthKind: 'regular',
  };
};

const cases = (() => {
  const rand = mulberry32(20261007);
  return Array.from({ length: RUNS }, () => generate(rand));
})();

const okResults = cases
  .map((input) => ({ input, r: calculateEmployeePayroll(input) }))
  .filter((x): x is { input: EmployeePayrollInput; r: Extract<EmployeePayrollResult, { status: 'ok' }> } => x.r.status === 'ok');

const total = (lines: { amount: number }[]) => lines.reduce((a, l) => a + l.amount, 0);

describe(`Properti payroll (${RUNS} input acak)`, () => {
  it('hampir semua input acak valid diproses (needs_review hanya untuk upah harian > 2,5 jt)', () => {
    const reviewed = cases.length - okResults.length;
    assert.ok(reviewed < RUNS * 0.05, `${reviewed} kasus needs_review`);
  });

  it('deterministik: input sama → outputHash sama', () => {
    for (const { input, r } of okResults.slice(0, 100)) {
      const again = calculateEmployeePayroll(structuredClone(input));
      assert.equal(again.status === 'ok' && again.outputHash, r.outputHash);
    }
  });

  it('semua uang berupa integer rupiah', () => {
    for (const { r } of okResults) {
      for (const l of [...r.earnings, ...r.deductions, ...r.employerContributions, ...r.employeeContributions]) assert.ok(Number.isInteger(l.amount), `${l.code}=${l.amount}`);
      assert.ok(Number.isInteger(r.takeHomePay));
    }
  });

  it('diterima = bruto − total potongan', () => {
    for (const { r } of okResults) assert.equal(r.takeHomePay, r.grossPay - total(r.deductions));
  });

  it('iuran BPJS tidak pernah melewati batas upah', () => {
    for (const { input, r } of okResults) {
      const rs = resolveRuleSet(input.period.payDate);
      const kes = r.employeeContributions.find((c) => c.code === 'BPJS_KES_EE')?.amount ?? 0;
      const jp = r.employeeContributions.find((c) => c.code === 'JP_EE')?.amount ?? 0;
      assert.ok(kes <= Math.round(rs.bpjs.kesehatan.wageCap / 100));
      assert.ok(jp <= Math.round(rs.bpjs.jp.wageCap / 100));
    }
  });

  it('PPh 21 TER tidak pernah turun saat bruto naik', () => {
    const rs = resolveRuleSet('2026-09-28');
    const rand = mulberry32(7);
    for (let i = 0; i < 2_000; i++) {
      const status = PTKP[Math.floor(rand() * PTKP.length)]!;
      const gross = Math.floor(rand() * 120_000_000);
      const delta = Math.floor(rand() * 2_000_000) + 1;
      assert.ok(terMonthly(gross + delta, status, rs).amount >= terMonthly(gross, status, rs).amount);
    }
  });

  it('upah lembur tidak pernah turun saat jam bertambah', () => {
    const rs = resolveRuleSet('2026-09-28');
    for (const dayType of ['workday', 'rest_day'] as const) {
      let previous = 0;
      for (let half = 1; half <= 24; half++) {
        const pay = overtimePay([{ date: '2026-09-01', hours: half / 2, dayType }], 5_800_000, '6_DAY', rs);
        assert.ok(pay > previous, `${dayType} ${half / 2} jam`);
        previous = pay;
      }
    }
  });

  it('bruto pajak = bruto tunai (tanpa koreksi non-pajak) + iuran pemberi kerja yang kena pajak', () => {
    for (const { input, r } of okResults) {
      const nonTaxable = input.adjustments.filter((a) => !a.taxable).reduce((a, x) => a + x.amount, 0);
      const employerTaxable = r.employerContributions.filter((c) => ['BPJS_KES_ER', 'JKK_ER', 'JKM_ER'].includes(c.code)).reduce((a, c) => a + c.amount, 0);
      assert.equal(r.taxableGross, r.grossPay - nonTaxable + employerTaxable);
    }
  });
});
