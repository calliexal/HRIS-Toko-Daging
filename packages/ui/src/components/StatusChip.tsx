import type { ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, type IconName } from './Icon';

/**
 * Tone mengikuti tabel status di Design System:
 * success = Hadir/Disetujui/Terkunci, warning = Terlambat/Menunggu/Perlu review,
 * danger = Mangkir/Ditolak/Error, info = Cuti/Izin/Sakit/Tugas Luar, neutral = Libur/Belum dijadwalkan.
 */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneIcon: Record<Tone, IconName> = {
  success: 'check-circle',
  warning: 'clock',
  danger: 'x-circle',
  info: 'info',
  neutral: 'minus',
};

export type StatusChipProps = {
  tone: Tone;
  children: ReactNode;
  /** Ganti ikon bawaan tone bila perlu. Status selalu tampil dengan kata + ikon. */
  icon?: IconName;
  size?: 'sm' | 'md';
  className?: string;
};

export const StatusChip = ({ tone, children, icon, size = 'sm', className }: StatusChipProps) => (
  <span className={cx('dp-chip', `dp-chip--${tone}`, size === 'md' && 'dp-chip--md', className)}>
    <Icon name={icon ?? toneIcon[tone]} size={size === 'md' ? 16 : 14} />
    <span>{children}</span>
  </span>
);
