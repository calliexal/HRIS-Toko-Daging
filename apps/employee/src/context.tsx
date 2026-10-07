import { createContext, useContext, type ReactNode } from 'react';
import type { ServerClock } from './clock/serverClock';
import type { DeviceAdapter, FieldSimulation } from './device';
import type { OfflineQueue } from './offline/queue';

export type EmployeeServices = {
  device: DeviceAdapter;
  queue: OfflineQueue;
  serverClock: ServerClock;
  /** Hanya ada saat klien mock dipakai (usability test). */
  simulation?: FieldSimulation;
  appVersion: string;
};

const ServicesContext = createContext<EmployeeServices | null>(null);

export const ServicesProvider = ({ value, children }: { value: EmployeeServices; children: ReactNode }) => (
  <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
);

export const useServices = (): EmployeeServices => {
  const value = useContext(ServicesContext);
  if (!value) throw new Error('useServices harus dipakai di dalam <ServicesProvider>.');
  return value;
};
