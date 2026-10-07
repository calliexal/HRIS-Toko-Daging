/**
 * Semua nilai uang = integer rupiah. Semua tarif = basis poin (1% = 100 bp), agar perhitungan eksak tanpa float.
 * Tanggal = 'YYYY-MM-DD'.
 */
export type Rupiah = number;
export type BasisPoints = number;
export type ISODate = string;

export type PtkpStatus = 'TK/0' | 'TK/1' | 'TK/2' | 'TK/3' | 'K/0' | 'K/1' | 'K/2' | 'K/3';
export type TerCategory = 'A' | 'B' | 'C';
export type EmploymentType = 'PKWTT' | 'PKWT' | 'HARIAN';
export type WorkPattern = '6_DAY' | '5_DAY';
export type JkkRisk = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

/** Batas atas inklusif; `null` = tanpa batas. */
export type RateBracket = { upTo: Rupiah | null; rateBp: BasisPoints };

export type RuleSet = {
  version: string;
  effectiveFrom: ISODate;
  sources: string[];
  ter: Record<TerCategory, RateBracket[]>;
  terDaily: RateBracket[];
  /** Upah harian di atas ini tidak memakai TER harian, melainkan Pasal 17 × 50% bruto. */
  terDailyMaxDailyWage: Rupiah;
  pasal17: RateBracket[];
  ptkp: { base: Rupiah; married: Rupiah; perDependent: Rupiah; maxDependents: number };
  biayaJabatan: { rateBp: BasisPoints; maxMonthly: Rupiah };
  bpjs: {
    kesehatan: { employerBp: BasisPoints; employeeBp: BasisPoints; wageCap: Rupiah };
    jht: { employerBp: BasisPoints; employeeBp: BasisPoints };
    jp: { employerBp: BasisPoints; employeeBp: BasisPoints; wageCap: Rupiah };
    jkm: { employerBp: BasisPoints };
    jkk: Record<JkkRisk, BasisPoints>;
  };
  overtime: { hourlyDivisor: number; maxHoursPerDay: number; maxHoursPerWeek: number };
  /** Hari kerja untuk mengonversi upah harian ke upah sebulan (PP 35/2021). */
  dailyToMonthlyFactor: Record<WorkPattern, number>;
  minimumWage: Record<string, Rupiah>;
};

export type MoneyLine = { code: string; label: string; amount: Rupiah };

/** Satu blok lembur pada satu tanggal. `restDay` = hari istirahat mingguan / libur resmi. */
export type OvertimeEntry = {
  date: ISODate;
  hours: number;
  dayType: 'workday' | 'rest_day';
  /** Libur resmi yang jatuh pada hari kerja terpendek (pola 6 hari). */
  shortestWorkday?: boolean;
};

export type Adjustment = {
  label: string;
  amount: Rupiah;
  /** Koreksi dari periode yang sudah dikunci (retro). Dipajaki di masa pembayaran. */
  sourcePeriod?: string;
  taxable: boolean;
};

/** Data Januari s.d. bulan sebelumnya pada tahun pajak yang sama; wajib untuk perhitungan tahunan. */
export type YearToDate = {
  taxableGross: Rupiah;
  pph21Withheld: Rupiah;
  /** Iuran JHT + JP yang dibayar karyawan (pengurang penghasilan neto). */
  employeePensionContributions: Rupiah;
  monthsEmployed: number;
};

export type EmployeePayrollInput = {
  employeeId: string;
  employmentType: EmploymentType;
  ptkpStatus: PtkpStatus | null;
  workPattern: WorkPattern;
  jkkRisk: JkkRisk;
  regionCode: string;
  period: { year: number; month: number; start: ISODate; end: ISODate; payDate: ISODate };
  /** Karyawan bulanan (PKWTT/PKWT). */
  monthly?: { basicSalary: Rupiah; fixedAllowances: MoneyLine[] };
  /** Karyawan harian lepas. */
  daily?: { dailyWage: Rupiah };
  attendance: {
    /** Hari kerja terjadwal dalam periode (untuk prorata dan potongan mangkir). */
    scheduledWorkDays: number;
    daysPresent: number;
    /** Hari terjadwal yang tidak dibayar (mangkir tanpa keterangan). */
    unpaidAbsenceDays: number;
    /** Untuk karyawan masuk/keluar di tengah periode: hari kerja terjadwal selama masih bekerja. */
    employedWorkDays?: number;
  };
  overtime: OvertimeEntry[];
  bpjsEnrollment: { kesehatan: boolean; ketenagakerjaan: boolean; pensiun: boolean };
  adjustments: Adjustment[];
  otherDeductions: MoneyLine[];
  /**
   * 'final' = masa pajak terakhir (Desember atau bulan terakhir karyawan berhenti):
   * PPh 21 dihitung ulang setahun dengan tarif Pasal 17.
   */
  taxMonthKind: 'regular' | 'final';
  yearToDate?: YearToDate;
};

export type ReviewIssue = { code: 'MISSING_PTKP' | 'MISSING_WAGE' | 'MISSING_YTD' | 'DAILY_WAGE_ABOVE_TER'; message: string };

export type Warning = {
  code: 'BELOW_MINIMUM_WAGE' | 'BASIC_BELOW_75_PERCENT' | 'OVERTIME_DAILY_LIMIT' | 'OVERTIME_WEEKLY_LIMIT' | 'TAX_OVERPAID' | 'NEGATIVE_TAKE_HOME';
  message: string;
};

export type TaxComputation =
  | { method: 'TER_MONTHLY'; category: TerCategory; rateBp: BasisPoints; base: Rupiah; amount: Rupiah }
  | { method: 'TER_DAILY'; dailyLines: { wage: Rupiah; rateBp: BasisPoints; tax: Rupiah }; days: number; amount: Rupiah }
  | {
      method: 'ANNUAL';
      annualGross: Rupiah;
      biayaJabatan: Rupiah;
      pensionContributions: Rupiah;
      ptkp: Rupiah;
      pkp: Rupiah;
      annualTax: Rupiah;
      withheldBefore: Rupiah;
      amount: Rupiah;
    };

export type EmployeePayrollResult =
  | { status: 'needs_review'; employeeId: string; issues: ReviewIssue[]; rulesetVersion: string; inputHash: string }
  | {
      status: 'ok';
      employeeId: string;
      engineVersion: string;
      rulesetVersion: string;
      earnings: MoneyLine[];
      grossPay: Rupiah;
      employerContributions: MoneyLine[];
      employeeContributions: MoneyLine[];
      /** Penghasilan bruto untuk PPh 21: gaji + lembur + premi JKK, JKM, dan BPJS Kesehatan yang dibayar pemberi kerja. */
      taxableGross: Rupiah;
      tax: TaxComputation;
      deductions: MoneyLine[];
      takeHomePay: Rupiah;
      warnings: Warning[];
      inputHash: string;
      outputHash: string;
    };
