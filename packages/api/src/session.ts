import type { LoginResult, SessionUser, UserRole } from './types';

/**
 * Sesi login di sisi klien: token JWT + identitas pengguna, dengan kedaluwarsa.
 * Penyimpanan permanen dipisah lewat `SessionPersistence` agar tiap platform memakai tempat yang tepat:
 *  - web admin  → sessionStorage (hilang saat tab ditutup; tidak dibagi antar-tab).
 *  - aplikasi native → Keychain (iOS) / Keystore (Android) lewat plugin SecureStorage.
 *  - demo/uji   → memori saja.
 */
export type StoredSession = { token: string; user: SessionUser; expiresAt: number };

/** Kenapa sesi berakhir; dipakai layar login untuk memberi tahu pengguna. */
export type SessionEndReason = 'logout' | 'expired' | 'unauthenticated';

export type SessionPersistence = {
  read(): Promise<string | null>;
  write(value: string | null): Promise<void>;
};

export type SessionSnapshot = {
  /** false sampai sesi tersimpan selesai dibaca (hindari kilasan layar login saat aplikasi dibuka). */
  ready: boolean;
  session: StoredSession | null;
  endReason: SessionEndReason | null;
};

export type SessionStore = {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Baca sesi tersimpan. Aman dipanggil berkali-kali. */
  hydrate(): Promise<void>;
  /** Token yang masih berlaku, atau null (sesi kedaluwarsa otomatis dibersihkan). */
  token(): string | null;
  start(result: LoginResult): void;
  end(reason: SessionEndReason): void;
};

/** Token dianggap habis sedikit lebih awal agar tidak ditolak server di tengah permintaan. */
const EXPIRY_MARGIN_MS = 30_000;

const isStoredSession = (v: unknown): v is StoredSession => {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Partial<StoredSession>;
  return typeof s.token === 'string' && typeof s.expiresAt === 'number' && typeof s.user === 'object' && s.user !== null && typeof s.user.role === 'string';
};

export const createSessionStore = (options: { persistence?: SessionPersistence; now?: () => number } = {}): SessionStore => {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: SessionSnapshot = { ready: !options.persistence, session: null, endReason: null };
  let hydrating: Promise<void> | null = null;

  const publish = (next: SessionSnapshot) => {
    snapshot = next;
    listeners.forEach((l) => l());
  };
  const persist = (value: StoredSession | null) => {
    // Gagal menulis tidak boleh memblokir login; sesi tetap berlaku di memori.
    void options.persistence?.write(value ? JSON.stringify(value) : null).catch(() => undefined);
  };
  const valid = (s: StoredSession | null) => (s && s.expiresAt - EXPIRY_MARGIN_MS > now() ? s : null);

  const store: SessionStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate() {
      if (!options.persistence || snapshot.ready) return Promise.resolve();
      hydrating ??= (async () => {
        let restored: StoredSession | null = null;
        try {
          const raw = await options.persistence!.read();
          const parsed: unknown = raw ? JSON.parse(raw) : null;
          restored = isStoredSession(parsed) ? valid(parsed) : null;
          if (raw && !restored) persist(null);
        } catch {
          restored = null;
        }
        // Login yang terjadi selama hydrate (jarang) tidak boleh ditimpa sesi lama.
        publish({ ready: true, session: snapshot.session ?? restored, endReason: snapshot.endReason });
      })();
      return hydrating;
    },
    token() {
      const s = snapshot.session;
      if (!s) return null;
      if (!valid(s)) {
        store.end('expired');
        return null;
      }
      return s.token;
    },
    start(result) {
      const session: StoredSession = { token: result.token, user: result.user, expiresAt: now() + result.expiresInSeconds * 1000 };
      persist(session);
      publish({ ready: true, session, endReason: null });
    },
    end(reason) {
      if (!snapshot.session && snapshot.endReason === reason) return;
      persist(null);
      publish({ ready: true, session: null, endReason: snapshot.session || reason === 'logout' ? reason : snapshot.endReason });
    },
  };
  return store;
};

/** Persistensi Web Storage. Default sessionStorage: tidak bertahan setelah tab/peramban ditutup. */
export const webStoragePersistence = (storage: Storage | undefined, key = 'dp.session'): SessionPersistence => ({
  read: async () => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  write: async (value) => {
    try {
      if (value === null) storage?.removeItem(key);
      else storage?.setItem(key, value);
    } catch {
      /* mode privat / kuota penuh: sesi tetap di memori */
    }
  },
});

// ---------------------------------------------------------------- akses per aplikasi
/** Web admin: Kepala Toko dan peran pusat. Karyawan biasa memakai aplikasi HP. */
export const ADMIN_ROLES: readonly UserRole[] = ['store_manager', 'hr', 'finance', 'owner', 'super_admin'];

/** Aplikasi karyawan: siapa pun yang terhubung ke data karyawan (termasuk Kepala Toko). */
export const canUseEmployeeApp = (user: SessionUser) => user.employeeId !== null;
export const canUseAdminWeb = (user: SessionUser) => ADMIN_ROLES.includes(user.role);

export const ROLE_LABEL: Record<UserRole, string> = {
  employee: 'Karyawan',
  store_manager: 'Kepala Toko',
  hr: 'HR',
  finance: 'Finance',
  owner: 'Owner',
  super_admin: 'Super Admin',
};
