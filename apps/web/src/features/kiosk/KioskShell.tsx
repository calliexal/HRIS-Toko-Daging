'use client';

import { useEffect, type ReactNode } from 'react';
import { formatClock, useApi, type KioskInfo, type RecentClock } from '@dagingpeople/api';
import { DemoBadge, Skeleton } from '@dagingpeople/ui';

/** "Outlet Kemang · Kiosk 1" */
export const kioskTitle = (info: KioskInfo | undefined): string | null => (info ? `${info.location.name} · ${info.name}` : null);

export type KioskShellProps = {
  /** "Outlet Kemang · Kiosk 1". */
  title: string | null;
  children: ReactNode;
  footer?: ReactNode;
};

/** Bingkai kiosk tablet landscape: header brand, isi, footer opsional. Selalu tema terang. */
/** Kiosk selalu tema terang (Design System): paksa token terang di :root selama kiosk tampil. */
const useForceLightTheme = () => {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
  }, []);
};

export const KioskShell = ({ title, children, footer }: KioskShellProps) => {
  const api = useApi();
  useForceLightTheme();
  return (
    <div className="ksk">
      <header className="ksk-header">
        <span className="ksk-header__brand">DagingPeople</span>
        <span className="ksk-header__right">
          <span className="ksk-demo">
            <DemoBadge show={api.isMock} />
          </span>
          <span className="ksk-header__location">{title ?? <Skeleton width={220} height={22} />}</span>
        </span>
      </header>
      <main className="ksk-main">{children}</main>
      {footer ? <footer className="ksk-footer">{footer}</footer> : null}
    </div>
  );
};

const directionLabel = (d: RecentClock['direction']) => (d === 'in' ? 'Masuk' : 'Pulang');

/** "Baru saja absen": membantu karyawan memastikan absennya masuk. */
export const RecentClocks = ({ items, layout }: { items: RecentClock[] | undefined; layout: 'bar' | 'list' }) => (
  <section className={layout === 'bar' ? 'ksk-recent ksk-recent--bar' : 'ksk-recent ksk-recent--list'} aria-labelledby={`ksk-recent-${layout}`}>
    <h2 id={`ksk-recent-${layout}`} className="ksk-recent__title">
      Baru saja absen
    </h2>
    {items && items.length > 0 ? (
      <ul className="ksk-recent__items" aria-live="polite">
        {items.slice(0, layout === 'bar' ? 4 : 5).map((item, i) => (
          <li key={`${item.name}-${item.time}-${i}`} className="ksk-recent__item">
            <span>{item.name}</span>
            <span className="dp-num">
              {directionLabel(item.direction)} {formatClock(item.time)}
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="ksk-muted">{items ? 'Belum ada yang absen di kiosk ini.' : 'Memuat…'}</p>
    )}
  </section>
);

/** Tanggal + jam besar dari waktu server. */
export const KioskClock = ({ dateLabel, time }: { dateLabel: string | null; time: string | null }) => (
  <div className="ksk-clock">
    <p className="ksk-clock__date">{dateLabel ?? ' '}</p>
    <p className="ksk-clock__time dp-num" aria-live="off">
      {time ? formatClock(time) : '--.--'}
    </p>
  </div>
);
