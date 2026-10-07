'use client';

import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';

export type CameraStatus = 'starting' | 'ready' | 'unavailable' | 'denied';

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const getBarcodeDetector = (): BarcodeDetectorCtor | null => {
  if (typeof window === 'undefined') return null;
  const ctor = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
};

export type KioskCamera = {
  /** Pasang ke <video>; stream disambung ulang setiap kali elemen dipasang. */
  videoRef: RefCallback<HTMLVideoElement>;
  status: CameraStatus;
  /** true bila kamera aktif DAN browser mendukung BarcodeDetector (kartu bisa dibaca otomatis). */
  canScan: boolean;
  /** Foto bukti absen (data URL JPEG). Mengembalikan penanda bila kamera tidak tersedia. */
  capture: () => string;
};

export type UseKioskCameraOptions = {
  /** Dipanggil saat QR kartu terbaca. Jeda antar-deteksi dikelola hook. */
  onToken?: (token: string) => void;
  /** Hentikan deteksi sementara (mis. saat konfirmasi tampil). */
  paused?: boolean;
  scan?: boolean;
};

const SCAN_INTERVAL_MS = 350;
const SAME_TOKEN_COOLDOWN_MS = 5000;

/** Kamera depan tablet + pembaca QR kartu ID (BarcodeDetector bila tersedia). */
export const useKioskCamera = ({ onToken, paused = false, scan = true }: UseKioskCameraOptions = {}): KioskCamera => {
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [detector, setDetector] = useState<BarcodeDetectorLike | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const lastToken = useRef<{ value: string; at: number } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const start = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoEl.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        const Ctor = getBarcodeDetector();
        if (Ctor && scan) setDetector(new Ctor({ formats: ['qr_code'] }));
        setStatus('ready');
      } catch (e) {
        if (!cancelled) setStatus(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
    };
    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [scan]);

  const videoRef = useCallback<RefCallback<HTMLVideoElement>>((el) => {
    videoEl.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!detector || paused || status !== 'ready') return;
    let busy = false;
    const timer = setInterval(async () => {
      const video = videoEl.current;
      if (busy || !video || video.readyState < 2) return;
      busy = true;
      try {
        const codes = await detector.detect(video);
        const value = codes[0]?.rawValue;
        const now = Date.now();
        if (value && !(lastToken.current?.value === value && now - lastToken.current.at < SAME_TOKEN_COOLDOWN_MS)) {
          lastToken.current = { value, at: now };
          onTokenRef.current?.(value);
        }
      } catch {
        // Frame gagal dibaca; coba lagi di interval berikutnya.
      } finally {
        busy = false;
      }
    }, SCAN_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [detector, paused, status]);

  const capture = useCallback(() => {
    const video = videoEl.current;
    if (status !== 'ready' || !video || !video.videoWidth) return 'no-camera';
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }, [status]);

  return { videoRef, status, canScan: status === 'ready' && detector !== null, capture };
};
