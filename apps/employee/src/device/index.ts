import { Capacitor } from '@capacitor/core';
import { createCapacitorDevice } from './capacitor';
import type { DeviceAdapter } from './types';
import { createWebDevice, type WebDeviceOptions } from './web';

export * from './types';
export { createFieldSimulation, withFieldSimulation, type FieldSimulation } from './simulation';

/** Native (Android/iOS) memakai plugin Capacitor; peramban & build demo memakai API web. */
export const createDevice = (webOptions: WebDeviceOptions): DeviceAdapter =>
  Capacitor.isNativePlatform() ? createCapacitorDevice() : createWebDevice(webOptions);
