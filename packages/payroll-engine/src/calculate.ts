import { bpjsContributions, PENSION_EMPLOYEE_CODES, TAXABLE_EMPLOYER_CODES } from './bpjs';
import { canonicalJson, sha256 } from './hash';
import { groupThousands, sum } from './math';
import { overtimeLimitWarnings, overtimePay } from './overtime';
import { resolveRuleSet, RULESETS } from './rulesets';
import { annualFinal, terDaily, terMonthly } from './tax';
import type { EmployeePayrollInput, EmployeePayrollResult, MoneyLine, ReviewIssue, RuleSet, Rupiah, TaxComputation, Warning } from './types';

/** Naikkan setiap kali RUMUS berubah (bukan parameter). Tersimpan di setiap slip untuk audit. */
export const ENGINE_VERSION = '1.0.0';

const line = (code: string, label: string, amount: Rupiah): MoneyLine => ({ code, label, amount });

const reviewIssues = (input: EmployeePayrollInput): ReviewIssue[] => {
  const issues: ReviewIssue[] = [];
  if (!input.ptkpStatus) issues.push({ code: 'MISSING_PTKP', message: 'Status PTKP kosong. Lengkapi di data karyawan.' });
  if (input.employmentType === 'HARIAN' ? !input.daily : !input.monthly) {
    issues.push({ code: 'MISSING_WAGE', message: 'Data upah belum diisi untuk status kerja ini.' });
  }
  if (input.employmentType !== 'HARIAN' && input.taxMonthKind === 'final' && input.period.month > 1 && !input.yearToDate) {
    issues.push({ code: 'MISSING_YTD', message: 'Data penghasilan Januari s.d. bulan lalu belum ada; PPh 21 tahunan tidak bisa dihitung.' });
  }
  if (input.employmentType === 'HARIAN' && input.daily) {
    const rs = resolveRuleSet(input.period.payDate);
    if (input.daily.dailyWage > rs.terDailyMaxDailyWage) {
      issues.push({ code: 'DAILY_WAGE_ABOVE_TER', message: 'Upah harian di atas batas TER harian; perlu perhitungan Pasal 17 manual.' });
    }
  }
  return issues;
};

/** Upah sebulan untuk dasar lembur & BPJS: pokok + tunjangan tetap (harian: upah harian × faktor pola kerja). */
const monthlyWageBasis = (input: EmployeePayrollInput, rs: RuleSet): Rupiah =>
  input.employmentType === 'HARIAN'
    ? (input.daily?.dailyWage ?? 0) * rs.dailyToMonthlyFactor[input.workPattern]
    : (input.monthly?.basicSalary ?? 0) + sum((input.monthly?.fixedAllowances ?? []).map((a) => a.amount));

const baseEarnings = (input: EmployeePayrollInput): MoneyLine[] => {
  const { scheduledWorkDays, daysPresent, unpaidAbsenceDays, employedWorkDays } = input.attendance;
  if (input.employmentType === 'HARIAN') {
    const wage = input.daily?.dailyWage ?? 0;
    return [line('DAILY_WAGE', `Upah harian · ${daysPresent} hari`, wage * daysPresent)];
  }
  const monthly = input.monthly!;
  // Prorata hari kerja untuk karyawan yang masuk/keluar di tengah periode.
  const ratio = employedWorkDays !== undefined && scheduledWorkDays > 0 ? Math.min(1, employedWorkDays / scheduledWorkDays) : 1;
  const prorated = (amount: Rupiah) => Math.round(amount * ratio);
  const lines = [
    line('BASIC', ratio < 1 ? `Gaji pokok (prorata ${employedWorkDays}/${scheduledWorkDays} hari)` : 'Gaji pokok', prorated(monthly.basicSalary)),
    ...monthly.fixedAllowances.map((a) => line(a.code, a.label, prorated(a.amount))),
  ];
  if (unpaidAbsenceDays > 0 && scheduledWorkDays > 0) {
    const fixedTotal = monthly.basicSalary + sum(monthly.fixedAllowances.map((a) => a.amount));
    lines.push(line('UNPAID_ABSENCE', `Potongan mangkir · ${unpaidAbsenceDays} hari`, -Math.round((fixedTotal * unpaidAbsenceDays) / scheduledWorkDays)));
  }
  return lines;
};

const wageWarnings = (input: EmployeePayrollInput, rs: RuleSet, basis: Rupiah): Warning[] => {
  const warnings: Warning[] = [];
  const minimum = rs.minimumWage[input.regionCode];
  if (minimum !== undefined && basis < minimum) {
    warnings.push({ code: 'BELOW_MINIMUM_WAGE', message: `Upah sebulan Rp${groupThousands(basis)} di bawah upah minimum ${input.regionCode} Rp${groupThousands(minimum)}.` });
  }
  if (input.monthly && basis > 0 && input.monthly.basicSalary * 100 < basis * 75) {
    warnings.push({ code: 'BASIC_BELOW_75_PERCENT', message: 'Gaji pokok kurang dari 75% dari gaji pokok + tunjangan tetap (PP 36/2021).' });
  }
  return warnings;
};

/**
 * Menghitung payroll satu karyawan untuk satu periode. Pure function:
 * input sama + RuleSet sama → output sama (dibuktikan dengan outputHash).
 */
export const calculateEmployeePayroll = (input: EmployeePayrollInput, rulesets: readonly RuleSet[] = RULESETS): EmployeePayrollResult => {
  const rs = resolveRuleSet(input.period.payDate, rulesets);
  const inputHash = sha256(canonicalJson({ input, ruleset: rs.version, engine: ENGINE_VERSION }));

  const issues = reviewIssues(input);
  if (issues.length > 0) return { status: 'needs_review', employeeId: input.employeeId, issues, rulesetVersion: rs.version, inputHash };
  const ptkp = input.ptkpStatus!;

  const basis = monthlyWageBasis(input, rs);
  const earnings: MoneyLine[] = [...baseEarnings(input)];
  const totalOvertimeHours = sum(input.overtime.map((o) => o.hours));
  if (input.overtime.length > 0) {
    earnings.push(line('OVERTIME', `Lembur · ${groupThousands(totalOvertimeHours)} jam`, overtimePay(input.overtime, basis, input.workPattern, rs)));
  }
  for (const adj of input.adjustments) {
    earnings.push(line(adj.taxable ? 'ADJ_TAXABLE' : 'ADJ_NON_TAXABLE', adj.sourcePeriod ? `${adj.label} (koreksi ${adj.sourcePeriod})` : adj.label, adj.amount));
  }
  const grossPay = sum(earnings.map((e) => e.amount));
  const nonTaxable = sum(input.adjustments.filter((a) => !a.taxable).map((a) => a.amount));

  // BPJS: harian lepas melapor upah yang benar-benar diterima bulan ini.
  const reportedWage = input.employmentType === 'HARIAN' ? (input.daily?.dailyWage ?? 0) * input.attendance.daysPresent : basis;
  const bpjs = bpjsContributions(input, reportedWage, rs);
  const taxableEmployer = sum(bpjs.employer.filter((c) => TAXABLE_EMPLOYER_CODES.has(c.code)).map((c) => c.amount));
  const taxableGross = grossPay - nonTaxable + taxableEmployer;
  const pensionEmployee = sum(bpjs.employee.filter((c) => PENSION_EMPLOYEE_CODES.has(c.code)).map((c) => c.amount));

  let tax: TaxComputation;
  if (input.employmentType === 'HARIAN') {
    tax = terDaily(input.daily!.dailyWage, input.attendance.daysPresent, rs);
  } else if (input.taxMonthKind === 'final') {
    const ytd = input.yearToDate ?? { taxableGross: 0, pph21Withheld: 0, employeePensionContributions: 0, monthsEmployed: 0 };
    tax = annualFinal({ taxableGross, employeePensionContributions: pensionEmployee }, ytd, ptkp, rs);
  } else {
    tax = terMonthly(taxableGross, ptkp, rs);
  }

  const deductions: MoneyLine[] = [
    ...bpjs.employee,
    tax.amount >= 0
      ? line('PPH21', tax.method === 'ANNUAL' ? 'PPh 21 (hitung ulang tahunan)' : tax.method === 'TER_DAILY' ? 'PPh 21 (TER harian)' : 'PPh 21 (TER)', tax.amount)
      : line('PPH21_REFUND', 'Lebih bayar PPh 21 dikembalikan', tax.amount),
    ...input.otherDeductions,
  ];
  const takeHomePay = grossPay - sum(deductions.map((d) => d.amount));

  const warnings: Warning[] = [...wageWarnings(input, rs, basis), ...overtimeLimitWarnings(input.overtime, rs)];
  if (tax.amount < 0) warnings.push({ code: 'TAX_OVERPAID', message: `PPh 21 setahun lebih bayar Rp${groupThousands(-tax.amount)}; dikembalikan di slip ini.` });
  if (takeHomePay < 0) warnings.push({ code: 'NEGATIVE_TAKE_HOME', message: 'Gaji diterima negatif; periksa potongan dan koreksi.' });

  const body = {
    status: 'ok' as const,
    employeeId: input.employeeId,
    engineVersion: ENGINE_VERSION,
    rulesetVersion: rs.version,
    earnings,
    grossPay,
    employerContributions: bpjs.employer,
    employeeContributions: bpjs.employee,
    taxableGross,
    tax,
    deductions,
    takeHomePay,
    warnings,
    inputHash,
  };
  return { ...body, outputHash: sha256(canonicalJson(body)) };
};
