import type { TodayShift } from '@dagingpeople/api';

/**
 * Cache shift hari ini agar Beranda tetap bisa dipakai saat aplikasi dibuka tanpa sinyal (ATT-01 AC3).
 * `savedAt` memakai jam HP hanya untuk memperkirakan jam server saat cold start offline;
 * event offline tetap ditinjau server (deviceEventTime + flag offline).
 */
type Cached = { today: TodayShift; savedAt: number };

const KEY = 'dp.employee.today.v1';

export const saveToday = (today: TodayShift): void => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ today, savedAt: Date.now() } satisfies Cached));
  } catch {
    // Penyimpanan tidak tersedia: lanjut tanpa cache.
  }
};

export const loadToday = (): Cached | null => {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed === 'object' && parsed !== null && 'today' in parsed && 'savedAt' in parsed) return parsed as Cached;
    return null;
  } catch {
    return null;
  }
};

/** Dipanggil saat keluar: shift hari ini milik pengguna sebelumnya tidak boleh tampil ke pengguna berikutnya. */
export const clearToday = (): void => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // abaikan
  }
};
