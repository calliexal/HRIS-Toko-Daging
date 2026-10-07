import { useEffect, useRef, useState } from 'react';
import { Banner, Button, cx, Icon } from '@dagingpeople/ui';
import { Screen, SimulatedTag, TaskHeader } from '../components/Layout';
import { LiveClock } from '../components/LiveClock';
import { SelfieCamera } from '../components/SelfieCamera';
import { useServices } from '../context';
import { isDeviceError, type ScannedQr } from '../device';
import { useAttendanceToday } from '../hooks/useAttendanceToday';
import { useCamera } from '../hooks/useCamera';
import { useClockSubmit } from '../hooks/useClockSubmit';
import { useOnline } from '../hooks/useExternal';
import { useNavigate } from '../router';
import { directionLabel, offlineFallback } from './shared';

/** ATT-04: QR yang dipindai lebih dari 60 detik lalu ditolak. */
const QR_MAX_AGE_MS = 60_000;
const EXPIRED_MESSAGE = 'QR kedaluwarsa, silakan pindai ulang.';
const GUDANG_NAME = 'Gudang & Cold Storage';

const Steps = ({ step }: { step: 1 | 2 }) => (
  <ol className="emp-steps" aria-label="Langkah absen gudang">
    <li className={cx('emp-steps__item', step === 1 && 'is-current', step > 1 && 'is-done')} aria-current={step === 1 ? 'step' : undefined}>
      {step > 1 ? <Icon name="check" size={16} /> : <span className="dp-num">1</span>} Pindai QR
    </li>
    <li className={cx('emp-steps__item', step === 2 && 'is-current')} aria-current={step === 2 ? 'step' : undefined}>
      <span className="dp-num">2</span> Foto selfie
    </li>
  </ol>
);

/** Langkah 1: kamera belakang membaca QR dinamis di kiosk pintu gudang. Tanpa GPS. */
const ScanStep = ({ onScanned, error }: { onScanned: (qr: ScannedQr) => void; error?: string }) => {
  const { device } = useServices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCamera(videoRef, 'environment');
  const [torch, setTorch] = useState(false);
  const [scanUnsupported, setScanUnsupported] = useState(false);
  const session = camera.state.status === 'ready' ? camera.state.session : null;
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;

  useEffect(() => {
    if (!session || session.kind === 'simulated') return undefined;
    const controller = new AbortController();
    setScanUnsupported(false);
    device
      .scanQr(session, controller.signal)
      .then((qr) => onScannedRef.current(qr))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (isDeviceError(e) && e.code === 'unavailable') setScanUnsupported(true);
      });
    return () => controller.abort();
  }, [device, session]);

  const simulate = device.simulateQrScan;
  const showSimulation = !!simulate && (!session || session.kind === 'simulated' || scanUnsupported);
  const torchAvailable = !!session && session.torchSupported;

  const toggleTorch = async () => {
    if (!session) return;
    const ok = await device.setTorch(session, !torch);
    if (ok) setTorch(!torch);
  };

  return (
    <>
      <div className="emp-camera emp-camera--qr">
        <video ref={videoRef} className="emp-camera__video" autoPlay playsInline muted hidden={session?.kind !== 'preview'} aria-hidden="true" />
        {camera.state.status === 'error' ? (
          <div className="emp-camera__placeholder" role="alert">
            <Icon name="camera" size={32} />
            <p className="t-small">{camera.state.message}</p>
            <Button variant="secondary" onClick={camera.retry}>
              Coba Lagi
            </Button>
          </div>
        ) : session?.kind === 'simulated' ? (
          <>
            <div className="emp-camera__placeholder">
              <Icon name="qr-code" size={32} />
            </div>
            <span className="emp-camera__badge">
              <SimulatedTag>Kamera simulasi</SimulatedTag>
            </span>
          </>
        ) : null}
        <div className="emp-camera__frame" aria-hidden="true" />
        <p className="emp-camera__caption" aria-live="polite">
          {camera.state.status === 'starting' ? 'Membuka kamera…' : scanUnsupported ? 'Pemindai tidak didukung di peramban ini' : 'Mencari QR…'}
        </p>
      </div>

      {error ? (
        <Banner tone="danger" title={error} role="alert">
          QR di kiosk berganti tiap 30 detik. Arahkan kamera ke QR yang tampil sekarang.
        </Banner>
      ) : null}

      <p className="t-body emp-center">Arahkan kamera ke QR di layar kiosk pintu gudang. Tidak perlu GPS.</p>

      <div className="emp-stack-2">
        {showSimulation && simulate ? (
          <>
            <Button size="lg" block icon="qr-code" onClick={() => onScanned(simulate('valid'))}>
              Pindai QR Contoh (Simulasi)
            </Button>
            <Button variant="ghost" block onClick={() => onScanned(simulate('expired'))}>
              Coba QR Kedaluwarsa (Simulasi)
            </Button>
          </>
        ) : null}
        <Button variant="secondary" size="lg" block icon="flashlight" disabled={!torchAvailable} aria-pressed={torch} onClick={() => void toggleTorch()}>
          {torch ? 'Matikan Senter' : 'Nyalakan Senter'}
        </Button>
        <p className="t-small emp-muted emp-center">QR tidak terbaca? Absen dengan kartu ID di kiosk gudang.</p>
      </div>
    </>
  );
};

/** M3 (ATT-04): pindai QR dinamis di kiosk, lalu selfie. */
export const WarehouseClockScreen = () => {
  const navigate = useNavigate();
  const { device } = useServices();
  const online = useOnline();
  const attendance = useAttendanceToday();
  const { submit, submitting } = useClockSubmit();
  const [qr, setQr] = useState<ScannedQr | null>(null);
  const [scanError, setScanError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCamera(videoRef, 'user', qr !== null);
  const direction = attendance.nextDirection ?? 'in';

  const isExpired = (scanned: ScannedQr) => device.monotonicMs() - scanned.scannedAtMs > QR_MAX_AGE_MS;

  const handleScanned = (scanned: ScannedQr) => {
    if (!scanned.value.startsWith('DPQR-')) {
      setScanError('QR ini bukan QR absensi DagingPeople.');
      return;
    }
    if (isExpired(scanned)) {
      setScanError(EXPIRED_MESSAGE);
      return;
    }
    setScanError(undefined);
    setQr(scanned);
  };

  const backToScan = (message?: string) => {
    setQr(null);
    setScanError(message);
  };

  const handleSubmit = async () => {
    if (!qr || camera.state.status !== 'ready') return;
    if (isExpired(qr)) {
      backToScan(EXPIRED_MESSAGE);
      return;
    }
    setSubmitError(undefined);
    let photo;
    try {
      photo = await device.capturePhoto(camera.state.session);
    } catch (error) {
      if (isDeviceError(error) && error.code === 'cancelled') return;
      setSubmitError('Foto belum terambil. Coba sekali lagi, atau absen dengan kartu ID di kiosk gudang.');
      return;
    }
    const outcome = await submit({ direction, method: 'app_qr', qrToken: qr.value, photo, fallback: offlineFallback(attendance.today, GUDANG_NAME) });
    if (outcome.kind === 'rejected') {
      if (outcome.result.reason === 'qr_expired' || outcome.result.reason === 'qr_invalid') backToScan(outcome.result.detail);
      else setSubmitError(outcome.result.detail);
      return;
    }
    navigate('/hasil', { state: outcome.state, replace: true });
  };

  return (
    <>
      <TaskHeader title={`${directionLabel(direction)} di Gudang`} />
      <Screen
        footer={
          qr ? (
            <>
              <Button size="lg" block icon="camera" loading={submitting} disabled={attendance.loading || camera.state.status !== 'ready'} onClick={() => void handleSubmit()}>
                Ambil Foto &amp; Absen
              </Button>
              <Button variant="ghost" block onClick={() => backToScan()}>
                Pindai Ulang QR
              </Button>
            </>
          ) : undefined
        }
      >
        <Steps step={qr ? 2 : 1} />
        {qr ? (
          <>
            <Banner tone="success" title="QR gudang terbaca">
              {GUDANG_NAME}
              {qr.simulated ? (
                <>
                  {' '}
                  <SimulatedTag />
                </>
              ) : null}
            </Banner>
            <SelfieCamera videoRef={videoRef} state={camera.state} onRetry={camera.retry} />
            <p className="emp-inline-clock">
              <Icon name="clock" size={20} />
              <span className="emp-muted">Waktu (jam server)</span>
              <LiveClock size="sm" />
            </p>
            {submitError ? (
              <Banner tone="danger" role="alert">
                {submitError}
              </Banner>
            ) : null}
            {!online ? (
              <Banner tone="info" icon="wifi-off" title="Anda sedang offline">
                Absen disimpan di HP dan dikirim otomatis saat online.
              </Banner>
            ) : null}
          </>
        ) : (
          <ScanStep onScanned={handleScanned} error={scanError} />
        )}
      </Screen>
    </>
  );
};
