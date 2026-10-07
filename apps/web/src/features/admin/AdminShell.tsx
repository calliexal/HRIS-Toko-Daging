'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi } from '@dagingpeople/api';
import { AppLink, cx, Icon, type IconName } from '@dagingpeople/ui';
import { useWebPaths, type WebPaths } from '../paths';

type ApprovalBadge = { count: number | undefined; setCount: (count: number) => void };

const ApprovalBadgeContext = createContext<ApprovalBadge>({ count: undefined, setCount: () => undefined });

/** Layar Persetujuan memperbarui badge di sidebar setelah memutuskan pengajuan. */
export const useApprovalBadge = (): ApprovalBadge => useContext(ApprovalBadgeContext);

const usePendingApprovalCount = (): ApprovalBadge => {
  const api = useApi();
  const [count, setCount] = useState<number>();
  useEffect(() => {
    let active = true;
    api.admin
      .listApprovals()
      .then((items) => active && setCount(items.length))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);
  return useMemo(() => ({ count, setCount }), [count]);
};

type NavItem = { key: keyof WebPaths; label: string; icon: IconName; hint?: string; badge?: boolean; hideFor?: readonly string[] };

const NAV_ITEMS: readonly NavItem[] = [
  { key: 'attendance', label: 'Kehadiran', icon: 'clock' },
  { key: 'schedule', label: 'Jadwal Shift', icon: 'calendar' },
  { key: 'approvals', label: 'Persetujuan', icon: 'clipboard', badge: true },
  // Data gaji tertutup untuk Kepala Toko (SEC-01): menu disembunyikan, API tetap menolak 403.
  { key: 'payroll', label: 'Payroll', icon: 'wallet', hint: 'HR', hideFor: ['store_manager'] },
];

export type AdminShellProps = {
  /** Path aktif saat ini (Next: usePathname, demo: path hash). */
  currentPath: string;
  /** Pengguna yang login; tanpa ini (demo layar lama) bagian akun tidak tampil. */
  account?: { name: string; role: string; roleLabel: string };
  onLogout?: () => void;
  children: ReactNode;
};

export const AdminShell = ({ currentPath, account, onLogout, children }: AdminShellProps) => {
  const paths = useWebPaths();
  const badge = usePendingApprovalCount();
  const navRef = useRef<HTMLElement>(null);

  // Di lebar HP nav menjadi bar yang bisa digulir: pastikan item aktif terlihat.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left < navBox.left || box.right > navBox.right) {
      nav.scrollLeft += box.left - navBox.left - (navBox.width - box.width) / 2;
    }
  }, [currentPath]);

  return (
    <ApprovalBadgeContext.Provider value={badge}>
      <div className="adm-shell">
        <a className="adm-skip" href="#adm-main">
          Lewati ke konten
        </a>
        <aside className="adm-nav" ref={navRef}>
          <div className="adm-nav__inner">
          <p className="adm-nav__brand">DagingPeople</p>
          <nav aria-label="Menu utama">
            <ul className="adm-nav__list">
              {NAV_ITEMS.filter((item) => !account || !item.hideFor?.includes(account.role)).map((item) => {
                const href = paths[item.key];
                const active = currentPath === href || currentPath.startsWith(`${href}/`);
                return (
                  <li key={item.key}>
                    <AppLink href={href} className={cx('adm-nav__link', active && 'is-active')} aria-current={active ? 'page' : undefined}>
                      <Icon name={item.icon} size={20} />
                      <span className="adm-nav__label">{item.label}</span>
                      {item.hint ? <span className="adm-nav__hint">({item.hint})</span> : null}
                      {item.badge && badge.count ? (
                        <span className="adm-nav__badge dp-num">
                          {badge.count}
                          <span className="dp-visually-hidden"> menunggu</span>
                        </span>
                      ) : null}
                    </AppLink>
                  </li>
                );
              })}
            </ul>
          </nav>
          {account ? (
            <div className="adm-nav__account">
              <span className="adm-nav__avatar" aria-hidden="true">
                {account.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="adm-nav__who">
                <span className="adm-nav__who-name">{account.name}</span>
                <span className="adm-nav__who-role">{account.roleLabel}</span>
              </span>
              {onLogout ? (
                <button type="button" className="adm-nav__logout" onClick={onLogout} aria-label="Keluar" title="Keluar">
                  <Icon name="log-out" size={20} />
                </button>
              ) : null}
            </div>
          ) : null}
          </div>
        </aside>
        <main id="adm-main" className="adm-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </ApprovalBadgeContext.Provider>
  );
};
