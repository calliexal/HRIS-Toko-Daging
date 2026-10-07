'use client';

import { formatDateLong } from '@dagingpeople/api';
import { ButtonLink } from '@dagingpeople/ui';
import { useWebPaths } from '../paths';
import { CardScanner } from './CardScanner';
import { ClockConfirmation } from './ClockConfirmation';
import { KioskClock, KioskShell, kioskTitle, RecentClocks } from './KioskShell';
import { useKioskCamera } from './useKioskCamera';
import { OUTLET_KIOSK_ID, useCardClock, useKioskInfo } from './useKioskData';
import { useServerClock } from './useServerClock';

/** K1 · Kiosk outlet: pindai kartu ID ber-QR, foto otomatis, konfirmasi 3 detik. */
export const OutletKioskScreen = ({ kioskId = OUTLET_KIOSK_ID }: { kioskId?: string }) => {
  const paths = useWebPaths();
  const { info, recent } = useKioskInfo(kioskId);
  const clock = useServerClock();
  const { reload: reloadRecent } = recent;

  // Kamera butuh `submit`, alur kartu butuh `capture`: callback dipanggil belakangan, jadi urutan aman.
  // Pemindaian ganda selama konfirmasi tampil diabaikan oleh useCardClock.
  const camera = useKioskCamera({ onToken: (token) => void card.submit(token) });
  const card = useCardClock(kioskId, camera.capture, () => void reloadRecent());

  return (
    <KioskShell title={kioskTitle(info.data)} footer={<RecentClocks items={recent.data} layout="bar" />}>
      {card.showing ? (
        <ClockConfirmation result={card.outcome?.result ?? null} failure={card.failure} onDismiss={card.dismiss} />
      ) : (
        <div className="ksk-outlet">
          <div className="ksk-outlet__text">
            <KioskClock dateLabel={clock.date ? formatDateLong(clock.date) : null} time={clock.time} />
            <h1 className="ksk-title">Dekatkan kartu ID Anda ke kamera</h1>
            <p className="ksk-body ksk-muted">Foto diambil otomatis setelah kartu terbaca. Jangan lepas masker atau penutup kepala.</p>
            <p className="ksk-live" aria-live="polite">
              {card.submitting ? 'Membaca kartu…' : ''}
            </p>
            <ButtonLink href={paths.kioskPin} variant="secondary" size="kiosk" icon="lock" className="ksk-pin-link">
              Tidak bawa kartu? Pakai PIN
            </ButtonLink>
          </div>
          <CardScanner camera={camera} onCard={(t) => void card.submit(t)} disabled={card.submitting} caption="Kamera tablet · arahkan kartu ke kotak" />
        </div>
      )}
    </KioskShell>
  );
};
