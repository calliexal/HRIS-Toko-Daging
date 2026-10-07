'use client';

import { useApi } from '@dagingpeople/api';
import { Button, cx, Icon } from '@dagingpeople/ui';
import type { KioskCamera } from './useKioskCamera';
import { useSimulatedCards } from './useKioskData';

export type CardScannerProps = {
  camera: KioskCamera;
  onCard: (token: string) => void;
  disabled?: boolean;
  /** compact = panel kecil di kiosk gudang. */
  variant?: 'full' | 'compact';
  caption: string;
};

/**
 * Area kamera untuk kartu ID. Bila kamera atau BarcodeDetector tidak tersedia dan klien mock,
 * tampil tombol simulasi berlabel jelas agar alur tetap bisa diuji.
 */
export const CardScanner = ({ camera, onCard, disabled, variant = 'full', caption }: CardScannerProps) => {
  const api = useApi();
  const simulate = api.isMock && !camera.canScan && camera.status !== 'starting';
  const cards = useSimulatedCards(simulate, variant === 'full' ? 2 : 1);

  const statusText =
    camera.status === 'starting'
      ? 'Menyalakan kamera…'
      : camera.status === 'denied'
        ? 'Izin kamera belum diberikan. Minta Kepala Toko mengaktifkan kamera tablet.'
        : camera.status === 'unavailable'
          ? 'Kamera tidak tersedia di perangkat ini.'
          : !camera.canScan
            ? 'Pembaca kartu belum didukung di browser ini.'
            : null;

  return (
    <div className={cx('ksk-scanner', `ksk-scanner--${variant}`, camera.status === 'ready' && 'is-live')}>
      <video ref={camera.videoRef} className="ksk-scanner__video" muted playsInline aria-hidden="true" />
      <div className="ksk-scanner__overlay">
        <div className="ksk-scanner__frame" aria-hidden="true">
          <Icon name="id-card" size={variant === 'full' ? 48 : 32} />
        </div>
        <p className="ksk-scanner__caption">{caption}</p>
        {statusText && !simulate ? <p className="ksk-scanner__status">{statusText}</p> : null}
        {simulate && cards.length > 0 ? (
          <div className="ksk-sim" role="group" aria-label="Simulasi pindai kartu (data contoh)">
            <p className="ksk-sim__label">Mode demo · {camera.status === 'ready' ? 'pembaca kartu belum didukung' : 'kamera tidak tersedia'}</p>
            <div className="ksk-sim__buttons">
              {cards.map((c) => (
                <Button key={c.token} variant="secondary" size="kiosk" disabled={disabled} onClick={() => onCard(c.token)}>
                  Simulasi: {c.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
