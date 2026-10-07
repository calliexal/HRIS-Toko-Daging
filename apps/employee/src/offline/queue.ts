import type { ClockDirection, ClockRequest, ClockResult, ClockTime } from '@dagingpeople/api';

/**
 * Antrean absen offline (ATT-01 AC3). Event disimpan di localStorage dan dikirim ulang otomatis
 * saat perangkat kembali online. Server memakai `clientUuid` untuk deduplikasi, jadi kirim ulang aman.
 */

export type QueuedClock = {
  request: ClockRequest;
  /** Jam server (dihitung maju) saat event dibuat, untuk ditampilkan di Beranda. */
  time: ClockTime;
  date: string;
  queuedAt: number;
  /** Karyawan pemilik event. Hanya dikirim saat pemilik yang sama sedang login (HP bisa dipakai bergantian). */
  ownerId?: string;
};

export type RejectedClock = { direction: ClockDirection; time: ClockTime; detail: string };

export type QueueSnapshot = {
  pending: readonly QueuedClock[];
  /** Event yang ditolak server setelah dikirim ulang; pengguna perlu tahu dan mengambil langkah lain. */
  rejected: readonly RejectedClock[];
  sending: boolean;
};

export type OfflineQueue = {
  snapshot(): QueueSnapshot;
  enqueue(item: Omit<QueuedClock, 'queuedAt'>): void;
  flush(): Promise<void>;
  dismissRejected(): void;
  /** Jumlah event milik `ownerId` yang belum terkirim (untuk peringatan sebelum keluar). */
  pendingFor(ownerId: string): number;
  subscribe(listener: () => void): () => void;
  /** Mulai mendengarkan perubahan jaringan; mengembalikan fungsi berhenti. */
  start(): () => void;
};

export type QueueDeps = {
  send(request: ClockRequest): Promise<ClockResult>;
  isOnline(): boolean;
  onNetworkChange(listener: (online: boolean) => void): () => void;
  storageKey?: string;
  /**
   * Karyawan yang sedang login. Event di-cap dengan pemiliknya dan hanya dikirim dengan sesi pemilik itu,
   * supaya absen A tidak pernah terkirim memakai token B. null = belum login (tidak ada yang dikirim).
   */
  currentOwner?: () => string | null;
};

const DEFAULT_KEY = 'dp.employee.clockQueue.v1';
const RETRY_MS = 30_000;

type Stored = { pending: QueuedClock[]; rejected: RejectedClock[] };

const safeStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const isStored = (value: unknown): value is Stored =>
  typeof value === 'object' && value !== null && Array.isArray((value as Stored).pending) && Array.isArray((value as Stored).rejected);

const load = (key: string): Stored => {
  try {
    const raw = safeStorage()?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isStored(parsed) ? parsed : { pending: [], rejected: [] };
  } catch {
    return { pending: [], rejected: [] };
  }
};

/** Menyimpan; bila kuota penuh, foto dibuang dulu (event absen lebih penting daripada fotonya). */
const save = (key: string, data: Stored): void => {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(data));
  } catch {
    try {
      const slim: Stored = { ...data, pending: data.pending.map((p) => ({ ...p, request: { ...p.request, photoRef: undefined } })) };
      storage.setItem(key, JSON.stringify(slim));
    } catch {
      // Penyimpanan tidak tersedia (mode privat/penuh): antrean tetap hidup di memori selama aplikasi terbuka.
    }
  }
};

export const createOfflineQueue = ({ send, isOnline, onNetworkChange, storageKey = DEFAULT_KEY, currentOwner }: QueueDeps): OfflineQueue => {
  let data = load(storageKey);
  let sending = false;
  const listeners = new Set<() => void>();

  const owner = () => (currentOwner ? currentOwner() : undefined);
  /** Tanpa currentOwner (uji/demo lama) semua event dianggap milik pengguna aktif. */
  const mine = (item: QueuedClock, who = owner()) => who === undefined || (who !== null && item.ownerId === who);

  // Snapshot di-cache per (data, sending, pemilik) agar useSyncExternalStore mendapat referensi stabil.
  let cache: { data: Stored; sending: boolean; who: string | null | undefined; snap: QueueSnapshot } | null = null;
  const snapshot = (): QueueSnapshot => {
    const who = owner();
    if (!cache || cache.data !== data || cache.sending !== sending || cache.who !== who) {
      cache = { data, sending, who, snap: { pending: data.pending.filter((p) => mine(p, who)), rejected: who === null ? [] : data.rejected, sending } };
    }
    return cache.snap;
  };

  const notify = () => listeners.forEach((l) => l());
  const commit = (next: Stored) => {
    data = next;
    save(storageKey, data);
    notify();
  };

  const setSending = (value: boolean) => {
    sending = value;
    notify();
  };

  const flush = async () => {
    const who = owner();
    if (sending || !isOnline() || who === null || !data.pending.some((p) => mine(p, who))) return;
    setSending(true);
    try {
      // Kirim berurutan sesuai waktu kejadian agar urutan masuk → pulang terjaga.
      for (const item of data.pending.filter((p) => mine(p, who))) {
        if (owner() !== who) break; // pengguna keluar di tengah pengiriman
        if (!isOnline()) break;
        let result: ClockResult;
        try {
          result = await send({ ...item.request, offline: true });
        } catch {
          break; // Masih gagal jaringan: coba lagi nanti.
        }
        const pending = data.pending.filter((p) => p.request.clientUuid !== item.request.clientUuid);
        const rejected = result.outcome === 'rejected' ? [...data.rejected, { direction: item.request.direction, time: item.time, detail: result.detail }] : data.rejected;
        commit({ pending, rejected });
      }
    } finally {
      setSending(false);
    }
  };

  return {
    snapshot,
    enqueue: (item) => commit({ ...data, pending: [...data.pending, { ...item, queuedAt: Date.now(), ownerId: owner() ?? undefined }] }),
    flush,
    dismissRejected: () => commit({ ...data, rejected: [] }),
    pendingFor: (ownerId) => data.pending.filter((p) => p.ownerId === ownerId).length,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => {
      const stopNetwork = onNetworkChange((online) => {
        if (online) void flush();
      });
      const timer = setInterval(() => void flush(), RETRY_MS);
      void flush();
      return () => {
        stopNetwork();
        clearInterval(timer);
      };
    },
  };
};
