'use client';

import { useEffect } from 'react';
import { AppLink, Banner, Button, cx } from '@dagingpeople/ui';
import { useWebPaths } from '../paths';
import { ClockConfirmation } from './ClockConfirmation';
import { KioskShell, kioskTitle } from './KioskShell';
import { useKioskCamera } from './useKioskCamera';
import { OUTLET_KIOSK_ID, useKioskInfo } from './useKioskData';
import { CODE_LENGTH, PIN_LENGTH, usePinClock } from './usePinClock';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const PinDots = ({ filled }: { filled: number }) => (
  <div className="ksk-dots" aria-hidden="true">
    {Array.from({ length: PIN_LENGTH }, (_, i) => (
      <span key={i} className={cx('ksk-dot', i < filled && 'is-filled')} />
    ))}
  </div>
);

/** K2 · Absen dengan nomor karyawan + PIN. Keypad layar dan keyboard fisik. */
export const PinKioskScreen = ({ kioskId = OUTLET_KIOSK_ID }: { kioskId?: string }) => {
  const paths = useWebPaths();
  const { info, recent } = useKioskInfo(kioskId);
  // Kamera hanya untuk foto bukti setelah PIN benar; tidak memindai kartu di layar ini.
  const camera = useKioskCamera({ scan: false });
  const { reload: reloadRecent } = recent;
  const vm = usePinClock(kioskId, camera.capture, () => void reloadRecent());
  const { pressDigit, backspace, submit, step } = vm;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        pressDigit(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        backspace();
      } else if (event.key === 'Enter' && step === 'pin' && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pressDigit, backspace, submit, step]);

  const busy = vm.looking || vm.submitting;
  const canSubmit = step === 'pin' && vm.pin.length === PIN_LENGTH && !busy && !vm.locked;

  return (
    <KioskShell title={kioskTitle(info.data)}>
      <video ref={camera.videoRef} className="ksk-hidden-video" muted playsInline aria-hidden="true" />
      {vm.success ? (
        <ClockConfirmation result={vm.success} onDismiss={vm.reset} />
      ) : (
        <div className="ksk-pin">
          <div className="ksk-pin__form">
            <h1 className="ksk-title">Absen dengan PIN</h1>

            <div className="ksk-pin__group">
              <p className="ksk-label" id="ksk-code-label">
                Nomor karyawan
              </p>
              <div className={cx('ksk-code', step === 'code' && 'is-active')} role="status" aria-labelledby="ksk-code-label" aria-live="polite">
                <span className="dp-num">{vm.code.padEnd(CODE_LENGTH, '·')}</span>
              </div>
              <p className="ksk-body ksk-muted ksk-pin__who" aria-live="polite">
                {vm.looking ? 'Mencari…' : vm.identity ? `${vm.identity.name} · ${vm.identity.position}` : '4 digit terakhir nomor di kartu ID'}
              </p>
            </div>

            <div className={cx('ksk-pin__group', step !== 'pin' && 'is-dimmed')}>
              <p className="ksk-label">PIN 6 digit</p>
              <PinDots filled={vm.pin.length} />
              <p className="dp-visually-hidden" aria-live="polite">
                {step === 'pin' ? `${vm.pin.length} dari ${PIN_LENGTH} digit PIN terisi` : ''}
              </p>
            </div>

            <div aria-live="assertive" className="ksk-pin__message">
              {vm.message ? (
                <Banner tone={vm.message.tone} role="alert" title={vm.message.title} className="ksk-banner">
                  {vm.message.text}
                </Banner>
              ) : (
                <p className="ksk-body ksk-muted">Setelah PIN benar, kamera memotret wajah Anda untuk bukti absen.</p>
              )}
            </div>

            <div className="ksk-pin__links">
              {vm.locked || vm.identity ? (
                <Button variant="secondary" size="kiosk" onClick={vm.reset}>
                  Ganti Nomor Karyawan
                </Button>
              ) : null}
              <AppLink href={paths.kioskOutlet} className="ksk-back-link">
                Kembali ke pindai kartu
              </AppLink>
            </div>
          </div>

          <div className="ksk-keypad" role="group" aria-label={step === 'code' ? 'Keypad nomor karyawan' : 'Keypad PIN'}>
            {DIGITS.map((d) => (
              <button key={d} type="button" className="ksk-key dp-num" onClick={() => pressDigit(d)} disabled={busy || vm.locked}>
                {d}
              </button>
            ))}
            <button type="button" className="ksk-key ksk-key--muted" onClick={backspace} disabled={busy || vm.locked} aria-label="Hapus satu digit">
              Hapus
            </button>
            <button type="button" className="ksk-key dp-num" onClick={() => pressDigit('0')} disabled={busy || vm.locked}>
              0
            </button>
            <button type="button" className={cx('ksk-key ksk-key--primary', vm.submitting && 'is-loading')} onClick={() => void submit()} disabled={!canSubmit} aria-busy={vm.submitting || undefined}>
              {vm.submitting ? <span className="dp-btn__spinner" aria-hidden="true" /> : null}
              Absen
            </button>
          </div>
        </div>
      )}
    </KioskShell>
  );
};
