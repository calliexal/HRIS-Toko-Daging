'use client';

import { useEffect, useState } from 'react';
import { addSecondsToClock, useApi, type ClockTime, type HrisClient, type ISODate } from '@dagingpeople/api';

type ServerTime = { date: ISODate; time: ClockTime };

/**
 * Kontrak kiosk belum punya endpoint waktu server. Bila implementasi HTTP menambahkan
 * `kiosk.getServerTime()`, hook ini langsung memakainya. Untuk klien mock, waktu server
 * diambil dari `employee.getToday().serverTime` (jam mock yang sama dengan hasil absen).
 */
type ServerTimeCapable = { getServerTime?: () => Promise<ServerTime> };

const fetchServerTime = async (api: HrisClient): Promise<ServerTime | null> => {
  const kiosk = api.kiosk as HrisClient['kiosk'] & ServerTimeCapable;
  if (kiosk.getServerTime) return kiosk.getServerTime();
  if (api.isMock) {
    const today = await api.employee.getToday();
    return { date: today.date, time: today.serverTime };
  }
  return null;
};

const deviceNow = (): ServerTime => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
};

const RESYNC_MS = 5 * 60_000;

/**
 * Jam kiosk yang berdetak tiap detik, dihitung maju dari waktu server (bukan jam tablet)
 * memakai jam monotonik `performance.now()`.
 */
export const useServerClock = (): { date: ISODate | null; time: ClockTime | null; synced: boolean } => {
  const api = useApi();
  const [base, setBase] = useState<{ server: ServerTime; at: number; synced: boolean } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      try {
        const server = await fetchServerTime(api);
        if (active) setBase({ server: server ?? deviceNow(), at: performance.now(), synced: server !== null });
      } catch {
        if (active) setBase((prev) => prev ?? { server: deviceNow(), at: performance.now(), synced: false });
      }
    };
    void sync();
    const resync = setInterval(() => void sync(), RESYNC_MS);
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      active = false;
      clearInterval(resync);
      clearInterval(tick);
    };
  }, [api]);

  if (!base) return { date: null, time: null, synced: false };
  const elapsed = Math.floor((performance.now() - base.at) / 1000);
  return { date: base.server.date, time: addSecondsToClock(base.server.time, elapsed), synced: base.synced };
};
