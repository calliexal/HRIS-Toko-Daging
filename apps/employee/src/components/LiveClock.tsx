import { formatClock } from '@dagingpeople/api';
import { cx } from '@dagingpeople/ui';
import { useServerNow } from '../hooks/useExternal';

/**
 * Jam server berjalan. Komponen sendiri agar hanya bagian ini yang render ulang tiap detik.
 * `aria-live` sengaja tidak dipasang: pembaca layar tidak perlu diganggu tiap menit.
 */
export const LiveClock = ({ size = 'lg', className }: { size?: 'lg' | 'sm'; className?: string }) => {
  const now = useServerNow();
  const label = now ? formatClock(now.time) : '--.--';
  return (
    <span className={cx('emp-clock', `emp-clock--${size}`, className)}>
      <span className={size === 'lg' ? 't-clock' : 'dp-num'}>{label}</span>
      <span className="emp-clock__zone">WIB</span>
    </span>
  );
};
