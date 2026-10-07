import type { RefObject } from 'react';
import { Button, Icon } from '@dagingpeople/ui';
import type { CameraState } from '../hooks/useCamera';
import { SimulatedTag } from './Layout';

type SelfieCameraProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  state: CameraState;
  onRetry: () => void;
};

/** Area kamera depan dengan oval panduan wajah (M2). */
export const SelfieCamera = ({ videoRef, state, onRetry }: SelfieCameraProps) => {
  const kind = state.status === 'ready' ? state.session.kind : null;
  return (
    <div className="emp-camera emp-camera--selfie">
      <video ref={videoRef} className="emp-camera__video emp-camera__video--mirror" autoPlay playsInline muted hidden={kind !== 'preview'} aria-hidden="true" />
      {state.status === 'error' ? (
        <div className="emp-camera__placeholder" role="alert">
          <Icon name="camera" size={32} />
          <p className="t-body-strong">Kamera belum bisa dipakai</p>
          <p className="t-small">{state.message}</p>
          <Button variant="secondary" onClick={onRetry}>
            Coba Lagi
          </Button>
        </div>
      ) : kind === 'simulated' ? (
        <>
          <div className="emp-camera__placeholder">
            <Icon name="camera" size={32} />
          </div>
          <span className="emp-camera__badge">
            <SimulatedTag>Kamera simulasi · foto contoh</SimulatedTag>
          </span>
        </>
      ) : kind === 'system' ? (
        <div className="emp-camera__placeholder">
          <Icon name="camera" size={32} />
          <p className="t-small">Kamera depan terbuka saat Anda menekan tombol Ambil Foto.</p>
        </div>
      ) : state.status === 'starting' ? (
        <div className="emp-camera__placeholder">
          <span className="emp-spinner" aria-hidden="true" />
          <p className="t-small">Membuka kamera…</p>
        </div>
      ) : null}
      <div className="emp-camera__oval" aria-hidden="true" />
      <p className="emp-camera__caption">Posisikan wajah di dalam oval</p>
    </div>
  );
};
