/**
 * Golden test: angka dihitung manual dari aturan (lihat komentar tiap kasus), BUKAN disalin dari output engine.
 * Sebelum go-live, setiap kasus wajib ditandatangani konsultan pajak (lihat README).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateEmployeePayroll, overtimePay, progressiveTax, ptkpAmount, resolveRuleSet, terMonthly, RULESETS } from '../src/index';
import type { EmployeePayrollResult } from '../src/types';
import { jokoSeptember, wahyuApril } from './fixtures';

const ok = (r: EmployeePayrollResult) => {
  assert.equal(r.status, 'ok', r.status === 'needs_review' ? JSON.stringify(r.issues) : '');
  return r as Extract<EmployeePayrollResult, { status: 'ok' }>;
};
const amount = (lines: { code: string; amount: number }[], code: string) => lines.find((l) => l.code === code)?.amount;

describe('Golden 1 — Joko, PKWTT TK/0, September 2026', () => {
  const r = ok(calculateEmployeePayroll(jokoSeptember()));

  it('memakai RuleSet yang berlaku di tanggal bayar', () => assert.equal(r.rulesetVersion, '2026.03'));

  it('lembur 6 × 1 jam hari kerja = 6 × 1,5 × 5.800.000/173 = 301.734', () => {
    assert.equal(amount(r.earnings, 'OVERTIME'), 301_734);
    assert.equal(r.grossPay, 6_101_734);
  });

  it('iuran BPJS dari upah 5.800.000', () => {
    assert.deepEqual(
      Object.fromEntries(r.employerContributions.map((c) => [c.code, c.amount])),
      { BPJS_KES_ER: 232_000, JHT_ER: 214_600, JKK_ER: 31_320, JKM_ER: 17_400, JP_ER: 116_000 },
    );
    assert.deepEqual(Object.fromEntries(r.employeeContributions.map((c) => [c.code, c.amount])), { BPJS_KES_EE: 58_000, JHT_EE: 116_000, JP_EE: 58_000 });
  });

  it('bruto PPh 21 = gaji + lembur + BPJS Kes, JKK, JKM pemberi kerja = 6.382.454; TER A 1% = 63.824', () => {
    assert.equal(r.taxableGross, 6_382_454);
    assert.equal(r.tax.method, 'TER_MONTHLY');
    assert.equal(r.tax.method === 'TER_MONTHLY' && r.tax.rateBp, 100);
    assert.equal(r.tax.amount, 63_824);
  });

  it('take-home pay = 6.101.734 − (58.000 + 116.000 + 58.000 + 63.824) = 5.805.910', () => assert.equal(r.takeHomePay, 5_805_910));

  it('tanpa peringatan (di atas UMP DKI 2026 Rp5.729.876)', () => assert.deepEqual(r.warnings, []));
});

describe('Golden 2 — Wahyu, harian lepas, April 2027', () => {
  const r = ok(calculateEmployeePayroll(wahyuApril()));

  it('upah 22 × 180.000 = 3.960.000; PPh 21 TER harian 0% (≤ Rp450.000/hari)', () => {
    assert.equal(r.grossPay, 3_960_000);
    assert.equal(r.tax.method, 'TER_DAILY');
    assert.equal(r.tax.amount, 0);
  });

  it('BPJS TK tanpa JP: JHT 3,7%/2%, JKK sedang 0,89%, JKM 0,3%', () => {
    assert.deepEqual(Object.fromEntries(r.employerContributions.map((c) => [c.code, c.amount])), { JHT_ER: 146_520, JKK_ER: 35_244, JKM_ER: 11_880 });
    assert.equal(amount(r.employeeContributions, 'JHT_EE'), 79_200);
    assert.equal(r.takeHomePay, 3_880_800);
  });

  it('memperingatkan upah sebulan (180.000 × 25 = 4.500.000) di bawah UMP', () => {
    assert.deepEqual(r.warnings.map((w) => w.code), ['BELOW_MINIMUM_WAGE']);
  });
});

describe('Golden 3 — lembur PP 35/2021 (upah sebulan 5.800.000, sejam 33.526,01)', () => {
  const rs = resolveRuleSet('2026-09-28');
  const pay = (entry: Parameters<typeof overtimePay>[0][number], pattern: '6_DAY' | '5_DAY' = '6_DAY') => overtimePay([entry], 5_800_000, pattern, rs);

  it('hari kerja 1,5 jam = 1×1,5 + 0,5×2 = 2,5 jam upah = 83.815', () => assert.equal(pay({ date: '2026-09-01', hours: 1.5, dayType: 'workday' }), 83_815));
  it('hari libur pola 6 hari, 9 jam = 7×2 + 3 + 4 = 21 → 704.046', () => assert.equal(pay({ date: '2026-09-06', hours: 9, dayType: 'rest_day' }), 704_046));
  it('libur di hari kerja terpendek, 9 jam = 5×2 + 3 + 3×4 = 25 → 838.150', () =>
    assert.equal(pay({ date: '2026-09-05', hours: 9, dayType: 'rest_day', shortestWorkday: true }), 838_150));
  it('hari libur pola 5 hari, 10 jam = 8×2 + 3 + 4 = 23 → 771.098', () => assert.equal(pay({ date: '2026-09-06', hours: 10, dayType: 'rest_day' }, '5_DAY'), 771_098));
});

describe('Golden 4 — PPh 21 Desember (hitung ulang tahunan), TK/0', () => {
  // Jan–Nov: bruto 6.382.454/bulan, TER 63.824/bulan, JHT+JP karyawan 174.000/bulan.
  const input = {
    ...jokoSeptember(),
    period: { year: 2026, month: 12, start: '2026-11-26', end: '2026-12-25', payDate: '2026-12-28' },
    taxMonthKind: 'final' as const,
    yearToDate: { taxableGross: 6_382_454 * 11, pph21Withheld: 63_824 * 11, employeePensionContributions: 174_000 * 11, monthsEmployed: 11 },
  };
  const r = ok(calculateEmployeePayroll(input));

  it('bruto setahun 76.589.448; biaya jabatan 5% = 3.829.472; iuran pensiun 2.088.000; PKP 16.671.000', () => {
    assert.equal(r.tax.method, 'ANNUAL');
    if (r.tax.method !== 'ANNUAL') return;
    assert.equal(r.tax.annualGross, 76_589_448);
    assert.equal(r.tax.biayaJabatan, 3_829_472);
    assert.equal(r.tax.pensionContributions, 2_088_000);
    assert.equal(r.tax.ptkp, 54_000_000);
    assert.equal(r.tax.pkp, 16_671_000);
  });

  it('PPh setahun 5% × 16.671.000 = 833.550; Desember = 833.550 − 702.064 = 131.486', () => {
    assert.equal(r.tax.method === 'ANNUAL' && r.tax.annualTax, 833_550);
    assert.equal(r.tax.amount, 131_486);
  });

  it('lebih bayar dikembalikan sebagai pengurang negatif + peringatan', () => {
    const over = ok(calculateEmployeePayroll({ ...input, yearToDate: { ...input.yearToDate, pph21Withheld: 1_500_000 } }));
    assert.equal(over.tax.amount, 833_550 - 1_500_000);
    assert.equal(amount(over.deductions, 'PPH21_REFUND'), -666_450);
    assert.ok(over.warnings.some((w) => w.code === 'TAX_OVERPAID'));
  });
});

describe('Golden 5 — prorata, mangkir, koreksi, data kurang', () => {
  it('masuk di tengah periode (13/26 hari kerja) → gaji & tunjangan 50%', () => {
    const r = ok(calculateEmployeePayroll({ ...jokoSeptember(), overtime: [], attendance: { scheduledWorkDays: 26, daysPresent: 13, unpaidAbsenceDays: 0, employedWorkDays: 13 } }));
    assert.equal(amount(r.earnings, 'BASIC'), 2_750_000);
    assert.equal(amount(r.earnings, 'ALW_POSITION'), 150_000);
  });

  it('mangkir 2 hari → potongan 5.800.000 × 2/26 = 446.154', () => {
    const r = ok(calculateEmployeePayroll({ ...jokoSeptember(), overtime: [], attendance: { scheduledWorkDays: 26, daysPresent: 24, unpaidAbsenceDays: 2 } }));
    assert.equal(amount(r.earnings, 'UNPAID_ABSENCE'), -446_154);
  });

  it('koreksi retro kena pajak menambah bruto; koreksi tidak kena pajak tidak', () => {
    const base = ok(calculateEmployeePayroll(jokoSeptember()));
    const taxable = ok(calculateEmployeePayroll({ ...jokoSeptember(), adjustments: [{ label: 'Lembur 6 Sep belum dibayar', amount: 100_000, taxable: true, sourcePeriod: '2026-08' }] }));
    const reimburse = ok(calculateEmployeePayroll({ ...jokoSeptember(), adjustments: [{ label: 'Penggantian ongkos', amount: 100_000, taxable: false }] }));
    assert.equal(taxable.taxableGross, base.taxableGross + 100_000);
    assert.equal(reimburse.taxableGross, base.taxableGross);
    assert.equal(reimburse.takeHomePay, base.takeHomePay + 100_000);
  });

  it('PTKP kosong → needs_review, tidak memblokir proses lain', () => {
    const r = calculateEmployeePayroll({ ...jokoSeptember(), ptkpStatus: null });
    assert.equal(r.status, 'needs_review');
    assert.deepEqual(r.status === 'needs_review' && r.issues.map((i) => i.code), ['MISSING_PTKP']);
  });

  it('bulan final tanpa data YTD → needs_review', () => {
    const r = calculateEmployeePayroll({ ...jokoSeptember(), taxMonthKind: 'final' });
    assert.deepEqual(r.status === 'needs_review' && r.issues.map((i) => i.code), ['MISSING_YTD']);
  });
});

describe('Tabel & parameter regulasi', () => {
  const rs = resolveRuleSet('2026-09-28');

  it('batas bawah TER tiap kategori', () => {
    assert.equal(terMonthly(5_400_000, 'TK/0', rs).rateBp, 0);
    assert.equal(terMonthly(5_400_001, 'TK/0', rs).rateBp, 25);
    assert.equal(terMonthly(6_200_000, 'K/1', rs).rateBp, 0);
    assert.equal(terMonthly(6_200_001, 'TK/2', rs).rateBp, 25);
    assert.equal(terMonthly(6_600_000, 'K/3', rs).rateBp, 0);
    assert.equal(terMonthly(6_600_001, 'K/3', rs).rateBp, 25);
    assert.equal(terMonthly(2_000_000_000, 'K/0', rs).rateBp, 3400);
  });

  it('PTKP', () => {
    assert.equal(ptkpAmount('TK/0', rs), 54_000_000);
    assert.equal(ptkpAmount('TK/2', rs), 63_000_000);
    assert.equal(ptkpAmount('K/0', rs), 58_500_000);
    assert.equal(ptkpAmount('K/3', rs), 72_000_000);
  });

  it('Pasal 17 berlapis', () => {
    assert.equal(progressiveTax(60_000_000, rs.pasal17), 3_000_000);
    assert.equal(progressiveTax(250_000_000, rs.pasal17), 31_500_000);
    assert.equal(progressiveTax(500_000_000, rs.pasal17), 94_000_000);
    assert.equal(progressiveTax(600_000_000, rs.pasal17), 124_000_000);
    assert.equal(progressiveTax(0, rs.pasal17), 0);
  });

  it('batas upah BPJS Kesehatan 12 juta dan JP sesuai tanggal', () => {
    const highEarner = (payDate: string) =>
      ok(calculateEmployeePayroll({ ...jokoSeptember(), overtime: [], monthly: { basicSalary: 15_000_000, fixedAllowances: [] }, period: { ...jokoSeptember().period, payDate } }));
    const sep = highEarner('2026-09-28');
    assert.equal(amount(sep.employeeContributions, 'BPJS_KES_EE'), 120_000);
    assert.equal(amount(sep.employerContributions, 'BPJS_KES_ER'), 480_000);
    assert.equal(amount(sep.employeeContributions, 'JP_EE'), 110_863);
    assert.equal(amount(highEarner('2026-02-27').employeeContributions, 'JP_EE'), 105_474);
  });

  it('RuleSet dipilih per tanggal; sebelum RuleSet pertama ditolak', () => {
    assert.equal(resolveRuleSet('2026-02-28').version, '2026.01');
    assert.equal(resolveRuleSet('2026-03-01').version, '2026.03');
    assert.equal(resolveRuleSet('2025-12-31').version, '2025.03');
    assert.throws(() => resolveRuleSet('2025-01-01'));
    assert.ok(RULESETS.every((r) => r.sources.length > 0));
  });

  it('peringatan batas lembur 4 jam/hari & 18 jam/minggu (hari libur tidak dihitung)', () => {
    const day = ok(calculateEmployeePayroll({ ...jokoSeptember(), overtime: [{ date: '2026-09-01', hours: 5, dayType: 'workday' }] }));
    assert.deepEqual(day.warnings.map((w) => w.code), ['OVERTIME_DAILY_LIMIT']);
    const week = ok(
      calculateEmployeePayroll({
        ...jokoSeptember(),
        overtime: [
          ...['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map((date) => ({ date, hours: 4, dayType: 'workday' as const })),
          { date: '2026-09-13', hours: 8, dayType: 'rest_day' as const },
        ],
      }),
    );
    assert.deepEqual(week.warnings.map((w) => w.code), ['OVERTIME_WEEKLY_LIMIT']);
  });
});
