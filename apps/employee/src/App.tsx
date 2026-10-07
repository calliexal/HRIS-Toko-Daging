import { useEffect, useMemo, useRef, type ComponentType } from 'react';
import { ApiProvider, SessionProvider, useSession, type HrisClient, type SessionStore } from '@dagingpeople/api';
import { LinkProvider } from '@dagingpeople/ui';
import { BottomNav } from './components/BottomNav';
import { ServicesProvider, type EmployeeServices } from './context';
import { HashLink, RouterProvider, useLocation, type RoutePath } from './router';
import { ClockScreen } from './screens/ClockScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LeaveScreen } from './screens/LeaveScreen';
import { LoginScreen } from './screens/LoginScreen';
import { PayslipScreen } from './screens/PayslipScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ResultScreen } from './screens/ResultScreen';
import { ScheduleScreen } from './screens/ScheduleScreen';
import { WarehouseClockScreen } from './screens/WarehouseClockScreen';

const SCREENS: Record<RoutePath, ComponentType> = {
  '/beranda': HomeScreen,
  '/absen': ClockScreen,
  '/absen-gudang': WarehouseClockScreen,
  '/hasil': ResultScreen,
  '/jadwal': ScheduleScreen,
  '/cuti': LeaveScreen,
  '/slip': PayslipScreen,
  '/profil': ProfileScreen,
};

/** Layar tugas memakai seluruh tinggi layar (tombol aksi di bawah); nav disembunyikan agar fokus. */
const TASK_ROUTES: ReadonlySet<RoutePath> = new Set<RoutePath>(['/absen', '/absen-gudang', '/hasil']);

const Shell = () => {
  const location = useLocation();
  const Screen = SCREENS[location.path];
  const showNav = !TASK_ROUTES.has(location.path);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.key]);

  return (
    <div className={showNav ? 'emp-app emp-app--with-nav' : 'emp-app'}>
      <main ref={mainRef} className="emp-main" id="emp-main">
        <Screen key={location.key} />
      </main>
      {showNav ? <BottomNav current={location.path} /> : null}
    </div>
  );
};

/** Belum login → layar Masuk; sesi tersimpan masih dibaca → layar kosong singkat (tanpa kilasan form login). */
const AuthGate = () => {
  const { ready, session } = useSession();
  if (!ready) return <div className="emp-app emp-splash" aria-busy="true" aria-label="Memuat DagingPeople" />;
  if (!session) {
    return (
      <div className="emp-app">
        <main className="emp-main" id="emp-main">
          <LoginScreen />
        </main>
      </div>
    );
  }
  return (
    <RouterProvider>
      <Shell />
    </RouterProvider>
  );
};

export type EmployeeAppProps = {
  client: HrisClient;
  session: SessionStore;
  services: EmployeeServices;
};

export const EmployeeApp = ({ client, session, services }: EmployeeAppProps) => {
  // Antrean offline mulai mendengarkan jaringan selama aplikasi hidup.
  useEffect(() => services.queue.start(), [services.queue]);
  const value = useMemo(() => services, [services]);
  return (
    <ApiProvider client={client}>
      <SessionProvider store={session}>
        <ServicesProvider value={value}>
          <LinkProvider component={HashLink}>
            <AuthGate />
          </LinkProvider>
        </ServicesProvider>
      </SessionProvider>
    </ApiProvider>
  );
};
