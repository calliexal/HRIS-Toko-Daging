import { attendanceStatusMeta, formatClock, formatDateShort, formatDistance, useApi, useResource, type Me, type TodayShift } from '@dagingpeople/api';
import { AppLink, Banner, Button, ButtonLink, DemoBadge, Icon, Skeleton, StatusChip, type IconName } from '@dagingpeople/ui';
import { RowList, Screen, SimulatedTag } from '../components/Layout';
import { LiveClock } from '../components/LiveClock';
import { useServices } from '../context';
import { useAttendanceToday, type ClockMark } from '../hooks/useAttendanceToday';
import { useOnline, useQueue, useServerNow } from '../hooks/useExternal';
import { useGeofence, type GeofenceState } from '../hooks/useGeofence';

const greeting = (time: string | undefined) => {
  const hour = Number(time?.slice(0, 2) ?? 6);
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
};

const initials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();

const Greeting = ({ me }: { me: Me | undefined }) => {
  const api = useApi();
  const now = useServerNow();
  return (
    <header className="emp-home-header">
      <span className="emp-avatar" aria-hidden="true">
        {me ? initials(me.name) : ''}
      </span>
      <div className="emp-home-header__text">
        {me ? (
          <>
            <p className="t-h3">
              {greeting(now?.time)}, {me.greetingName}
            </p>
            <p className="t-small emp-muted">
              {me.position} · {me.location.name}
            </p>
          </>
        ) : (
          <>
            <Skeleton width={160} height={20} />
            <Skeleton width={120} height={16} />
          </>
        )}
      </div>
      <DemoBadge show={api.isMock} />
    </header>
  );
};

const GeofenceLine = ({ state }: { state: GeofenceState }) => {
  const simulated = (state.status === 'ready' || state.status === 'offline') && state.fix.simulated;
  let icon: IconName = 'map-pin';
  let tone = 'neutral';
  let text: string;
  switch (state.status) {
    case 'checking':
      text = 'Memeriksa lokasi Anda…';
      break;
    case 'offline':
      icon = 'wifi-off';
      tone = 'info';
      text = 'Offline · lokasi diperiksa saat absen terkirim';
      break;
    case 'error':
      tone = 'danger';
      text = 'Lokasi belum terbaca';
      break;
    case 'ready':
      if (state.fix.isMock) {
        tone = 'danger';
        icon = 'alert-triangle';
        text = 'Lokasi palsu terdeteksi';
      } else if (state.check.inside) {
        tone = 'success';
        text = `${state.check.locationName} · Anda di dalam radius (${formatDistance(state.check.distanceM)})`;
      } else {
        tone = 'warning';
        text = `${state.check.locationName} · ${formatDistance(state.check.distanceM)} dari outlet, di luar radius`;
      }
      break;
  }
  return (
    <p className={`emp-geo emp-geo--${tone}`} aria-live="polite">
      <Icon name={icon} size={20} />
      <span className="emp-geo__text">{text}</span>
      {simulated ? <SimulatedTag>GPS simulasi</SimulatedTag> : null}
    </p>
  );
};

type ClockActionProps = { today: TodayShift; geofence: GeofenceState; recheck: () => void; direction: 'in' | 'out' | null };

/** Tombol absen + jalan keluar sesuai kondisi geofence (ATT-01). */
const ClockAction = ({ today, geofence, recheck, direction }: ClockActionProps) => {
  if (!direction) {
    return (
      <Banner tone="success" title="Absen hari ini lengkap">
        Terima kasih. Sampai jumpa di shift berikutnya.
      </Banner>
    );
  }
  const label = direction === 'in' ? 'Absen Masuk' : 'Absen Pulang';
  const icon: IconName = direction === 'in' ? 'log-in' : 'log-out';
  const isGudang = today.location.type === 'gudang';
  if (isGudang) {
    return (
      <ButtonLink href="/absen-gudang" size="pill" block icon="qr-code">
        {label}
      </ButtonLink>
    );
  }

  const outside = geofence.status === 'ready' && !geofence.check.inside && !geofence.fix.isMock;
  const mock = geofence.status === 'ready' && geofence.fix.isMock;
  const usable = geofence.status === 'offline' || (geofence.status === 'ready' && geofence.check.inside && !geofence.fix.isMock);

  return (
    <div className="emp-stack-2">
      {usable ? (
        <ButtonLink href="/absen" size="pill" block icon={icon}>
          {label}
        </ButtonLink>
      ) : (
        <Button size="pill" block icon={icon} disabled loading={geofence.status === 'checking'} aria-describedby="emp-clock-hint">
          {label}
        </Button>
      )}
      {outside && geofence.status === 'ready' ? (
        <div id="emp-clock-hint" className="emp-stack-2">
          <Banner tone="warning" title="Anda di luar radius outlet">
            Lokasi Anda {formatDistance(geofence.check.distanceM)} dari {geofence.check.locationName}. Dekati outlet, atau pilih Tugas Luar bila sedang
            bertugas di luar.
          </Banner>
          <ButtonLink href="/absen?mode=tugas-luar" variant="secondary" block icon="map-pin">
            Absen Tugas Luar
          </ButtonLink>
        </div>
      ) : null}
      {mock ? (
        <div id="emp-clock-hint">
          <Banner tone="danger" title="Absen tidak bisa dipakai" role="alert">
            Aplikasi lokasi palsu terdeteksi di HP Anda. Matikan aplikasi tersebut lalu coba lagi, atau absen di kiosk outlet dengan kartu ID atau PIN.
          </Banner>
        </div>
      ) : null}
      {geofence.status === 'error' ? (
        <div id="emp-clock-hint">
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
        </div>
      ) : null}
      {!outside ? (
        <AppLink href="/absen?mode=tugas-luar" className="emp-textlink">
          Sedang tugas luar? Absen di luar lokasi
        </AppLink>
      ) : null}
    </div>
  );
};

const markValue = (mark: ClockMark) => {
  if (!mark) return <span className="emp-muted">Belum</span>;
  return (
    <span className="emp-mark">
      <span className="dp-num">{formatClock(mark.time)}</span>
      {mark.queued ? (
        <StatusChip tone="info" icon="wifi-off">
          Menunggu dikirim
        </StatusChip>
      ) : null}
    </span>
  );
};

const QueueNotice = () => {
  const queue = useQueue();
  const online = useOnline();
  const { queue: service } = useServices();
  return (
    <>
      {queue.rejected.map((r, i) => (
        <Banner
          key={`${r.time}-${i}`}
          tone="danger"
          role="alert"
          title={`Absen ${r.direction === 'in' ? 'masuk' : 'pulang'} ${formatClock(r.time)} ditolak server`}
          action={
            <Button variant="ghost" onClick={() => service.dismissRejected()}>
              Tutup
            </Button>
          }
        >
          {r.detail} Bila perlu koreksi, minta Kepala Toko mengajukan koreksi absen.
        </Banner>
      ))}
      {queue.pending.length > 0 ? (
        <Banner tone="info" icon={online ? 'refresh' : 'wifi-off'} title={online ? 'Mengirim absen tersimpan…' : `${queue.pending.length} absen tersimpan di HP`}>
          {online ? 'Tunggu sebentar, absen Anda sedang dikirim ke server.' : 'Akan dikirim otomatis saat sinyal kembali. Anda tidak perlu absen ulang.'}
        </Banner>
      ) : !online ? (
        <Banner tone="info" icon="wifi-off" title="Anda sedang offline">
          Absen tetap bisa dilakukan. Data disimpan di HP dan dikirim otomatis saat online.
        </Banner>
      ) : null}
    </>
  );
};

const QUICK_LINKS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: '/cuti', label: 'Ajukan Cuti', icon: 'clipboard' },
  { href: '/jadwal', label: 'Lihat Jadwal', icon: 'calendar' },
  { href: '/slip', label: 'Slip Gaji', icon: 'receipt' },
];

export const HomeScreen = () => {
  const api = useApi();
  const me = useResource(() => api.employee.getMe(), [api]);
  const balance = useResource(() => api.employee.getLeaveBalance(), [api]);
  const attendance = useAttendanceToday();
  const { state: geofence, recheck } = useGeofence();
  const today = attendance.today;
  const status = today
    ? attendance.clockIn?.queued
      ? { tone: 'info' as const, label: 'Tersimpan di HP' }
      : attendanceStatusMeta(today.status)
    : null;

  return (
    <Screen>
      <Greeting me={me.data} />
      <QueueNotice />

      <section className="emp-shift-card" aria-labelledby="emp-shift-title">
        {today ? (
          <>
            <div className="emp-shift-card__top">
              <h2 id="emp-shift-title" className="t-label emp-muted">
                Shift hari ini · {formatDateShort(today.date)}
              </h2>
              {status ? <StatusChip tone={status.tone}>{status.label}</StatusChip> : null}
            </div>
            <p className="t-h2 dp-num">{today.shift ? `${today.shift.name} · ${formatClock(today.shift.start)}–${formatClock(today.shift.end)}` : 'Tidak ada shift'}</p>
            <GeofenceLine state={geofence} />
            <LiveClock className="emp-shift-card__clock" />
            <ClockAction today={today} geofence={geofence} recheck={recheck} direction={attendance.nextDirection} />
          </>
        ) : attendance.error ? (
          <Banner
            tone="danger"
            title="Shift hari ini belum termuat"
            action={
              <Button variant="secondary" onClick={() => void attendance.reload()}>
                Muat Ulang
              </Button>
            }
          >
            Periksa sinyal lalu muat ulang.
          </Banner>
        ) : (
          <div className="emp-stack-3" aria-busy="true">
            <Skeleton height={18} width="70%" />
            <Skeleton height={26} width="55%" />
            <Skeleton height={40} />
            <Skeleton height={64} />
          </div>
        )}
      </section>

      <section className="emp-section" aria-labelledby="emp-today-title">
        <h2 id="emp-today-title" className="t-h3">
          Hari ini
        </h2>
        <RowList
          rows={[
            { label: 'Absen masuk', value: markValue(attendance.clockIn) },
            { label: 'Absen pulang', value: markValue(attendance.clockOut) },
          ]}
        />
      </section>

      <nav className="emp-quick" aria-label="Pintasan">
        {QUICK_LINKS.map((q) => (
          <AppLink key={q.href} href={q.href} className="emp-quick__item">
            <Icon name={q.icon} size={24} />
            <span>{q.label}</span>
          </AppLink>
        ))}
      </nav>

      <AppLink href="/absen-gudang" className="emp-balance">
        <span className="emp-balance__label">
          <Icon name="qr-code" size={20} />
          Absen di gudang dengan QR kiosk
        </span>
        <Icon name="chevron-right" size={20} />
      </AppLink>

      <AppLink href="/cuti" className="emp-balance">
        <span>
          Sisa cuti tahunan:{' '}
          {balance.data ? <b className="dp-num">{balance.data.annualRemaining} hari</b> : <Skeleton width={48} height={16} className="emp-inline-skeleton" />}
        </span>
        <Icon name="chevron-right" size={20} />
      </AppLink>
    </Screen>
  );
};
