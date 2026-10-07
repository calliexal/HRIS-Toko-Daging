'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * true hanya bila `active` bertahan lebih lama dari `delayMs`.
 * Dipakai agar Skeleton tidak berkedip untuk pemuatan < 1 detik (CONVENTIONS aturan 9).
 */
export const useDelayedFlag = (active: boolean, delayMs = 1000): boolean => {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return shown;
};

/** Pesan sementara (mis. hasil aksi) yang hilang sendiri setelah `ttlMs`; `null` = tidak hilang. */
export const useTransientMessage = <T,>(ttlMs: number | null = 6000) => {
  const [message, setMessage] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (next: T | null) => {
    clearTimeout(timer.current);
    setMessage(next);
    if (next !== null && ttlMs !== null) timer.current = setTimeout(() => setMessage(null), ttlMs);
  };
  return [message, show] as const;
};

/** Nama depan untuk teks ringkas ("Budi lupa absen pulang"). */
export const firstName = (fullName: string): string => fullName.split(' ')[0] ?? fullName;

export const initials = (fullName: string): string =>
  fullName
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

export const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;
