/** Utilitas waktu berbasis zona lokasi (default Asia/Jakarta). Tanggal kerja = tanggal lokal lokasi. */
export const DEFAULT_TZ = 'Asia/Jakarta';

const parts = (date: Date, timeZone: string) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, seconds: map.second ?? '00' };
};

/** 'YYYY-MM-DD' di zona lokasi. */
export const localDate = (date: Date, timeZone = DEFAULT_TZ): string => parts(date, timeZone).date;

/** 'HH:mm' di zona lokasi. */
export const localClock = (date: Date, timeZone = DEFAULT_TZ): string => parts(date, timeZone).time;

export const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** 0 = Minggu … 6 = Sabtu. */
export const weekday = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Senin pada minggu tanggal tersebut. */
export const mondayOf = (iso: string): string => addDays(iso, -((weekday(iso) + 6) % 7));

export const minutesOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Jarak dua koordinat dalam meter (haversine). */
export const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Zona waktu Indonesia tidak memakai DST, jadi offset tetap. */
const ZONE_OFFSET: Record<string, string> = { 'Asia/Jakarta': '+07:00', 'Asia/Pontianak': '+07:00', 'Asia/Makassar': '+08:00', 'Asia/Jayapura': '+09:00' };

/** '2026-10-07' + '14:03' di zona lokasi → Date (UTC). */
export const zonedDateTime = (date: string, hhmm: string, timeZone = DEFAULT_TZ): Date =>
  new Date(`${date}T${hhmm}:00${ZONE_OFFSET[timeZone] ?? '+07:00'}`);
