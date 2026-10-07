import type { MockHrisClient, MockScenario } from '@dagingpeople/api';
import type { DeviceAdapter, NetworkListener } from './types';

/**
 * Simulasi kondisi lapangan untuk usability test (hanya klien mock).
 * Mengubah skenario di klien mock DAN perilaku adaptor perangkat agar seluruh aplikasi
 * bereaksi seperti di lapangan (mis. mode offline memicu antrean lokal, bukan sekadar respons API).
 */
export type FieldSimulation = {
  get(): MockScenario;
  set(next: Partial<MockScenario>): void;
  subscribe(listener: () => void): () => void;
};

export const createFieldSimulation = (client: MockHrisClient): FieldSimulation => {
  const listeners = new Set<() => void>();
  let snapshot = client.getScenario();
  return {
    get: () => snapshot,
    set: (next) => {
      client.setScenario(next);
      snapshot = client.getScenario();
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/** Membungkus adaptor: `offline` mematikan jaringan, `mockLocation` menandai fix GPS sebagai palsu. */
export const withFieldSimulation = (device: DeviceAdapter, simulation: FieldSimulation): DeviceAdapter => {
  const isOnline = () => device.isOnline() && !simulation.get().offline;
  return {
    ...device,
    getLocation: async () => {
      const fix = await device.getLocation();
      return simulation.get().mockLocation ? { ...fix, isMock: true } : fix;
    },
    isOnline,
    onNetworkChange: (listener: NetworkListener) => {
      let last = isOnline();
      const emit = () => {
        const now = isOnline();
        if (now !== last) {
          last = now;
          listener(now);
        }
      };
      const offDevice = device.onNetworkChange(emit);
      const offSim = simulation.subscribe(emit);
      return () => {
        offDevice();
        offSim();
      };
    },
  };
};
