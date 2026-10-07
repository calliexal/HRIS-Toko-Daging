'use client';

import { useCallback, useState } from 'react';
import { useApi, useResource, type AdminWeekSchedule, type ScheduleCell } from '@dagingpeople/api';
import { errorMessage, useTransientMessage } from '../shared/hooks';

export type ScheduleNotice = { tone: 'success' | 'danger'; text: string };

/** Belum ada lokasi terpilih: biarkan resource tetap "memuat" alih-alih memanggil API dengan id kosong. */
const idle = <T,>() => new Promise<T>(() => undefined);

/** Data + mutasi layar Jadwal Shift. Setiap mutasi mengembalikan jadwal terbaru dari server. */
export const useWeeklySchedule = () => {
  const api = useApi();
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const locations = useResource(() => api.admin.listLocations(), [api]);
  // Default = lokasi pertama yang boleh dilihat akun ini (Kepala Toko hanya punya lokasinya sendiri).
  const locationId = selectedLocationId ?? locations.data?.[0]?.id ?? null;
  const noLocations = locations.data !== undefined && locations.data.length === 0;
  const schedule = useResource(() => (locationId ? api.admin.getWeekSchedule(locationId) : idle<AdminWeekSchedule>()), [api, locationId]);
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useTransientMessage<ScheduleNotice>(8000);
  const { setData } = schedule;
  const weekStart = schedule.data?.weekStart;

  const updateCell = useCallback(
    async (employeeId: string, dayIndex: number, cell: ScheduleCell) => {
      if (!weekStart || !locationId) return;
      const key = `${employeeId}:${dayIndex}`;
      setPendingCell(key);
      try {
        setData(await api.admin.updateScheduleCell(locationId, weekStart, employeeId, dayIndex, cell));
      } catch (e) {
        setNotice({ tone: 'danger', text: errorMessage(e, 'Shift belum tersimpan. Coba lagi.') });
      } finally {
        setPendingCell(null);
      }
    },
    [api, locationId, weekStart, setData, setNotice],
  );

  const publish = useCallback(async (): Promise<boolean> => {
    if (!weekStart || !locationId) return false;
    setPublishing(true);
    try {
      setData(await api.admin.publishSchedule(locationId, weekStart));
      setNotice({ tone: 'success', text: 'Jadwal terbit. Karyawan melihat jadwal baru di aplikasi mereka.' });
      return true;
    } catch (e) {
      setNotice({ tone: 'danger', text: errorMessage(e, 'Jadwal belum terbit. Periksa koneksi lalu coba lagi.') });
      return false;
    } finally {
      setPublishing(false);
    }
  }, [api, locationId, weekStart, setData, setNotice]);

  return { locations, locationId, changeLocation: setSelectedLocationId, noLocations, schedule, updateCell, pendingCell, publish, publishing, notice };
};
