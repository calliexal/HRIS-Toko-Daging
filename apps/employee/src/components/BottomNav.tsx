import { AppLink, cx, Icon, type IconName } from '@dagingpeople/ui';
import type { RoutePath } from '../router';

type Tab = { path: RoutePath; label: string; icon: IconName; /** Rute lain yang tetap menyorot tab ini. */ also?: RoutePath[] };

const TABS: readonly Tab[] = [
  { path: '/beranda', label: 'Beranda', icon: 'home', also: ['/absen', '/absen-gudang', '/hasil'] },
  { path: '/jadwal', label: 'Jadwal', icon: 'calendar' },
  { path: '/cuti', label: 'Pengajuan', icon: 'clipboard' },
  { path: '/slip', label: 'Slip', icon: 'receipt' },
  { path: '/profil', label: 'Profil', icon: 'user' },
];

export const BottomNav = ({ current }: { current: RoutePath }) => (
  <nav className="emp-nav" aria-label="Menu utama">
    {TABS.map((tab) => {
      const active = tab.path === current || (tab.also?.includes(current) ?? false);
      return (
        <AppLink key={tab.path} href={tab.path} className={cx('emp-nav__item', active && 'is-active')} aria-current={active ? 'page' : undefined}>
          <Icon name={tab.icon} size={24} strokeWidth={active ? 2.4 : 2} />
          <span>{tab.label}</span>
        </AppLink>
      );
    })}
  </nav>
);
