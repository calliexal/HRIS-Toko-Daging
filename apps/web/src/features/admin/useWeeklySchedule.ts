'use client';

import { useCallback, useState } from 'react';
import { useApi, useResource, type ScheduleCell } from '@dagingpeople/api';
import { errorMessage, useTransientMessage } from '../shared/hooks';

export type ScheduleNotice = { tone: 'success' | 'danger'; text: string };

/** Data + mutasi layar Jadwal Shift. Setiap mutasi mengembalikan jadwal terbaru dari server. */
export const useWeeklySchedule = (locationId = 'kemang') => {
  const api = useApi();
  const schedule = useResource(() => api.admin.getWeekSchedule(locationId), [api, locationId]);
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useTransientMessage<ScheduleNotice>(8000);
  const { setData } = schedule;
  const weekStart = schedule.data?.weekStart;

  const updateCell = useCallback(
    async (employeeId: string, dayIndex: number, cell: ScheduleCell) => {
      if (!weekStart) return;
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
    if (!weekStart) return false;
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

  return { schedule, updateCell, pendingCell, publish, publishing, notice };
};
