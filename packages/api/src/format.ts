import type { ClockTime, ISODate, Rupiah } from './types';

const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;
const DAYS_LONG = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'] as const;
const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'] as const;

/** Mem-parse 'YYYY-MM-DD' sebagai tanggal kalender (UTC) agar tidak bergeser oleh zona waktu perangkat. */
const parseDate = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
};

/** Rp4.850.000 (tanpa spasi, tanpa desimal). Nilai negatif: −Rp58.000 */
export const formatRupiah = (amount: Rupiah): string => {
  const abs = Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${amount < 0 ? '−' : ''}Rp${abs}`;
};

/** '05:58' → '05.58' (format jam Indonesia). */
export const formatClock = (time: ClockTime): string => time.replace(':', '.');

/** 'Rab, 7 Okt 2026' */
export const formatDateShort = (iso: ISODate): string => {
  const d = parseDate(iso);
  return `${DAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** 'Rabu, 7 Oktober 2026' */
export const formatDateLong = (iso: ISODate): string => {
  const d = parseDate(iso);
  return `${DAYS_LONG[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** { weekday: 'Rab', day: 7 } untuk kolom jadwal. */
export const dayParts = (iso: ISODate) => {
  const d = parseDate(iso);
  return { weekday: DAYS_SHORT[d.getUTCDay()] ?? '', day: d.getUTCDate(), month: MONTHS_SHORT[d.getUTCMonth()] ?? '' };
};

/** '5–11 Okt 2026' atau '28 Sep–4 Okt 2026' */
export const formatRange = (startIso: ISODate, endIso: ISODate): string => {
  const s = parseDate(startIso);
  const e = parseDate(endIso);
  const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
  const startLabel = sameMonth ? `${s.getUTCDate()}` : `${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]}`;
  return `${startLabel}–${e.getUTCDate()} ${MONTHS_SHORT[e.getUTCMonth()]} ${e.getUTCFullYear()}`;
};

export const addDays = (iso: ISODate, days: number): ISODate => {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Selisih menit antara dua jam 'HH:mm'. */
export const minutesBetween = (from: ClockTime, to: ClockTime): number => {
  const toMin = (t: ClockTime) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return toMin(to) - toMin(from);
};

/** Menambah detik ke jam 'HH:mm:ss' / 'HH:mm' dan mengembalikan 'HH:mm'. */
export const addSecondsToClock = (time: ClockTime, seconds: number): ClockTime => {
  const [h = 0, m = 0, s = 0] = time.split(':').map(Number);
  const total = (((h * 3600 + m * 60 + s + seconds) % 86400) + 86400) % 86400;
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const formatDistance = (meters: number): string =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters)} m`;
