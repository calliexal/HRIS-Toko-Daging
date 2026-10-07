import { addDays, addSecondsToClock, type ClockTime, type ISODate } from '@dagingpeople/api';

export type ServerNow = {
  date: ISODate;
  /** 'HH:mm' */
  time: ClockTime;
  /** 'HH:mm:ss', untuk deviceEventTime. */
  timeWithSeconds: string;
};

/**
 * Jam server yang dihitung maju dengan jam monotonik perangkat (performance.now()).
 * Mengubah jam HP tidak memengaruhi jam yang tampil maupun waktu event absen (ATT-01).
 */
export type ServerClock = {
  anchor(date: ISODate, time: ClockTime): void;
  now(): ServerNow | null;
  subscribe(listener: () => void): () => void;
};

const toSeconds = (time: string) => {
  const [h = 0, m = 0, s = 0] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

const pad = (n: number) => String(n).padStart(2, '0');

export const createServerClock = (monotonicMs: () => number): ServerClock => {
  let base: { date: ISODate; seconds: number; at: number } | null = null;
  const listeners = new Set<() => void>();

  return {
    anchor: (date, time) => {
      base = { date, seconds: toSeconds(time), at: monotonicMs() };
      listeners.forEach((l) => l());
    },
    now: () => {
      if (!base) return null;
      const elapsed = Math.max(0, Math.floor((monotonicMs() - base.at) / 1000));
      const total = base.seconds + elapsed;
      const s = total % 60;
      return {
        date: addDays(base.date, Math.floor(total / 86400)),
        time: addSecondsToClock('00:00:00', total),
        timeWithSeconds: `${addSecondsToClock('00:00:00', total)}:${pad(s)}`,
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/** ISO 8601 dengan zona WIB, mis. '2026-10-07T05:53:12+07:00'. */
export const toEventTimestamp = (now: ServerNow): string => `${now.date}T${now.timeWithSeconds}+07:00`;
