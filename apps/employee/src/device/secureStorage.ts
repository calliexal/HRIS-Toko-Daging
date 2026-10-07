import { Capacitor, registerPlugin } from '@capacitor/core';
import { webStoragePersistence, type SessionPersistence } from '@dagingpeople/api';

/**
 * Penyimpanan token sesi.
 *  - Native: plugin "SecureStorage" → iOS Keychain (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly) /
 *    Android Keystore (EncryptedSharedPreferences). Token TIDAK pernah ditulis ke localStorage/Preferences polos.
 *  - Browser (dev/PWA): sessionStorage.
 *
 * TODO(tim native): implementasi plugin "SecureStorage" dengan tiga method di bawah (pola sama dengan
 * DeviceIntegrity di ./capacitor.ts). Selama plugin belum ada, sesi hanya disimpan di memori:
 * aman, tetapi karyawan perlu login ulang setiap aplikasi dibuka ulang.
 */
export type SecureStoragePlugin = {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
};

const KEY = 'dp.employee.session';

export const createSessionPersistence = (): SessionPersistence => {
  if (!Capacitor.isNativePlatform()) return webStoragePersistence(typeof window === 'undefined' ? undefined : window.sessionStorage, KEY);
  const plugin = registerPlugin<SecureStoragePlugin>('SecureStorage');
  let available = true;
  const guard = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    if (!available) return fallback;
    try {
      return await fn();
    } catch {
      available = false; // plugin belum terpasang: lanjut memori saja
      return fallback;
    }
  };
  return {
    read: () => guard(async () => (await plugin.get({ key: KEY })).value, null),
    write: (value) => guard(() => (value === null ? plugin.remove({ key: KEY }) : plugin.set({ key: KEY, value })), undefined),
  };
};
