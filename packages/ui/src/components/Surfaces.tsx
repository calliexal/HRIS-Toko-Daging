import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, type IconName } from './Icon';
import type { Tone } from './StatusChip';

export type CardProps = {
  title?: ReactNode;
  /** Elemen di kanan judul (tombol, filter). */
  actions?: ReactNode;
  footer?: ReactNode;
  /** `flush` menghapus padding isi (untuk tabel/list yang menempel ke tepi). */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
  as?: 'section' | 'div' | 'article';
};

export const Card = ({ title, actions, footer, flush, className, children, as: Tag = 'section' }: CardProps) => (
  <Tag className={cx('dp-card', className)}>
    {title || actions ? (
      <header className="dp-card__header">
        {title ? <h2 className="dp-card__title">{title}</h2> : <span />}
        {actions ? <div className="dp-card__actions">{actions}</div> : null}
      </header>
    ) : null}
    <div className={cx('dp-card__body', flush && 'dp-card__body--flush')}>{children}</div>
    {footer ? <footer className="dp-card__footer">{footer}</footer> : null}
  </Tag>
);

export type StatTileProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  /** Tile yang bisa diklik untuk memfilter; `pressed` menandai filter aktif. */
  pressed?: boolean;
};

export const StatTile = ({ label, value, tone = 'neutral', pressed, onClick, className, type = 'button', ...rest }: StatTileProps) => {
  const content = (
    <>
      <span className="dp-stat__label">{label}</span>
      <span className="dp-stat__value">{value}</span>
    </>
  );
  if (!onClick) {
    return <div className={cx('dp-stat', `dp-stat--${tone}`, className)}>{content}</div>;
  }
  return (
    <button
      type={type}
      onClick={onClick}
      aria-pressed={pressed}
      className={cx('dp-stat', 'dp-stat--interactive', `dp-stat--${tone}`, pressed && 'dp-stat--pressed', className)}
      {...rest}
    >
      {content}
    </button>
  );
};

const bannerIcon: Record<Tone, IconName> = {
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'x-circle',
  info: 'info',
  neutral: 'info',
};

export type BannerProps = {
  tone: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  className?: string;
  /** `alert` untuk pesan yang muncul akibat aksi pengguna dan harus diumumkan. */
  role?: 'status' | 'alert';
};

export const Banner = ({ tone, title, children, action, icon, className, role = 'status' }: BannerProps) => (
  <div className={cx('dp-banner', `dp-banner--${tone}`, className)} role={role}>
    <Icon name={icon ?? bannerIcon[tone]} size={20} className="dp-banner__icon" />
    <div className="dp-banner__body">
      {title ? <p className="dp-banner__title">{title}</p> : null}
      {children ? <div className="dp-banner__text">{children}</div> : null}
    </div>
    {action ? <div className="dp-banner__action">{action}</div> : null}
  </div>
);

export type EmptyStateProps = { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode };

export const EmptyState = ({ icon = 'check-circle', title, children, action }: EmptyStateProps) => (
  <div className="dp-empty">
    <Icon name={icon} size={28} />
    <p className="dp-empty__title">{title}</p>
    {children ? <p className="dp-empty__text">{children}</p> : null}
    {action}
  </div>
);

/** Placeholder pemuatan untuk konten > 1 detik. */
export const Skeleton = ({ height = 16, width = '100%', className }: { height?: number | string; width?: number | string; className?: string }) => (
  <span className={cx('dp-skeleton', className)} style={{ height, width }} aria-hidden="true" />
);

export const VisuallyHidden = ({ children }: { children: ReactNode }) => <span className="dp-visually-hidden">{children}</span>;

/** Penanda bahwa layar memakai data contoh (mock API). Hilang otomatis saat API asli dipakai. */
export const DemoBadge = ({ show = true }: { show?: boolean }) =>
  show ? <span className="dp-demo-badge">Data contoh</span> : null;
