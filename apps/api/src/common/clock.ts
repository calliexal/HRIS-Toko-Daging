/** Sumber waktu yang bisa diganti saat uji. Semua keputusan waktu memakai jam server, bukan jam perangkat. */
export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

export const fixedClock = (iso: string): Clock & { advance(ms: number): void; set(iso: string): void } => {
  let t = new Date(iso).getTime();
  return {
    now: () => new Date(t),
    advance: (ms) => {
      t += ms;
    },
    set: (next) => {
      t = new Date(next).getTime();
    },
  };
};
