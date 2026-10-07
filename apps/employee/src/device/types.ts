import type { GeoFix } from '@dagingpeople/api';

/**
 * Adaptor perangkat: satu-satunya pintu UI ke GPS, kamera, pemindai QR, dan status jaringan.
 * Implementasi: `capacitor.ts` (Android/iOS) dan `web.ts` (peramban + demo).
 */

/** `simulated` = posisi buatan karena GPS tidak tersedia di build demo; selalu diberi label di UI. */
export type DeviceGeoFix = GeoFix & { simulated: boolean };

export type CameraFacing = 'user' | 'environment';

/**
 * - `preview`   : stream kamera tampil di <video> (web).
 * - `system`    : kamera bawaan OS dibuka saat capture/scan (Capacitor).
 * - `simulated` : kamera tidak tersedia, foto/QR dibuat sebagai simulasi berlabel (khusus klien mock).
 */
export type CameraSessionKind = 'preview' | 'system' | 'simulated';

export type CameraSession = {
  readonly kind: CameraSessionKind;
  readonly facing: CameraFacing;
  readonly torchSupported: boolean;
  stop(): void;
};

export type CapturedPhoto = { dataUrl: string; simulated: boolean };

/** `scannedAtMs` = waktu monotonik saat QR terbaca; QR lebih tua dari 60 detik ditolak (ATT-04). */
export type ScannedQr = { value: string; simulated: boolean; scannedAtMs: number };

export type SimulatedQrVariant = 'valid' | 'expired';

export type DeviceErrorCode = 'permission_denied' | 'unavailable' | 'timeout' | 'cancelled';

export type DeviceError = Error & { code: DeviceErrorCode };

export const deviceError = (code: DeviceErrorCode, message: string): DeviceError => Object.assign(new Error(message), { code });

export const isDeviceError = (value: unknown): value is DeviceError =>
  value instanceof Error && typeof (value as Partial<DeviceError>).code === 'string';

export type NetworkListener = (online: boolean) => void;

export type DeviceAdapter = {
  readonly platform: 'android' | 'ios' | 'web';
  getLocation(): Promise<DeviceGeoFix>;
  /** Membuka kamera. `video` dipakai untuk preview di web; diabaikan di native (kamera sistem). */
  openCamera(video: HTMLVideoElement | null, facing: CameraFacing): Promise<CameraSession>;
  /** Mengambil foto sebagai data URL JPEG (lebar maks. 640px agar ringan untuk antrean offline). */
  capturePhoto(session: CameraSession): Promise<CapturedPhoto>;
  /** Menunggu sampai satu QR terbaca. Ditolak dengan DeviceError('unavailable') bila pemindai tidak didukung. */
  scanQr(session: CameraSession, signal: AbortSignal): Promise<ScannedQr>;
  /** Hanya ada di build demo/mock: QR contoh berlabel "Simulasi" saat kamera/pemindai tidak tersedia. */
  simulateQrScan?: (variant: SimulatedQrVariant) => ScannedQr;
  /** Mengembalikan true bila senter berhasil diubah. */
  setTorch(session: CameraSession, on: boolean): Promise<boolean>;
  isOnline(): boolean;
  onNetworkChange(listener: NetworkListener): () => void;
  /** Jam monotonik (ms). Tidak terpengaruh perubahan jam HP; dipakai untuk menghitung maju waktu server. */
  monotonicMs(): number;
};
