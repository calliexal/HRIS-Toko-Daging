import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { AppLink } from '../link';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** md = 48px (aplikasi), dense = 36px (tabel admin), lg = 56px, kiosk = 72px, pill = tombol absen bulat 64px. */
export type ButtonSize = 'dense' | 'md' | 'lg' | 'kiosk' | 'pill';

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: IconName;
  loading?: boolean;
  children?: ReactNode;
  className?: string;
};

export type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

const classes = ({ variant = 'primary', size = 'md', block, loading }: CommonProps, className?: string) =>
  cx('dp-btn', `dp-btn--${variant}`, `dp-btn--${size}`, block && 'dp-btn--block', loading && 'dp-btn--loading', className);

const Content = ({ icon, loading, children }: CommonProps) => (
  <>
    {loading ? <span className="dp-btn__spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={20} /> : null}
    <span>{children}</span>
  </>
);

export const Button = ({ variant, size, block, icon, loading, children, className, disabled, type = 'button', ...rest }: ButtonProps) => (
  <button
    type={type}
    className={classes({ variant, size, block, loading }, className)}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...rest}
  >
    <Content icon={icon} loading={loading}>
      {children}
    </Content>
  </button>
);

export type ButtonLinkProps = CommonProps & { href: string; 'aria-label'?: string };

/** Tautan yang tampil sebagai tombol (navigasi). Untuk aksi, pakai <Button>. */
export const ButtonLink = ({ href, variant, size, block, icon, children, className, ...rest }: ButtonLinkProps) => (
  <AppLink href={href} className={classes({ variant, size, block }, className)} {...rest}>
    <Content icon={icon}>{children}</Content>
  </AppLink>
);

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/** Tombol ikon saja; `label` wajib dan dipakai sebagai aria-label serta tooltip. */
export const IconButton = ({ icon, label, variant = 'secondary', size = 'md', className, type = 'button', ...rest }: IconButtonProps) => (
  <button
    type={type}
    aria-label={label}
    title={label}
    className={cx('dp-btn', 'dp-btn--icon', `dp-btn--${variant}`, `dp-btn--${size}`, className)}
    {...rest}
  >
    <Icon name={icon} size={20} />
  </button>
);
