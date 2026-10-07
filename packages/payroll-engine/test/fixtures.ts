import type { EmployeePayrollInput } from '../src/types';

/** Joko Prasetyo, Butcher Outlet Kemang, TK/0, periode September 2026, 6 × 1 jam lembur hari kerja. */
export const jokoSeptember = (): EmployeePayrollInput => ({
  employeeId: 'joko',
  employmentType: 'PKWTT',
  ptkpStatus: 'TK/0',
  workPattern: '6_DAY',
  jkkRisk: 'low',
  regionCode: 'DKI_JAKARTA',
  period: { year: 2026, month: 9, start: '2026-08-26', end: '2026-09-25', payDate: '2026-09-28' },
  monthly: { basicSalary: 5_500_000, fixedAllowances: [{ code: 'ALW_POSITION', label: 'Tunjangan tetap', amount: 300_000 }] },
  attendance: { scheduledWorkDays: 26, daysPresent: 26, unpaidAbsenceDays: 0 },
  overtime: ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17'].map((date) => ({ date, hours: 1, dayType: 'workday' as const })),
  bpjsEnrollment: { kesehatan: true, ketenagakerjaan: true, pensiun: true },
  adjustments: [],
  otherDeductions: [],
  taxMonthKind: 'regular',
});

/** Wahyu Hidayat, harian lepas gudang, Rp180.000/hari × 22 hari, hanya BPJS Ketenagakerjaan (tanpa JP). */
export const wahyuApril = (): EmployeePayrollInput => ({
  employeeId: 'wahyu',
  employmentType: 'HARIAN',
  ptkpStatus: 'TK/0',
  workPattern: '6_DAY',
  jkkRisk: 'medium',
  regionCode: 'DKI_JAKARTA',
  period: { year: 2027, month: 4, start: '2027-03-26', end: '2027-04-25', payDate: '2027-04-28' },
  daily: { dailyWage: 180_000 },
  attendance: { scheduledWorkDays: 26, daysPresent: 22, unpaidAbsenceDays: 0 },
  overtime: [],
  bpjsEnrollment: { kesehatan: false, ketenagakerjaan: true, pensiun: false },
  adjustments: [],
  otherDeductions: [],
  taxMonthKind: 'regular',
});
