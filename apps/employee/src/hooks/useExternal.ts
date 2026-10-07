import { useEffect, useState, useSyncExternalStore } from 'react';
import type { MockScenario } from '@dagingpeople/api';
import { useServices } from '../context';
import type { ServerNow } from '../clock/serverClock';
import type { QueueSnapshot } from '../offline/queue';

const NO_SCENARIO: MockScenario = { geofence: 'inside', mockLocation: false, offline: false };
const noopSubscribe = () => () => undefined;

export const useQueue = (): QueueSnapshot => {
  const { queue } = useServices();
  return useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
};

/** Status jaringan (termasuk simulasi offline di klien mock). */
export const useOnline = (): boolean => {
  const { device } = useServices();
  const [online, setOnline] = useState(() => device.isOnline());
  useEffect(() => {
    setOnline(device.isOnline());
    return device.onNetworkChange(setOnline);
  }, [device]);
  return online;
};

/** Skenario simulasi lapangan; nilai default bila bukan klien mock. */
export const useScenario = (): MockScenario => {
  const { simulation } = useServices();
  return useSyncExternalStore(simulation?.subscribe ?? noopSubscribe, simulation?.get ?? (() => NO_SCENARIO), simulation?.get ?? (() => NO_SCENARIO));
};

/**
 * Jam server yang berjalan. Re-render tiap detik hanya di komponen pemakai hook ini
 * (taruh di komponen jam kecil agar seluruh layar tidak ikut render ulang).
 */
export const useServerNow = (): ServerNow | null => {
  const { serverClock } = useServices();
  const [now, setNow] = useState(() => serverClock.now());
  useEffect(() => {
    const tick = () => setNow(serverClock.now());
    tick();
    const off = serverClock.subscribe(tick);
    const id = setInterval(tick, 1000);
    return () => {
      off();
      clearInterval(id);
    };
  }, [serverClock]);
  return now;
};
