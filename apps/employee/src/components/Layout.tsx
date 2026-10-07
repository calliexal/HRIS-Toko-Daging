import type { ReactNode } from 'react';
import { AppLink, cx, DemoBadge, Icon } from '@dagingpeople/ui';
import { useApi } from '@dagingpeople/api';

/** Header layar tab (Jadwal, Slip, Profil): judul besar + penanda data contoh. */
export const PageHeader = ({ title, children }: { title: string; children?: ReactNode }) => {
  const api = useApi();
  return (
    <header className="emp-page-header">
      <div className="emp-page-header__row">
        <h1 className="t-h1">{title}</h1>
        <DemoBadge show={api.isMock} />
      </div>
      {children}
    </header>
  );
};

/** Header layar tugas (Absen, Cuti): tombol kembali 48px + judul. */
export const TaskHeader = ({ title, backHref = '/beranda' }: { title: string; backHref?: string }) => {
  const api = useApi();
  return (
    <header className="emp-task-header">
      <AppLink href={backHref} className="emp-task-header__back" aria-label="Kembali">
        <Icon name="chevron-left" size={24} />
      </AppLink>
      <h1 className="emp-task-header__title">{title}</h1>
      <DemoBadge show={api.isMock} />
    </header>
  );
};

/** Kolom isi layar. `stickyFooter` = tombol aksi menempel di bawah konten. */
export const Screen = ({ children, className, footer }: { children: ReactNode; className?: string; footer?: ReactNode }) => (
  <div className={cx('emp-screen', className)}>
    <div className="emp-screen__body">{children}</div>
    {footer ? <div className="emp-screen__footer">{footer}</div> : null}
  </div>
);

export type RowItem = { label: ReactNode; value: ReactNode; key?: string };

/** Daftar label–nilai dalam kartu bergaris (dipakai di Beranda, Hasil, Slip). */
export const RowList = ({ rows, className, numeric }: { rows: RowItem[]; className?: string; numeric?: boolean }) => (
  <dl className={cx('emp-rows', numeric && 'dp-num', className)}>
    {rows.map((r, i) => (
      <div className="emp-rows__row" key={r.key ?? i}>
        <dt className="emp-rows__label">{r.label}</dt>
        <dd className="emp-rows__value">{r.value}</dd>
      </div>
    ))}
  </dl>
);

/** Label kecil untuk hal yang disimulasikan (GPS/kamera/QR buatan di build demo). */
export const SimulatedTag = ({ children = 'Simulasi' }: { children?: ReactNode }) => <span className="emp-sim-tag">{children}</span>;
