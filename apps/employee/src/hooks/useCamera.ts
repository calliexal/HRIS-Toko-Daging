import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useServices } from '../context';
import { isDeviceError, type CameraFacing, type CameraSession } from '../device';

export type CameraState =
  | { status: 'starting' }
  | { status: 'ready'; session: CameraSession }
  | { status: 'error'; message: string };

/** Membuka kamera saat komponen tampil dan menutupnya saat ditinggalkan (lampu kamera tidak menyala terus). */
export const useCamera = (videoRef: RefObject<HTMLVideoElement | null>, facing: CameraFacing, active = true) => {
  const { device } = useServices();
  const [state, setState] = useState<CameraState>({ status: 'starting' });
  const sessionRef = useRef<CameraSession | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setState({ status: 'starting' });
    device
      .openCamera(videoRef.current, facing)
      .then((session) => {
        if (cancelled) {
          session.stop();
          return;
        }
        sessionRef.current = session;
        setState({ status: 'ready', session });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message:
            isDeviceError(error) && error.code === 'permission_denied'
              ? 'Izin kamera belum diberikan. Buka Pengaturan HP, izinkan kamera untuk DagingPeople, lalu coba lagi.'
              : 'Kamera tidak bisa dibuka. Tutup aplikasi lain yang memakai kamera lalu coba lagi, atau absen di kiosk.',
        });
      });
    return () => {
      cancelled = true;
      sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, [device, facing, videoRef, active, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
};
