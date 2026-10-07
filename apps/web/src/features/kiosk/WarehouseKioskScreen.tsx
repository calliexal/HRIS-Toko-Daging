'use client';

import { Banner } from '@dagingpeople/ui';
import { CardScanner } from './CardScanner';
import { ClockConfirmation } from './ClockConfirmation';
import { KioskShell, kioskTitle, RecentClocks } from './KioskShell';
import { QrCode } from './QrCode';
import { useKioskCamera } from './useKioskCamera';
import { useCardClock, useDynamicQr, useKioskInfo, WAREHOUSE_KIOSK_ID } from './useKioskData';

/** K3 · Kiosk gudang: QR dinamis untuk dipindai aplikasi karyawan + kartu ID sebagai cadangan. */
export const WarehouseKioskScreen = ({ kioskId = WAREHOUSE_KIOSK_ID }: { kioskId?: string }) => {
  const { info, recent } = useKioskInfo(kioskId);
  const { qr, error, secondsLeft, fraction } = useDynamicQr(kioskId);
  const { reload: reloadRecent } = recent;
  const camera = useKioskCamera({ onToken: (token) => void card.submit(token) });
  const card = useCardClock(kioskId, camera.capture, () => void reloadRecent());

  return (
    <KioskShell title={kioskTitle(info.data)}>
      <div className="ksk-warehouse">
        <section className="ksk-panel ksk-qr-panel" aria-labelledby="ksk-qr-title">
          <div className="ksk-qr">
            {qr ? <QrCode value={qr.token} label="QR absen gudang, berganti otomatis" className="ksk-qr__img" /> : <div className="ksk-qr__img ksk-qr__img--empty" />}
          </div>
          <div className="ksk-qr-text">
            <h1 id="ksk-qr-title" className="ksk-title">
              Pindai QR ini dengan aplikasi DagingPeople
            </h1>
            <p className="ksk-body ksk-muted">Buka aplikasi, pilih Absen, lalu arahkan kamera ke kotak ini.</p>
            {error ? (
              <Banner tone="warning" title="QR belum diperbarui" className="ksk-banner">
                Koneksi ke server terputus. Pakai kartu ID dulu; QR muncul lagi saat koneksi pulih.
              </Banner>
            ) : (
              <div className="ksk-countdown">
                <div
                  className="ksk-progress"
                  role="progressbar"
                  aria-label="Sisa waktu QR"
                  aria-valuemin={0}
                  aria-valuemax={qr?.periodSeconds ?? 30}
                  aria-valuenow={secondsLeft}
                  aria-valuetext={`${secondsLeft} detik`}
                >
                  <span className="ksk-progress__bar" style={{ transform: `scaleX(${fraction})` }} />
                </div>
                <p className="ksk-countdown__text dp-num">QR berganti dalam {secondsLeft} detik</p>
              </div>
            )}
          </div>
        </section>

        <div className="ksk-side">
          <section className="ksk-panel" aria-labelledby="ksk-card-title">
            <h2 id="ksk-card-title" className="ksk-subtitle">
              Tidak bawa HP?
            </h2>
            {card.showing ? (
              <ClockConfirmation result={card.outcome?.result ?? null} failure={card.failure} onDismiss={card.dismiss} compact />
            ) : (
              <CardScanner camera={camera} onCard={(t) => void card.submit(t)} disabled={card.submitting} variant="compact" caption="Dekatkan kartu ID ke kamera" />
            )}
          </section>
          <section className="ksk-panel ksk-panel--grow">
            <RecentClocks items={recent.data} layout="list" />
          </section>
        </div>
      </div>
    </KioskShell>
  );
};
