import { applyBpRound } from './math';
import type { EmployeePayrollInput, MoneyLine, RuleSet, Rupiah } from './types';

export type BpjsResult = { employer: MoneyLine[]; employee: MoneyLine[] };

/**
 * Iuran BPJS dari upah yang dilaporkan (upah pokok + tunjangan tetap; harian lepas: upah yang diterima bulan ini).
 * Batas upah: BPJS Kesehatan dan JP dibatasi; JHT, JKK, JKM tidak.
 */
export const bpjsContributions = (input: EmployeePayrollInput, reportedWage: Rupiah, rs: RuleSet): BpjsResult => {
  const employer: MoneyLine[] = [];
  const employee: MoneyLine[] = [];
  const { kesehatan, ketenagakerjaan, pensiun } = input.bpjsEnrollment;
  const b = rs.bpjs;

  if (kesehatan) {
    const base = Math.min(reportedWage, b.kesehatan.wageCap);
    employer.push({ code: 'BPJS_KES_ER', label: 'BPJS Kesehatan 4%', amount: applyBpRound(base, b.kesehatan.employerBp) });
    employee.push({ code: 'BPJS_KES_EE', label: 'BPJS Kesehatan 1%', amount: applyBpRound(base, b.kesehatan.employeeBp) });
  }
  if (ketenagakerjaan) {
    employer.push({ code: 'JHT_ER', label: 'BPJS JHT 3,7%', amount: applyBpRound(reportedWage, b.jht.employerBp) });
    employee.push({ code: 'JHT_EE', label: 'BPJS JHT 2%', amount: applyBpRound(reportedWage, b.jht.employeeBp) });
    employer.push({ code: 'JKK_ER', label: `BPJS JKK ${(b.jkk[input.jkkRisk] / 100).toString().replace('.', ',')}%`, amount: applyBpRound(reportedWage, b.jkk[input.jkkRisk]) });
    employer.push({ code: 'JKM_ER', label: 'BPJS JKM 0,3%', amount: applyBpRound(reportedWage, b.jkm.employerBp) });
  }
  if (ketenagakerjaan && pensiun) {
    const base = Math.min(reportedWage, b.jp.wageCap);
    employer.push({ code: 'JP_ER', label: 'BPJS JP 2%', amount: applyBpRound(base, b.jp.employerBp) });
    employee.push({ code: 'JP_EE', label: 'BPJS JP 1%', amount: applyBpRound(base, b.jp.employeeBp) });
  }
  return { employer, employee };
};

/** Bagian iuran pemberi kerja yang menjadi penghasilan bruto untuk PPh 21 (PMK 168/2023): JKK, JKM, BPJS Kesehatan. */
export const TAXABLE_EMPLOYER_CODES = new Set(['BPJS_KES_ER', 'JKK_ER', 'JKM_ER']);

/** Iuran karyawan yang menjadi pengurang penghasilan neto tahunan: JHT dan JP. */
export const PENSION_EMPLOYEE_CODES = new Set(['JHT_EE', 'JP_EE']);
