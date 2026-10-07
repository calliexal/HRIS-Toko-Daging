import {
  deviceError,
  type CameraFacing,
  type CameraSession,
  type CapturedPhoto,
  type DeviceAdapter,
  type DeviceGeoFix,
  type NetworkListener,
  type ScannedQr,
  type SimulatedQrVariant,
} from './types';

export type WebDeviceOptions = {
  /**
   * true hanya untuk klien mock: bila GPS/kamera/pemindai tidak tersedia atau ditolak,
   * adaptor memakai simulasi yang ditandai `simulated: true` (UI menampilkan label "Simulasi").
   */
  allowSimulation: boolean;
  /** Sumber token QR contoh untuk simulasi pindai (mis. QR kiosk gudang di klien mock). */
  simulatedQrToken?: () => string;
};

const GEO_TIMEOUT_MS = 10_000;
const GEO_TIMEOUT_SIMULATION_MS = 2_500;
const PHOTO_MAX_WIDTH = 640;

/** Titik contoh di sekitar Outlet Kemang; hanya untuk simulasi, tidak pernah dikirim sebagai data asli. */
const SIMULATED_FIX: DeviceGeoFix = { lat: -6.2607, lng: 106.8136, accuracyM: 12, isMock: false, simulated: true };

type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

const getBarcodeDetector = (): BarcodeDetectorCtor | undefined =>
  (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

type PreviewSession = CameraSession & { video: HTMLVideoElement; track: MediaStreamTrack | undefined };

const isPreview = (session: CameraSession): session is PreviewSession => session.kind === 'preview' && 'video' in session;

const cssToken = (name: string, fallbackVar: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || getComputedStyle(document.documentElement).getPropertyValue(fallbackVar).trim();

/** Gambar pengganti berlabel "Simulasi" dengan warna dari token (tanpa hex). */
const simulatedPhoto = (): CapturedPhoto => {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = cssToken('--surface-sunken', '--bg');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = cssToken('--ink-muted', '--ink');
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Simulasi', canvas.width / 2, canvas.height / 2);
  }
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.6), simulated: true };
};

const frameToDataUrl = (video: HTMLVideoElement): string => {
  const scale = Math.min(1, PHOTO_MAX_WIDTH / (video.videoWidth || PHOTO_MAX_WIDTH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((video.videoWidth || PHOTO_MAX_WIDTH) * scale);
  canvas.height = Math.round((video.videoHeight || PHOTO_MAX_WIDTH) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw deviceError('unavailable', 'Foto tidak bisa diambil di perangkat ini.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
};

const readPosition = (timeout: number) =>
  new Promise<GeolocationPosition>((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(deviceError('unavailable', 'GPS tidak tersedia di perangkat ini.'));
      return;
    }
    // Pengaman tambahan: sebagian peramban tidak pernah memanggil callback bila izin diabaikan.
    const guard = setTimeout(() => reject(deviceError('timeout', 'Lokasi belum terbaca.')), timeout + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(guard);
        resolve(pos);
      },
      (err) => {
        clearTimeout(guard);
        reject(
          err.code === err.PERMISSION_DENIED
            ? deviceError('permission_denied', 'Izin lokasi belum diberikan.')
            : err.code === err.TIMEOUT
              ? deviceError('timeout', 'Lokasi belum terbaca.')
              : deviceError('unavailable', 'Lokasi tidak tersedia.'),
        );
      },
      { enableHighAccuracy: true, timeout, maximumAge: 15_000 },
    );
  });

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(deviceError('cancelled', 'Pemindaian dihentikan.'));
      },
      { once: true },
    );
  });

export const createWebDevice = ({ allowSimulation, simulatedQrToken }: WebDeviceOptions): DeviceAdapter => {
  const simulatedSession = (facing: CameraFacing): CameraSession => ({ kind: 'simulated', facing, torchSupported: false, stop: () => undefined });

  const getLocation = async (): Promise<DeviceGeoFix> => {
    try {
      const pos = await readPosition(allowSimulation ? GEO_TIMEOUT_SIMULATION_MS : GEO_TIMEOUT_MS);
      // Peramban tidak bisa mendeteksi mock location; deteksi hanya ada di aplikasi native.
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy, isMock: false, simulated: false };
    } catch (error) {
      if (allowSimulation) return SIMULATED_FIX;
      throw error;
    }
  };

  const openCamera = async (video: HTMLVideoElement | null, facing: CameraFacing): Promise<CameraSession> => {
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      if (allowSimulation) return simulatedSession(facing);
      throw deviceError('unavailable', 'Kamera tidak tersedia di perangkat ini.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      const capabilities = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      const session: PreviewSession = {
        kind: 'preview',
        facing,
        torchSupported: capabilities.torch === true,
        video,
        track,
        stop: () => {
          stream.getTracks().forEach((t) => t.stop());
          video.srcObject = null;
        },
      };
      return session;
    } catch (error) {
      if (allowSimulation) return simulatedSession(facing);
      const name = error instanceof DOMException ? error.name : '';
      throw name === 'NotAllowedError'
        ? deviceError('permission_denied', 'Izin kamera belum diberikan.')
        : deviceError('unavailable', 'Kamera tidak bisa dibuka.');
    }
  };

  const capturePhoto = async (session: CameraSession): Promise<CapturedPhoto> => {
    if (isPreview(session)) return { dataUrl: frameToDataUrl(session.video), simulated: false };
    if (session.kind === 'simulated') return simulatedPhoto();
    throw deviceError('unavailable', 'Kamera tidak tersedia.');
  };

  const scanQr = async (session: CameraSession, signal: AbortSignal): Promise<ScannedQr> => {
    const Detector = getBarcodeDetector();
    if (!isPreview(session) || !Detector) throw deviceError('unavailable', 'Pemindai QR tidak didukung di peramban ini.');
    const detector = new Detector({ formats: ['qr_code'] });
    for (;;) {
      if (signal.aborted) throw deviceError('cancelled', 'Pemindaian dihentikan.');
      if (session.video.readyState >= 2) {
        const codes = await detector.detect(session.video).catch(() => []);
        const value = codes[0]?.rawValue;
        if (value) return { value, simulated: false, scannedAtMs: performance.now() };
      }
      await wait(250, signal);
    }
  };

  const setTorch = async (session: CameraSession, on: boolean) => {
    if (!isPreview(session) || !session.torchSupported || !session.track) return false;
    try {
      await session.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  };

  const onNetworkChange = (listener: NetworkListener) => {
    const handleOnline = () => listener(true);
    const handleOffline = () => listener(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  };

  return {
    platform: 'web',
    getLocation,
    openCamera,
    capturePhoto,
    scanQr,
    simulateQrScan:
      allowSimulation && simulatedQrToken
        ? (variant: SimulatedQrVariant) => ({
            value: simulatedQrToken(),
            simulated: true,
            // Varian "kedaluwarsa": QR dianggap sudah terbaca 61 detik lalu, sehingga aturan 60 detik berlaku.
            scannedAtMs: performance.now() - (variant === 'expired' ? 61_000 : 0),
          })
        : undefined,
    setTorch,
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
    onNetworkChange,
    monotonicMs: () => performance.now(),
  };
};
