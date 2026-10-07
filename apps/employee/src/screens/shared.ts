import { formatClock, type ShiftTemplate, type TodayShift } from '@dagingpeople/api';

export const shiftLabel = (shift: ShiftTemplate | null | undefined): string =>
  shift ? `${shift.name} · ${formatClock(shift.start)}–${formatClock(shift.end)}` : 'Tanpa shift';

/** Data cadangan untuk layar Hasil saat absen disimpan offline (server belum menjawab). */
export const offlineFallback = (today: TodayShift | undefined, locationName?: string) => ({
  locationName: locationName ?? today?.location.name ?? 'Lokasi kerja Anda',
  // Tanpa data shift (mis. offline sejak aplikasi dibuka): jangan menebak; server mencocokkan saat terkirim.
  shiftLabel: today ? shiftLabel(today.shift) : 'Sesuai jadwal hari ini',
});

export const directionLabel = (direction: 'in' | 'out') => (direction === 'in' ? 'Absen Masuk' : 'Absen Pulang');
