import type { ISODate, RateBracket, RuleSet } from './types';

/**
 * RuleSet berversi. Rumus ada di kode (dengan ENGINE_VERSION), parameter ada di sini (ADR-03).
 * Setiap perubahan regulasi = RuleSet baru dengan `effectiveFrom`, BUKAN mengubah yang lama:
 * slip periode lampau harus bisa dihitung ulang persis sama.
 *
 * WAJIB diverifikasi konsultan pajak sebelum go-live. Sumber dicatat per versi.
 */

const pct = (percent: number) => Math.round(percent * 100);
const brackets = (rows: Array<[number | null, number]>): RateBracket[] => rows.map(([upTo, rate]) => ({ upTo, rateBp: pct(rate) }));

// Lampiran PP 58/2023 — TER bulanan. [batas atas inklusif, tarif %]
const TER_A = brackets([
  [5_400_000, 0], [5_650_000, 0.25], [5_950_000, 0.5], [6_300_000, 0.75], [6_750_000, 1], [7_500_000, 1.25],
  [8_550_000, 1.5], [9_650_000, 1.75], [10_050_000, 2], [10_350_000, 2.25], [10_700_000, 2.5], [11_050_000, 3],
  [11_600_000, 3.5], [12_500_000, 4], [13_750_000, 5], [15_100_000, 6], [16_950_000, 7], [19_750_000, 8],
  [24_150_000, 9], [26_450_000, 10], [28_000_000, 11], [30_050_000, 12], [32_400_000, 13], [35_400_000, 14],
  [39_100_000, 15], [43_850_000, 16], [47_800_000, 17], [51_400_000, 18], [56_300_000, 19], [62_200_000, 20],
  [68_600_000, 21], [77_500_000, 22], [89_000_000, 23], [103_000_000, 24], [125_000_000, 25], [157_000_000, 26],
  [206_000_000, 27], [337_000_000, 28], [454_000_000, 29], [550_000_000, 30], [695_000_000, 31], [910_000_000, 32],
  [1_400_000_000, 33], [null, 34],
]);

const TER_B = brackets([
  [6_200_000, 0], [6_500_000, 0.25], [6_850_000, 0.5], [7_300_000, 0.75], [9_200_000, 1], [10_750_000, 1.5],
  [11_250_000, 2], [11_600_000, 2.5], [12_600_000, 3], [13_600_000, 4], [14_950_000, 5], [16_400_000, 6],
  [18_450_000, 7], [21_850_000, 8], [26_000_000, 9], [27_700_000, 10], [29_350_000, 11], [31_450_000, 12],
  [33_950_000, 13], [37_100_000, 14], [41_100_000, 15], [45_800_000, 16], [49_500_000, 17], [53_800_000, 18],
  [58_500_000, 19], [64_000_000, 20], [71_000_000, 21], [80_000_000, 22], [93_000_000, 23], [109_000_000, 24],
  [129_000_000, 25], [163_000_000, 26], [211_000_000, 27], [374_000_000, 28], [459_000_000, 29], [555_000_000, 30],
  [704_000_000, 31], [957_000_000, 32], [1_405_000_000, 33], [null, 34],
]);

const TER_C = brackets([
  [6_600_000, 0], [6_950_000, 0.25], [7_350_000, 0.5], [7_800_000, 0.75], [8_850_000, 1], [9_800_000, 1.25],
  [10_950_000, 1.5], [11_200_000, 1.75], [12_050_000, 2], [12_950_000, 3], [14_150_000, 4], [15_550_000, 5],
  [17_050_000, 6], [19_500_000, 7], [22_700_000, 8], [26_600_000, 9], [28_100_000, 10], [30_100_000, 11],
  [32_600_000, 12], [35_400_000, 13], [38_900_000, 14], [43_000_000, 15], [47_400_000, 16], [51_200_000, 17],
  [55_800_000, 18], [60_400_000, 19], [66_700_000, 20], [74_500_000, 21], [83_200_000, 22], [95_600_000, 23],
  [110_000_000, 24], [134_000_000, 25], [169_000_000, 26], [221_000_000, 27], [390_000_000, 28], [463_000_000, 29],
  [561_000_000, 30], [709_000_000, 31], [965_000_000, 32], [1_419_000_000, 33], [null, 34],
]);

const BASE_SOURCES = [
  'PP 58/2023 & PMK 168/2023 (TER PPh 21, PTKP, biaya jabatan)',
  'UU 7/2021 HPP (tarif Pasal 17)',
  'PP 35/2021 Pasal 31-32 (upah lembur, faktor upah harian)',
  'Perpres 82/2018 jo. 64/2020 (BPJS Kesehatan 5%, batas upah Rp12 juta)',
  'PP 44, 45, 46/2015 & perubahannya (JKK, JKM, JHT, JP); bpjsketenagakerjaan.go.id artikel 18913 (tarif JKK 0,24%-1,74% tetap dibayar penuh, rekomposisi JKP internal)',
];

const base = {
  ter: { A: TER_A, B: TER_B, C: TER_C },
  terDaily: brackets([[450_000, 0], [2_500_000, 0.5]]),
  terDailyMaxDailyWage: 2_500_000,
  pasal17: brackets([[60_000_000, 5], [250_000_000, 15], [500_000_000, 25], [5_000_000_000, 30], [null, 35]]),
  ptkp: { base: 54_000_000, married: 4_500_000, perDependent: 4_500_000, maxDependents: 3 },
  biayaJabatan: { rateBp: pct(5), maxMonthly: 500_000 },
  bpjs: {
    kesehatan: { employerBp: pct(4), employeeBp: pct(1), wageCap: 12_000_000 },
    jht: { employerBp: pct(3.7), employeeBp: pct(2) },
    jp: { employerBp: pct(2), employeeBp: pct(1), wageCap: 10_547_400 },
    jkm: { employerBp: pct(0.3) },
    jkk: { very_low: pct(0.24), low: pct(0.54), medium: pct(0.89), high: pct(1.27), very_high: pct(1.74) },
  },
  overtime: { hourlyDivisor: 173, maxHoursPerDay: 4, maxHoursPerWeek: 18 },
  dailyToMonthlyFactor: { '6_DAY': 25, '5_DAY': 21 },
} satisfies Omit<RuleSet, 'version' | 'effectiveFrom' | 'sources' | 'minimumWage'>;

export const RULESETS: readonly RuleSet[] = [
  {
    ...base,
    version: '2025.03',
    effectiveFrom: '2025-03-01',
    sources: [...BASE_SOURCES, 'Batas upah JP Rp10.547.400 berlaku 1 Mar 2025'],
    minimumWage: { DKI_JAKARTA: 5_396_761 },
  },
  {
    ...base,
    version: '2026.01',
    effectiveFrom: '2026-01-01',
    sources: [...BASE_SOURCES, 'Batas upah JP Rp10.547.400', 'UMP DKI Jakarta 2026 Rp5.729.876'],
    minimumWage: { DKI_JAKARTA: 5_729_876 },
  },
  {
    ...base,
    bpjs: { ...base.bpjs, jp: { ...base.bpjs.jp, wageCap: 11_086_300 } },
    version: '2026.03',
    effectiveFrom: '2026-03-01',
    sources: [
      ...BASE_SOURCES,
      'Batas upah JP Rp11.086.300 mulai Mar 2026 (sosialisasi BPJS TK; PERLU VERIFIKASI terhadap KEPDIR resmi)',
      'UMP DKI Jakarta 2026 Rp5.729.876',
    ],
    minimumWage: { DKI_JAKARTA: 5_729_876 },
  },
];

/** RuleSet yang berlaku pada tanggal tertentu (pajak & BPJS memakai tanggal bayar). */
export const resolveRuleSet = (date: ISODate, rulesets: readonly RuleSet[] = RULESETS): RuleSet => {
  const applicable = rulesets.filter((r) => r.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const found = applicable[0];
  if (!found) throw new Error(`Tidak ada RuleSet yang berlaku pada ${date}.`);
  return found;
};
