import type { CoverageCount, ScheduleCell, ShiftCode } from '@dagingpeople/contracts';

export const WORKING_CELLS: readonly ScheduleCell[] = ['P', 'S', 'SB'];
/** 8 jam per shift termasuk istirahat 1 jam = 7 jam kerja efektif (keputusan client #1, menunggu konfirmasi). */
export const EFFECTIVE_HOURS_PER_SHIFT = 7;
/**
 * TEMUAN TERBUKA: pola 6 hari × 7 jam efektif = 42 jam, sedangkan batas UU = 40 jam/minggu
 * (pola 6 hari: 5 hari × 7 jam + 1 hari × 5 jam). Selisih 2 jam wajib dibayar lembur atau satu hari dibuat lebih pendek.
 * Sampai client memutuskan, peringatan hanya muncul bila jadwal melebihi 6 shift (42 jam).
 */
export const LEGAL_HOURS_PER_WEEK = 40;
export const MAX_SCHEDULED_HOURS = 42;
export const DAY_NAMES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] as const;

export type GridRow = { employeeId: string; name: string; cells: ScheduleCell[] };
export type Template = { code: ShiftCode; name: string; minStaff: number };

export const hoursPerWeek = (cells: readonly ScheduleCell[]) => cells.filter((c) => WORKING_CELLS.includes(c)).length * EFFECTIVE_HOURS_PER_SHIFT;

export const coverage = (rows: readonly GridRow[], templates: readonly Template[]): CoverageCount[] =>
  templates.map((t) => ({ shift: t.code, required: t.minStaff, filled: Array.from({ length: 7 }, (_, i) => rows.filter((r) => r.cells[i] === t.code).length) }));

/** Peringatan sebelum publikasi (SHF-01 AC2–AC3): understaffed, > 40 jam/minggu, 7 hari tanpa libur. */
export const scheduleWarnings = (rows: readonly GridRow[], templates: readonly Template[], days: readonly string[]): string[] => {
  const warnings: string[] = [];
  const label = (i: number) => `${DAY_NAMES[i]} ${Number(days[i]?.slice(8))}`;
  for (const c of coverage(rows, templates)) {
    const name = templates.find((t) => t.code === c.shift)?.name ?? c.shift;
    c.filled.forEach((n, i) => {
      if (n < c.required) warnings.push(`${label(i)} · Shift ${name} terisi ${n} dari ${c.required} orang`);
    });
  }
  for (const r of rows) {
    const hours = hoursPerWeek(r.cells);
    if (hours > MAX_SCHEDULED_HOURS) warnings.push(`${r.name} dijadwalkan ${hours} jam minggu ini (lebih dari 6 shift)`);
    if (r.cells.every((c) => WORKING_CELLS.includes(c))) warnings.push(`${r.name} bekerja 7 hari tanpa libur`);
  }
  return warnings;
};
