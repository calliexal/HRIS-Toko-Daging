import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi, type GeofenceCheck } from '@dagingpeople/api';
import { useServices } from '../context';
import { isDeviceError, type DeviceGeoFix } from '../device';
import { useOnline, useScenario } from './useExternal';

export type GeofenceState =
  | { status: 'checking' }
  | { status: 'ready'; fix: DeviceGeoFix; check: GeofenceCheck }
  /** Offline: GPS tetap terbaca, radius diperiksa server saat absen terkirim. */
  | { status: 'offline'; fix: DeviceGeoFix }
  | { status: 'error'; reason: 'permission_denied' | 'unavailable'; message: string };

/** Membaca GPS lalu menanyakan server apakah posisi di dalam radius lokasi kerja (ATT-01). */
export const useGeofence = (): { state: GeofenceState; recheck: () => void } => {
  const api = useApi();
  const { device } = useServices();
  const online = useOnline();
  const scenario = useScenario();
  const [state, setState] = useState<GeofenceState>({ status: 'checking' });
  const requestId = useRef(0);

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setState({ status: 'checking' });
    try {
      const fix = await device.getLocation();
      if (!device.isOnline()) {
        if (id === requestId.current) setState({ status: 'offline', fix });
        return;
      }
      const check = await api.employee.checkGeofence(fix);
      if (id === requestId.current) setState({ status: 'ready', fix, check });
    } catch (error) {
      if (id !== requestId.current) return;
      if (isDeviceError(error) && error.code === 'permission_denied') {
        setState({ status: 'error', reason: 'permission_denied', message: 'Izin lokasi belum diberikan. Buka Pengaturan HP, izinkan lokasi untuk DagingPeople, lalu coba lagi.' });
      } else {
        setState({ status: 'error', reason: 'unavailable', message: 'Lokasi belum terbaca. Pastikan GPS menyala dan coba lagi, atau absen di kiosk outlet.' });
      }
    }
  }, [api, device]);

  useEffect(() => {
    void run();
    // Ulangi saat jaringan atau skenario simulasi berubah.
  }, [run, online, scenario.geofence, scenario.mockLocation]);

  return { state, recheck: () => void run() };
};
