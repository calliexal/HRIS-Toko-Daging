import { useState, type ReactNode } from 'react';
import { ROLE_LABEL, useApi, useResource, useSession, type MockScenario } from '@dagingpeople/api';
import { Banner, Button, Card, Skeleton } from '@dagingpeople/ui';
import { PageHeader, RowList, Screen } from '../components/Layout';
import { useServices } from '../context';
import { useScenario } from '../hooks/useExternal';
import { clearToday } from '../hooks/todayCache';

type ToggleProps = { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void };

/** Sakelar asli (`input type=checkbox role=switch`) dengan area sentuh selebar baris. */
const Toggle = ({ label, description, checked, onChange }: ToggleProps) => (
  <label className="emp-toggle">
    <span className="emp-toggle__text">
      <span className="t-body-strong">{label}</span>
      <span className="t-small emp-muted">{description}</span>
    </span>
    <input type="checkbox" role="switch" className="emp-toggle__input" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="emp-toggle__track" aria-hidden="true">
      <span className="emp-toggle__thumb" />
    </span>
  </label>
);

const TOGGLES: readonly { key: keyof MockScenario; label: string; description: string; on: Partial<MockScenario>; off: Partial<MockScenario> }[] = [
  { key: 'geofence', label: 'Di luar radius outlet', description: 'Posisi 230 m dari Outlet Kemang', on: { geofence: 'outside' }, off: { geofence: 'inside' } },
  { key: 'mockLocation', label: 'Lokasi palsu terdeteksi', description: 'Aplikasi fake GPS aktif di HP', on: { mockLocation: true }, off: { mockLocation: false } },
  { key: 'offline', label: 'Mode offline', description: 'Tanpa sinyal, misalnya di cold storage', on: { offline: true }, off: { offline: false } },
];

const isOn = (scenario: MockScenario, key: keyof MockScenario) => (key === 'geofence' ? scenario.geofence === 'outside' : scenario[key] === true);

/** Kartu khusus usability test; hanya tampil dengan klien mock. */
const SimulationCard = () => {
  const { simulation } = useServices();
  const scenario = useScenario();
  if (!simulation) return null;
  return (
    <Card title="Simulasi kondisi lapangan">
      <div className="emp-stack-3">
        <p className="t-small emp-muted">Untuk uji coba dengan karyawan. Kondisi ini hanya berlaku di data contoh.</p>
        <div className="emp-toggles">
          {TOGGLES.map((t) => (
            <Toggle key={t.key} label={t.label} description={t.description} checked={isOn(scenario, t.key)} onChange={(c) => simulation.set(c ? t.on : t.off)} />
          ))}
        </div>
      </div>
    </Card>
  );
};

const Value = ({ children }: { children: ReactNode }) => <span className="emp-rows__value-text">{children}</span>;

/**
 * Keluar. Absen offline yang belum terkirim TIDAK hilang: tetap di HP dan terkirim saat pemiliknya masuk lagi
 * (antrean terikat ke karyawan). Pengguna diberi tahu dulu agar tidak kaget.
 */
const LogoutCard = () => {
  const { user, logout } = useSession();
  const { queue } = useServices();
  const [confirming, setConfirming] = useState(false);
  if (!user) return null;
  const pending = user.employeeId ? queue.pendingFor(user.employeeId) : 0;
  const signOut = () => {
    clearToday();
    logout();
  };
  return (
    <Card title="Akun">
      <div className="emp-stack-3">
        <p className="t-small emp-muted">
          Masuk sebagai <strong>{user.email}</strong> · {ROLE_LABEL[user.role]}
        </p>
        {confirming ? (
          <Banner tone="warning" title={`${pending} absen belum terkirim`} role="alert">
            Absen tetap tersimpan di HP ini dan otomatis terkirim saat Anda masuk lagi dengan akun yang sama.
          </Banner>
        ) : null}
        {confirming ? (
          <div className="emp-stack-2">
            <Button variant="danger" block icon="log-out" onClick={signOut}>
              Keluar sekarang
            </Button>
            <Button variant="ghost" block onClick={() => setConfirming(false)}>
              Tetap masuk
            </Button>
          </div>
        ) : (
          <Button variant="secondary" block icon="log-out" onClick={() => (pending > 0 ? setConfirming(true) : signOut())}>
            Keluar
          </Button>
        )}
      </div>
    </Card>
  );
};

export const ProfileScreen = () => {
  const api = useApi();
  const { appVersion, device } = useServices();
  const me = useResource(() => api.employee.getMe(), [api]);

  return (
    <Screen>
      <PageHeader title="Profil" />
      {me.error ? (
        <Banner tone="danger" title="Profil belum termuat">
          Periksa sinyal lalu buka lagi halaman ini.
        </Banner>
      ) : !me.data ? (
        <Skeleton height={196} />
      ) : (
        <RowList
          rows={[
            { label: 'Nama', value: <Value>{me.data.name}</Value> },
            { label: 'Kode karyawan', value: <span className="dp-num">{me.data.code}</span> },
            { label: 'Jabatan', value: <Value>{me.data.position}</Value> },
            { label: 'Lokasi kerja', value: <Value>{me.data.location.name}</Value> },
          ]}
        />
      )}

      <LogoutCard />

      <SimulationCard />

      <p className="t-caption emp-muted emp-center">
        DagingPeople versi <span className="dp-num">{appVersion}</span> · {device.platform === 'web' ? 'Web' : device.platform === 'ios' ? 'iOS' : 'Android'}
      </p>
    </Screen>
  );
};
