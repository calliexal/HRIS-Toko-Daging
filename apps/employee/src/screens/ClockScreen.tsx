import { useRef, useState } from 'react';
import { formatDistance } from '@dagingpeople/api';
import { Banner, Button, ButtonLink, Icon, TextAreaField } from '@dagingpeople/ui';
import { ErrorPanel } from '../components/ErrorPanel';
import { Screen, SimulatedTag, TaskHeader } from '../components/Layout';
import { LiveClock } from '../components/LiveClock';
import { SelfieCamera } from '../components/SelfieCamera';
import { useServices } from '../context';
import { isDeviceError } from '../device';
import { useAttendanceToday } from '../hooks/useAttendanceToday';
import { useCamera } from '../hooks/useCamera';
import { useClockSubmit, type RejectedClock } from '../hooks/useClockSubmit';
import { useOnline } from '../hooks/useExternal';
import { useGeofence, type GeofenceState } from '../hooks/useGeofence';
import { useLocation, useNavigate } from '../router';
import { directionLabel, offlineFallback } from './shared';

const REASON_MIN = 10;
const REASON_ID = 'emp-field-duty-reason';

const validateReason = (value: string) =>
  value.trim().length === 0
    ? 'Tulis alasan tugas luar agar Kepala Toko bisa menyetujui.'
    : value.trim().length < REASON_MIN
      ? `Tulis sedikit lebih jelas (minimal ${REASON_MIN} huruf), mis. "Antar pesanan ke Jl. Bangka".`
      : undefined;

const LocationValue = ({ state, fieldDuty }: { state: GeofenceState; fieldDuty: boolean }) => {
  switch (state.status) {
    case 'checking':
      return <>Memeriksa lokasi…</>;
    case 'offline':
      return <>Offline · diperiksa saat terkirim</>;
    case 'error':
      return <>Lokasi belum terbaca</>;
    case 'ready':
      return (
        <>
          {state.check.locationName} · {formatDistance(state.check.distanceM)} dari titik
          {!state.check.inside && fieldDuty ? ' (tugas luar)' : ''}
        </>
      );
  }
};

/** M2: absen dengan GPS + selfie kamera depan (ATT-01 AC1–AC4). Mode `tugas-luar` mewajibkan alasan. */
export const ClockScreen = () => {
  const { query } = useLocation();
  const navigate = useNavigate();
  const { device } = useServices();
  const online = useOnline();
  const attendance = useAttendanceToday();
  const { state: geofence, recheck } = useGeofence();
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCamera(videoRef, 'user');
  const { submit, submitting } = useClockSubmit();

  const fieldDuty = query.get('mode') === 'tugas-luar';
  const direction = attendance.nextDirection ?? 'in';
  const title = fieldDuty ? (direction === 'in' ? 'Absen Tugas Luar' : 'Pulang Tugas Luar') : directionLabel(direction);

  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [rejection, setRejection] = useState<RejectedClock>();
  const [captureError, setCaptureError] = useState<string>();

  const fix = geofence.status === 'ready' || geofence.status === 'offline' ? geofence.fix : undefined;
  const mockDetected = (geofence.status === 'ready' && geofence.fix.isMock) || rejection?.reason === 'mock_location';
  const outside = geofence.status === 'ready' && !geofence.check.inside;
  const blockedOutside = outside && !fieldDuty;
  // Tunggu data shift agar arah (masuk/pulang) dan data cadangan offline benar.
  const ready = !attendance.loading;
  const canSubmit = ready && camera.state.status === 'ready' && !!fix && !blockedOutside && !mockDetected;

  const handleSubmit = async () => {
    setCaptureError(undefined);
    if (fieldDuty) {
      const err = validateReason(reason);
      setReasonError(err);
      if (err) {
        document.getElementById(REASON_ID)?.focus();
        return;
      }
    }
    if (camera.state.status !== 'ready' || !fix) return;
    let photo;
    try {
      photo = await device.capturePhoto(camera.state.session);
    } catch (error) {
      if (isDeviceError(error) && error.code === 'cancelled') return;
      setCaptureError('Foto belum terambil. Coba sekali lagi, atau absen di kiosk outlet.');
      return;
    }
    const outcome = await submit({
      direction,
      method: 'app_gps',
      geo: fix,
      photo,
      fieldDuty: fieldDuty ? { reason: reason.trim() } : undefined,
      fallback: offlineFallback(attendance.today),
    });
    if (outcome.kind === 'rejected') {
      setRejection(outcome.result);
      return;
    }
    navigate('/hasil', { state: outcome.state, replace: true });
  };

  if (mockDetected) {
    return (
      <>
        <TaskHeader title={title} />
        <Screen>
          <ErrorPanel
            title="Absen ditolak: lokasi palsu terdeteksi"
            icon="alert-triangle"
            steps={['Matikan atau hapus aplikasi lokasi palsu di HP Anda.', 'Tutup DagingPeople, buka lagi, lalu absen ulang.', 'Atau absen di kiosk outlet dengan kartu ID atau PIN.']}
            actions={
              <>
                <Button
                  block
                  size="lg"
                  icon="refresh"
                  onClick={() => {
                    setRejection(undefined);
                    recheck();
                  }}
                >
                  Periksa Ulang Lokasi
                </Button>
                <ButtonLink href="/beranda" variant="ghost" block>
                  Kembali ke Beranda
                </ButtonLink>
              </>
            }
          >
            {rejection?.detail ?? 'Aplikasi lokasi palsu terdeteksi di HP Anda. Demi keadilan untuk semua karyawan, absen dari HP ini ditolak sementara.'}
          </ErrorPanel>
        </Screen>
      </>
    );
  }

  return (
    <>
      <TaskHeader title={title} />
      <Screen
        footer={
          <>
            <Button size="lg" block icon="camera" loading={submitting} disabled={!canSubmit} onClick={() => void handleSubmit()}>
              Ambil Foto &amp; Absen
            </Button>
            <ButtonLink href="/beranda" variant="ghost" block>
              Batal
            </ButtonLink>
          </>
        }
      >
        {fieldDuty ? (
          <TextAreaField
            id={REASON_ID}
            label="Alasan tugas luar"
            hint="Contoh: antar pesanan pelanggan ke Jl. Bangka. Absen ini menunggu persetujuan Kepala Toko."
            value={reason}
            error={reasonError}
            maxLength={200}
            onChange={(e) => {
              setReason(e.target.value);
              if (reasonError) setReasonError(validateReason(e.target.value));
            }}
            onBlur={() => setReasonError(validateReason(reason))}
          />
        ) : null}

        <SelfieCamera videoRef={videoRef} state={camera.state} onRetry={camera.retry} />

        <dl className="emp-rows emp-rows--icon">
          <div className="emp-rows__row">
            <Icon name="map-pin" size={20} className="emp-rows__icon" />
            <div className="emp-rows__stack">
              <dt className="emp-rows__label">Lokasi</dt>
              <dd className="emp-rows__value emp-rows__value--start">
                <LocationValue state={geofence} fieldDuty={fieldDuty} />
                {fix?.simulated ? <SimulatedTag>GPS simulasi</SimulatedTag> : null}
              </dd>
            </div>
          </div>
          <div className="emp-rows__row">
            <Icon name="clock" size={20} className="emp-rows__icon" />
            <div className="emp-rows__stack">
              <dt className="emp-rows__label">Waktu (jam server)</dt>
              <dd className="emp-rows__value emp-rows__value--start">
                <LiveClock size="sm" />
              </dd>
            </div>
          </div>
        </dl>


        {blockedOutside && geofence.status === 'ready' ? (
          <Banner tone="warning" title="Anda di luar radius outlet" role="alert" action={<ButtonLink href="/absen?mode=tugas-luar" variant="secondary">Tugas Luar</ButtonLink>}>
            Lokasi Anda {formatDistance(geofence.check.distanceM)} dari {geofence.check.locationName}. Dekati outlet atau pilih Tugas Luar.
          </Banner>
        ) : null}

        {rejection && rejection.reason !== 'mock_location' ? (
          <Banner tone="danger" title="Absen belum tercatat" role="alert">
            {rejection.detail}
          </Banner>
        ) : null}

        {captureError ? (
          <Banner tone="danger" role="alert">
            {captureError}
          </Banner>
        ) : null}

        {geofence.status === 'error' ? (
          <Banner
            tone="danger"
            title="Lokasi belum terbaca"
            action={
              <Button variant="secondary" onClick={recheck}>
                Coba Lagi
              </Button>
            }
          >
            {geofence.message}
          </Banner>
        ) : null}

        {online ? (
          <Banner tone="neutral" icon="wifi-off">
            Sinyal lemah? Absen tetap tersimpan di HP dan dikirim otomatis saat online.
          </Banner>
        ) : (
          <Banner tone="info" icon="wifi-off" title="Anda sedang offline">
            Absen disimpan di HP dan dikirim otomatis saat online. Jam yang dicatat adalah jam server di layar ini.
          </Banner>
        )}
      </Screen>
    </>
  );
};
