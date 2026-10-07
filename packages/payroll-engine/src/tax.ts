import { applyBpFloor, floorThousand, lookupRate, progressiveTax } from './math';
import type { PtkpStatus, RuleSet, Rupiah, TaxComputation, TerCategory, YearToDate } from './types';

/** Kategori TER menurut status PTKP (PP 58/2023 Pasal 2). */
export const terCategory = (status: PtkpStatus): TerCategory => {
  switch (status) {
    case 'TK/0':
    case 'TK/1':
    case 'K/0':
      return 'A';
    case 'TK/2':
    case 'TK/3':
    case 'K/1':
    case 'K/2':
      return 'B';
    case 'K/3':
      return 'C';
  }
};

export const ptkpAmount = (status: PtkpStatus, rs: RuleSet): Rupiah => {
  const married = status.startsWith('K/');
  const dependents = Math.min(Number(status.split('/')[1] ?? 0), rs.ptkp.maxDependents);
  return rs.ptkp.base + (married ? rs.ptkp.married : 0) + dependents * rs.ptkp.perDependent;
};

/** PPh 21 bulanan pegawai tetap (Jan s.d. Nov): bruto × TER. */
export const terMonthly = (taxableGross: Rupiah, status: PtkpStatus, rs: RuleSet): Extract<TaxComputation, { method: 'TER_MONTHLY' }> => {
  const category = terCategory(status);
  const rateBp = lookupRate(rs.ter[category], taxableGross);
  return { method: 'TER_MONTHLY', category, rateBp, base: taxableGross, amount: applyBpFloor(taxableGross, rateBp) };
};

/** PPh 21 pegawai tidak tetap yang dibayar harian: per hari bruto × TER harian. */
export const terDaily = (dailyWage: Rupiah, days: number, rs: RuleSet): Extract<TaxComputation, { method: 'TER_DAILY' }> => {
  const rateBp = lookupRate(rs.terDaily, dailyWage);
  const tax = applyBpFloor(dailyWage, rateBp);
  return { method: 'TER_DAILY', dailyLines: { wage: dailyWage, rateBp, tax }, days, amount: tax * days };
};

/**
 * PPh 21 masa pajak terakhir (Desember atau bulan terakhir bekerja):
 * Pasal 17 atas PKP setahun, dikurangi PPh 21 yang sudah dipotong Jan s.d. bulan sebelumnya.
 * Hasil negatif = lebih bayar yang dikembalikan ke karyawan.
 */
export const annualFinal = (
  current: { taxableGross: Rupiah; employeePensionContributions: Rupiah },
  ytd: YearToDate,
  status: PtkpStatus,
  rs: RuleSet,
): Extract<TaxComputation, { method: 'ANNUAL' }> => {
  const months = ytd.monthsEmployed + 1;
  const annualGross = ytd.taxableGross + current.taxableGross;
  const biayaJabatan = Math.min(applyBpFloor(annualGross, rs.biayaJabatan.rateBp), rs.biayaJabatan.maxMonthly * months);
  const pensionContributions = ytd.employeePensionContributions + current.employeePensionContributions;
  const ptkp = ptkpAmount(status, rs);
  const neto = annualGross - biayaJabatan - pensionContributions;
  const pkp = Math.max(0, floorThousand(neto - ptkp));
  const annualTax = progressiveTax(pkp, rs.pasal17);
  return {
    method: 'ANNUAL',
    annualGross,
    biayaJabatan,
    pensionContributions,
    ptkp,
    pkp,
    annualTax,
    withheldBefore: ytd.pph21Withheld,
    amount: annualTax - ytd.pph21Withheld,
  };
};
