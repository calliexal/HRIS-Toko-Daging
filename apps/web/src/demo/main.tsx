/**
 * Demo statis web admin + kiosk (tanpa Next.js). Merender komponen fitur yang SAMA dengan
 * aplikasi Next, tetapi dengan router hash kecil, LinkProvider default (anchor biasa),
 * dan WebPathsProvider berisi path hash.
 */
import '@dagingpeople/tokens/tokens.css';
import '@dagingpeople/ui/styles.css';
import '../styles/admin.css';
import '../styles/kiosk.css';
import './demo.css';

import { StrictMode, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiProvider, canUseAdminWeb, createMockClient, createSessionStore, ROLE_LABEL, SessionProvider, useSession, webStoragePersistence } from '@dagingpeople/api';
import { AdminShell } from '../features/admin/AdminShell';
import { ApprovalsScreen } from '../features/admin/ApprovalsScreen';
import { AttendanceTodayScreen } from '../features/admin/AttendanceTodayScreen';
import { PayrollRunScreen } from '../features/admin/PayrollRunScreen';
import { WeeklyScheduleScreen } from '../features/admin/WeeklyScheduleScreen';
import { OutletKioskScreen } from '../features/kiosk/OutletKioskScreen';
import { PinKioskScreen } from '../features/kiosk/PinKioskScreen';
import { WarehouseKioskScreen } from '../features/kiosk/WarehouseKioskScreen';
import { AdminLoginScreen } from '../features/auth/AdminLoginScreen';
import { WebPathsProvider, type WebPaths } from '../features/paths';

const demoPaths: WebPaths = {
  attendance: '#/admin/kehadiran',
  schedule: '#/admin/jadwal',
  approvals: '#/admin/persetujuan',
  payroll: '#/admin/payroll',
  kioskOutlet: '#/kiosk/outlet',
  kioskPin: '#/kiosk/outlet/pin',
  kioskWarehouse: '#/kiosk/gudang',
};

type Route = { path: string; title: string; description: string; group: 'admin' | 'kiosk'; Screen: ComponentType };

const LOGIN_PATH = '#/masuk';

const ROUTES: readonly Route[] = [
  { path: demoPaths.attendance, group: 'admin', title: 'W1 · Kehadiran hari ini', description: 'Ringkasan yang bisa memfilter tabel, pencarian, ekspor rekap CSV, dan panel anomali.', Screen: AttendanceTodayScreen },
  { path: demoPaths.schedule, group: 'admin', title: 'W2 · Jadwal shift mingguan', description: 'Grid karyawan × 7 hari, ganti shift per sel, cakupan per shift, publikasi dengan peringatan.', Screen: WeeklyScheduleScreen },
  { path: demoPaths.approvals, group: 'admin', title: 'W3 · Persetujuan', description: 'Inbox cuti, koreksi, tugas luar, dan absen offline; tolak wajib catatan.', Screen: ApprovalsScreen },
  { path: demoPaths.payroll, group: 'admin', title: 'W4 · Payroll periode', description: 'Stepper 6 langkah, ringkasan rupiah, karyawan perlu review, kirim ke Owner, kunci periode.', Screen: PayrollRunScreen },
  { path: demoPaths.kioskOutlet, group: 'kiosk', title: 'K1 · Kiosk outlet', description: 'Jam server besar, pindai kartu ID (atau simulasi), konfirmasi 3 detik, daftar baru saja absen.', Screen: OutletKioskScreen },
  { path: demoPaths.kioskPin, group: 'kiosk', title: 'K2 · Kiosk PIN', description: 'Nomor karyawan 4 digit + PIN 6 digit, keypad 88px, kunci akun 15 menit setelah 3x salah.', Screen: PinKioskScreen },
  { path: demoPaths.kioskWarehouse, group: 'kiosk', title: 'K3 · Kiosk gudang', description: 'QR dinamis berganti tiap 30 detik dengan hitung mundur, kartu ID sebagai cadangan.', Screen: WarehouseKioskScreen },
];

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const getHash = () => {
  const hash = window.location.hash.split('?')[0] ?? '';
  return hash === '' || hash === '#' ? '#/' : hash;
};
const useHashPath = () => useSyncExternalStore(subscribe, getHash, () => '#/');

const DemoIndex = () => {
  const groups = [
    { key: 'admin' as const, title: 'Web Admin', note: 'Kepala Toko, HR, Finance, Owner · fluid 375–1440px' },
    { key: 'kiosk' as const, title: 'Kiosk Absensi', note: 'Tablet landscape 1024×768 · tema terang' },
  ];
  return (
    <main className="demo-index">
      <header className="demo-index__header">
        <p className="demo-index__brand">DagingPeople</p>
        <h1 className="t-h1">Demo Web Admin &amp; Kiosk</h1>
        <p className="demo-index__lead">Semua layar memakai data contoh (klien mock). Hari ini = Rab, 7 Okt 2026, Outlet Kemang. PIN contoh: nomor 0042, PIN 123456.</p>
      </header>
      {groups.map((g) => (
        <section key={g.key} className="demo-index__group" aria-labelledby={`demo-${g.key}`}>
          <h2 id={`demo-${g.key}`} className="t-h2">
            {g.title}
          </h2>
          <p className="demo-index__note">{g.note}</p>
          <ul className="demo-index__list">
            {g.key === 'admin' ? (
              <li>
                <a href={LOGIN_PATH} className="demo-index__link">
                  <span className="demo-index__title">W0 · Masuk</span>
                  <span className="demo-index__desc">Email + kata sandi, tampilkan sandi, Caps Lock, 5x salah → terkunci 15 menit, akun karyawan diarahkan ke aplikasi HP.</span>
                </a>
              </li>
            ) : null}
            {ROUTES.filter((r) => r.group === g.key).map((r) => (
              <li key={r.path}>
                <a href={r.path} className="demo-index__link">
                  <span className="demo-index__title">{r.title}</span>
                  <span className="demo-index__desc">{r.description}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
};

const NotFound = () => (
  <main className="demo-index">
    <h1 className="t-h1">Layar tidak ditemukan</h1>
    <p>
      <a href="#/">Kembali ke daftar layar</a>
    </p>
  </main>
);

/** Tujuan setelah login, dari '#/masuk?next=%23%2Fadmin%2Fjadwal'. Hanya rute admin demo yang diterima. */
const nextFromHash = () => {
  const next = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('next');
  return next && ROUTES.some((r) => r.group === 'admin' && r.path === next) ? next : demoPaths.attendance;
};

/** Penjaga sesi versi demo (setara AdminFrame di Next.js). */
const AdminGate = ({ path, children }: { path: string; children: ReactNode }) => {
  const { ready, user, logout } = useSession();
  const allowed = user ? canUseAdminWeb(user) : false;
  useEffect(() => {
    if (ready && !allowed) window.location.replace(`${LOGIN_PATH}?next=${encodeURIComponent(path)}`);
  }, [ready, allowed, path]);
  if (!ready || !user || !allowed) return <div className="adm-gate" aria-busy="true" />;
  return (
    <AdminShell
      currentPath={path}
      account={{ name: user.name, role: user.role, roleLabel: ROLE_LABEL[user.role] }}
      onLogout={() => {
        logout();
        window.location.hash = LOGIN_PATH;
      }}
    >
      {children}
    </AdminShell>
  );
};

const DemoRouter = () => {
  const path = useHashPath();
  const route = ROUTES.find((r) => r.path === path);
  const { ready, session } = useSession();

  // Sudah login tetapi membuka #/masuk (atau baru saja login) → ke tujuan.
  useEffect(() => {
    if (path === LOGIN_PATH && ready && session) window.location.replace(nextFromHash());
  }, [path, ready, session]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const title = path === LOGIN_PATH ? 'Masuk' : route ? route.title.replace(/^\w+ · /, '') : 'Daftar layar';
    document.title = `${title} · DagingPeople`;
    // Pindahkan fokus ke konten utama setelah navigasi (setara pengumuman rute di Next.js).
    const main = document.getElementById('adm-main');
    if (main && route?.group === 'admin') main.focus({ preventScroll: true });
  }, [path, route]);

  if (path === '#/') return <DemoIndex />;
  if (path === LOGIN_PATH) {
    if (!ready) return null;
    if (session) return null; // efek di atas mengarahkan ke tujuan
    return <AdminLoginScreen onSignedIn={() => undefined} />;
  }
  if (!route) return <NotFound />;
  const { Screen } = route;
  return route.group === 'admin' ? (
    <AdminGate path={path}>
      <Screen />
    </AdminGate>
  ) : (
    <Screen />
  );
};

const DemoApp = () => {
  // Satu instance klien mock selama sesi demo, agar state (jadwal, persetujuan) bertahan antar-layar.
  const [client] = useState(() => createMockClient());
  const [session] = useState(() => createSessionStore({ persistence: webStoragePersistence(window.sessionStorage, 'dp.demo.admin.session') }));
  return (
    <ApiProvider client={client}>
      <SessionProvider store={session}>
        <WebPathsProvider paths={demoPaths}>
          <DemoRouter />
        </WebPathsProvider>
      </SessionProvider>
    </ApiProvider>
  );
};

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <DemoApp />
    </StrictMode>,
  );
}
