'use client';

import { useEffect, useRef } from 'react';
import { formatClock, type KioskClockResult } from '@dagingpeople/api';
import { Button, Icon, StatusChip } from '@dagingpeople/ui';
import { CONFIRMATION_MS } from './useKioskData';

const rejectCopy = (result: Extract<KioskClockResult, { outcome: 'rejected' }>) => {
  switch (result.reason) {
    case 'unknown_card':
      return { title: 'Kartu belum terdaftar', text: 'Minta Kepala Toko memeriksa kartu Anda, atau absen dengan PIN.' };
    case 'wrong_pin':
      return { title: 'PIN belum cocok', text: `Sisa ${result.attemptsLeft ?? 0} kali percobaan.` };
    case 'locked':
      return {
        title: 'Akun dikunci sementara',
        text: `Terlalu banyak PIN salah. Coba lagi pukul ${result.lockedUntil ? formatClock(result.lockedUntil) : '—'}, atau minta bantuan Kepala Toko.`,
      };
  }
};

export type ClockConfirmationProps = {
  result: KioskClockResult | null;
  /** Pesan bila permintaan gagal (mis. koneksi). */
  failure?: string | null;
  onDismiss: () => void;
  /** Versi panel kecil (kiosk gudang). */
  compact?: boolean;
};

/** Hasil absen layar penuh selama 3 detik (ATT-02): nama, jam, status. */
export const ClockConfirmation = ({ result, failure, onDismiss, compact }: ClockConfirmationProps) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [result, failure]);

  const recorded = result?.outcome === 'recorded' ? result : null;
  const rejected = result?.outcome === 'rejected' ? rejectCopy(result) : null;
  const tone = recorded ? 'success' : 'danger';

  return (
    <div ref={ref} className={`ksk-confirm ksk-confirm--${tone}${compact ? ' ksk-confirm--compact' : ''}`} role={recorded ? 'status' : 'alert'} tabIndex={-1} style={{ ['--ksk-confirm-ms' as string]: `${CONFIRMATION_MS}ms` }}>
      <span className="ksk-confirm__icon" aria-hidden="true">
        <Icon name={recorded ? 'check-circle' : 'x-circle'} size={compact ? 40 : 72} />
      </span>
      {recorded ? (
        <>
          <p className="ksk-confirm__eyebrow">{recorded.direction === 'in' ? 'Absen masuk tercatat' : 'Absen pulang tercatat'}</p>
          <p className="ksk-confirm__name">{recorded.name}</p>
          <p className="ksk-confirm__time dp-num">{formatClock(recorded.time)} WIB</p>
          <StatusChip tone={recorded.status === 'late' ? 'warning' : 'success'} size="md" className="ksk-chip-lg">
            {recorded.status === 'late' ? `Terlambat ${recorded.lateMinutes} mnt` : 'Tepat waktu'}
          </StatusChip>
        </>
      ) : (
        <>
          <p className="ksk-confirm__name">{rejected?.title ?? 'Absen belum tercatat'}</p>
          <p className="ksk-confirm__text">{rejected?.text ?? failure}</p>
        </>
      )}
      <div className="ksk-confirm__progress" aria-hidden="true">
        <span />
      </div>
      {compact ? null : (
        <Button variant="secondary" size="kiosk" onClick={onDismiss}>
          Selesai
        </Button>
      )}
    </div>
  );
};
