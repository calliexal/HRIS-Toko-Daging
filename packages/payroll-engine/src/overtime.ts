import type { OvertimeEntry, RuleSet, Rupiah, Warning, WorkPattern } from './types';

/**
 * Pengali upah lembur per jam ke-n (PP 35/2021 Pasal 31), dikali 10 agar integer.
 * Hari kerja: jam ke-1 1,5×, jam berikutnya 2×.
 * Hari istirahat/libur, pola 6 hari: jam 1-7 2×, jam 8 3×, jam 9-11 4×.
 *   Bila libur jatuh pada hari kerja terpendek: jam 1-5 2×, jam 6 3×, jam 7-9 4×.
 * Hari istirahat/libur, pola 5 hari: jam 1-8 2×, jam 9 3×, jam 10-12 4×.
 */
const multiplierX10 = (hourIndex: number, entry: OvertimeEntry, pattern: WorkPattern): number => {
  if (entry.dayType === 'workday') return hourIndex === 1 ? 15 : 20;
  const [normalUntil, tripleAt] =
    pattern === '5_DAY' ? [8, 9] : entry.shortestWorkday ? [5, 6] : [7, 8];
  if (hourIndex <= normalUntil) return 20;
  if (hourIndex === tripleAt) return 30;
  return 40;
};

/** Jumlah menit × pengali×10 untuk satu entri (mendukung jam pecahan, dibulatkan ke menit). */
const weightedMinutes = (entry: OvertimeEntry, pattern: WorkPattern): number => {
  let remaining = Math.round(entry.hours * 60);
  let hour = 1;
  let acc = 0;
  while (remaining > 0) {
    const minutes = Math.min(60, remaining);
    acc += minutes * multiplierX10(hour, entry, pattern);
    remaining -= minutes;
    hour += 1;
  }
  return acc;
};

/** Upah lembur total. Upah sejam = upah sebulan / 173; dibulatkan ke rupiah terdekat sekali di akhir. */
export const overtimePay = (entries: readonly OvertimeEntry[], monthlyWageBasis: Rupiah, pattern: WorkPattern, rs: RuleSet): Rupiah => {
  const weighted = entries.reduce((acc, e) => acc + weightedMinutes(e, pattern), 0);
  return Math.round((monthlyWageBasis * weighted) / (rs.overtime.hourlyDivisor * 60 * 10));
};

/** Senin awal minggu ISO untuk sebuah tanggal. */
const weekKey = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

/**
 * Batas lembur 4 jam/hari dan 18 jam/minggu (PP 35/2021 Pasal 26),
 * tidak termasuk lembur pada hari istirahat mingguan atau libur resmi.
 */
export const overtimeLimitWarnings = (entries: readonly OvertimeEntry[], rs: RuleSet): Warning[] => {
  const workday = entries.filter((e) => e.dayType === 'workday');
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  for (const e of workday) {
    perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.hours);
    perWeek.set(weekKey(e.date), (perWeek.get(weekKey(e.date)) ?? 0) + e.hours);
  }
  const warnings: Warning[] = [];
  for (const [date, hours] of perDay) {
    if (hours > rs.overtime.maxHoursPerDay) {
      warnings.push({ code: 'OVERTIME_DAILY_LIMIT', message: `Lembur ${hours} jam pada ${date} melebihi batas ${rs.overtime.maxHoursPerDay} jam/hari.` });
    }
  }
  for (const [week, hours] of perWeek) {
    if (hours > rs.overtime.maxHoursPerWeek) {
      warnings.push({ code: 'OVERTIME_WEEKLY_LIMIT', message: `Lembur ${hours} jam pada minggu mulai ${week} melebihi batas ${rs.overtime.maxHoursPerWeek} jam/minggu.` });
    }
  }
  return warnings;
};
