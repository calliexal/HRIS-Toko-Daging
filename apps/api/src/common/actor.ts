import { forbidden } from './errors';

export type Role = 'employee' | 'store_manager' | 'hr' | 'finance' | 'owner' | 'super_admin';

/** Identitas pemanggil, diambil dari JWT oleh AuthGuard. */
export type Actor = {
  userId: string;
  role: Role;
  employeeId: string | null;
  /** Lingkup lokasi Kepala Toko. Kosong untuk peran pusat (akses semua lokasi). */
  locationIds: readonly string[];
};

/** Kiosk terautentikasi dengan token perangkat, bukan akun pengguna. */
export type KioskActor = { kioskId: string; locationId: string; mode: 'card' | 'dynamic_qr' };

const CENTRAL: readonly Role[] = ['hr', 'finance', 'owner', 'super_admin'];

export const requireRole = (actor: Actor, ...roles: Role[]): void => {
  if (!roles.includes(actor.role)) throw forbidden();
};

/** SEC-01 AC1: Kepala Toko hanya lokasinya; peran pusat semua lokasi. */
export const requireLocation = (actor: Actor, locationId: string): void => {
  if (CENTRAL.includes(actor.role)) return;
  if (actor.role === 'store_manager' && actor.locationIds.includes(locationId)) return;
  throw forbidden('Anda hanya bisa melihat data lokasi yang Anda pimpin.');
};

/** Data gaji hanya untuk HR, Finance, Owner (SEC-01 AC1: Kepala Toko tanpa gaji). */
export const canSeeSalary = (actor: Actor): boolean => ['hr', 'finance', 'owner'].includes(actor.role);

export const requireEmployee = (actor: Actor): string => {
  if (!actor.employeeId) throw forbidden('Akun ini tidak terhubung ke data karyawan.');
  return actor.employeeId;
};
