'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_FIXTURES, useApi, useResource, type DynamicQr, type KioskClockResult } from '@dagingpeople/api';

export const OUTLET_KIOSK_ID = 'kiosk-kemang-1';
export const WAREHOUSE_KIOSK_ID = 'kiosk-gudang-1';

/** Lama layar konfirmasi tampil sebelum kiosk kembali siap (ATT-02). */
export const CONFIRMATION_MS = 3000;

export const useKioskInfo = (kioskId: string) => {
  const api = useApi();
  const info = useResource(() => api.kiosk.getInfo(kioskId), [api, kioskId]);
  const recent = useResource(() => api.kiosk.getRecentClocks(kioskId), [api, kioskId]);
  return { info, recent };
};

export type CardOutcome = { result: KioskClockResult; at: number };

/**
 * Alur absen dengan kartu: kirim token + foto → tampilkan hasil selama 3 detik → siap lagi.
 * Pemindaian baru diabaikan selama hasil tampil atau permintaan masih berjalan.
 */
export const useCardClock = (kioskId: string, capture: () => string, onRecorded: () => void) => {
  const api = useApi();
  const [outcome, setOutcome] = useState<CardOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = useRef(false);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  useEffect(() => {
    if (!outcome && !failure) return;
    const timer = setTimeout(() => {
      setOutcome(null);
      setFailure(null);
      busy.current = false;
    }, CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [outcome, failure]);

  const submit = useCallback(
    async (cardToken: string) => {
      if (busy.current) return;
      busy.current = true;
      setSubmitting(true);
      try {
        const result = await api.kiosk.clockWithCard(kioskId, cardToken, capture());
        setOutcome({ result, at: Date.now() });
        if (result.outcome === 'recorded') onRecordedRef.current();
      } catch {
        setFailure('Absen belum terkirim karena koneksi terputus. Coba tempel kartu lagi, atau pakai PIN.');
      } finally {
        setSubmitting(false);
      }
    },
    [api, kioskId, capture],
  );

  const dismiss = useCallback(() => {
    setOutcome(null);
    setFailure(null);
    busy.current = false;
  }, []);

  return { outcome, failure, submitting, submit, dismiss, showing: outcome !== null || failure !== null };
};

export type SimulatedCard = { token: string; label: string };

const UNKNOWN_CARD = 'CARD-TIDAK-DIKENAL';

/**
 * Tombol simulasi kartu untuk klien mock saat kamera/BarcodeDetector tidak tersedia.
 * Token contoh diambil dari DEMO_FIXTURES, nama dari API agar tidak ada data karyawan di komponen.
 */
export const useSimulatedCards = (enabled: boolean, count = 2): SimulatedCard[] => {
  const api = useApi();
  const [cards, setCards] = useState<SimulatedCard[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const tokens = DEMO_FIXTURES.cards.slice(0, count);
    void Promise.all(tokens.map((t) => api.kiosk.identifyByCard('simulation', t).then((who) => ({ token: t, label: `kartu ${who?.name.split(' ')[0] ?? t}` })))).then(
      (known) => active && setCards([...known, { token: UNKNOWN_CARD, label: 'kartu tidak dikenal' }]),
    );
    return () => {
      active = false;
    };
  }, [api, enabled, count]);
  return enabled ? cards : [];
};

/** QR dinamis gudang (ATT-04): token baru tiap periode, countdown ke `expiresAt`. */
export const useDynamicQr = (kioskId: string) => {
  const api = useApi();
  const [qr, setQr] = useState<DynamicQr | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await api.kiosk.getDynamicQr(kioskId);
        if (!active) return;
        setQr(next);
        setNow(Date.now());
        setError(false);
        // Ambil token baru tepat saat token lama berakhir (maks. satu periode).
        const wait = Math.min(Math.max(next.expiresAt - Date.now(), 500), next.periodSeconds * 1000);
        refreshTimer = setTimeout(() => void load(), wait + 50);
      } catch {
        if (!active) return;
        setError(true);
        refreshTimer = setTimeout(() => void load(), 5000);
      }
    };
    void load();
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      active = false;
      clearTimeout(refreshTimer);
      clearInterval(tick);
    };
  }, [api, kioskId]);

  // Dibatasi ke satu periode: jam tablet yang sedikit tertinggal tidak boleh menampilkan "31 detik".
  const remainingMs = qr ? Math.min(Math.max(0, qr.expiresAt - now), qr.periodSeconds * 1000) : 0;
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const fraction = qr ? Math.min(1, remainingMs / (qr.periodSeconds * 1000)) : 0;
  return { qr, error, secondsLeft, fraction };
};
