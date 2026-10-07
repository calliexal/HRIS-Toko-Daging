import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { Camera, CameraDirection, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Network } from '@capacitor/network';
import {
  deviceError,
  type CameraFacing,
  type CameraSession,
  type CapturedPhoto,
  type DeviceAdapter,
  type DeviceGeoFix,
  type NetworkListener,
  type ScannedQr,
} from './types';

/**
 * Plugin native custom untuk deteksi lokasi palsu (ATT-01 AC4). BELUM ADA di repo native.
 *
 * TODO(tim native):
 *  - Android: kembalikan `Location.isMock()` (API 31+) / `isFromMockProvider()` dari fix terakhir,
 *    plus cek aplikasi dengan izin ACCESS_MOCK_LOCATION / Developer options "Select mock location app".
 *  - iOS 15+: `CLLocation.sourceInformation?.isSimulatedBySoftware` / `isProducedByAccessory`.
 *  - Nama plugin: "DeviceIntegrity". Selama plugin belum ada, panggilan gagal dan adaptor menganggap
 *    `isMock = false` (server tetap memvalidasi; celah ini harus ditutup sebelum rilis).
 */
export type DeviceIntegrityPlugin = {
  checkMockLocation(): Promise<{ isMock: boolean }>;
};

const PHOTO_MAX_WIDTH = 640;

const isCancel = (error: unknown) => error instanceof Error && /cancel/i.test(error.message);

export const createCapacitorDevice = (): DeviceAdapter => {
  // registerPlugin dipanggil saat adaptor dibuat (bukan saat modul dimuat) agar build web/demo aman.
  const integrity = registerPlugin<DeviceIntegrityPlugin>('DeviceIntegrity');
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

  let online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const listeners = new Set<NetworkListener>();
  void Network.getStatus()
    .then((status) => {
      online = status.connected;
      listeners.forEach((l) => l(online));
    })
    .catch(() => undefined);
  void Network.addListener('networkStatusChange', (status) => {
    online = status.connected;
    listeners.forEach((l) => l(online));
  });

  const getLocation = async (): Promise<DeviceGeoFix> => {
    try {
      const permission = await Geolocation.checkPermissions();
      if (permission.location !== 'granted') {
        const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
        if (requested.location !== 'granted') throw deviceError('permission_denied', 'Izin lokasi belum diberikan.');
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 });
      const isMock = await integrity
        .checkMockLocation()
        .then((r) => r.isMock)
        .catch(() => false);
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy, isMock, simulated: false };
    } catch (error) {
      if (error instanceof Error && 'code' in error) throw error;
      throw deviceError('unavailable', 'Lokasi belum terbaca. Pastikan GPS menyala.');
    }
  };

  const openCamera = async (_video: HTMLVideoElement | null, facing: CameraFacing): Promise<CameraSession> => ({
    kind: 'system',
    facing,
    torchSupported: facing === 'environment',
    stop: () => undefined,
  });

  const capturePhoto = async (session: CameraSession): Promise<CapturedPhoto> => {
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        direction: session.facing === 'user' ? CameraDirection.Front : CameraDirection.Rear,
        resultType: CameraResultType.DataUrl,
        quality: 70,
        width: PHOTO_MAX_WIDTH,
        correctOrientation: true,
        saveToGallery: false,
        allowEditing: false,
      });
      if (!photo.dataUrl) throw deviceError('unavailable', 'Foto tidak tersimpan.');
      return { dataUrl: photo.dataUrl, simulated: false };
    } catch (error) {
      if (isCancel(error)) throw deviceError('cancelled', 'Pengambilan foto dibatalkan.');
      throw deviceError('permission_denied', 'Kamera tidak bisa dibuka. Izinkan akses kamera di Pengaturan.');
    }
  };

  const scanQr = async (_session: CameraSession, signal: AbortSignal): Promise<ScannedQr> => {
    const { supported } = await BarcodeScanner.isSupported();
    if (!supported) throw deviceError('unavailable', 'Pemindai QR tidak didukung di HP ini.');
    const { camera } = await BarcodeScanner.requestPermissions();
    if (camera !== 'granted' && camera !== 'limited') throw deviceError('permission_denied', 'Izin kamera belum diberikan.');
    if (platform === 'android') {
      const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available) {
        // Modul diunduh Google Play Services; pada sinyal lemah bisa lama, maka minta pengguna mencoba lagi.
        await BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => undefined);
        throw deviceError('unavailable', 'Pemindai QR sedang disiapkan. Coba lagi dalam beberapa detik.');
      }
    }
    if (signal.aborted) throw deviceError('cancelled', 'Pemindaian dihentikan.');
    try {
      const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
      const value = barcodes[0]?.rawValue;
      if (!value) throw deviceError('cancelled', 'QR belum terbaca.');
      return { value, simulated: false, scannedAtMs: performance.now() };
    } catch (error) {
      if (error instanceof Error && 'code' in error) throw error;
      throw deviceError('cancelled', 'Pemindaian dibatalkan.');
    }
  };

  const setTorch = async (_session: CameraSession, on: boolean) => {
    try {
      const { available } = await BarcodeScanner.isTorchAvailable();
      if (!available) return false;
      await (on ? BarcodeScanner.enableTorch() : BarcodeScanner.disableTorch());
      return true;
    } catch {
      return false;
    }
  };

  return {
    platform,
    getLocation,
    openCamera,
    capturePhoto,
    scanQr,
    setTorch,
    isOnline: () => online,
    onNetworkChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // performance.now() di WebView = jam monotonik sejak halaman dimuat; tidak ikut berubah bila jam HP diubah.
    monotonicMs: () => performance.now(),
  };
};
