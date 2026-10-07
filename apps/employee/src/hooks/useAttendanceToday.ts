import { useEffect, useMemo, useRef } from 'react';
import { addSecondsToClock, useApi, useResource, type ClockDirection, type ClockTime, type TodayShift } from '@dagingpeople/api';
import { useServices } from '../context';
import { loadToday, saveToday } from './todayCache';
import { useQueue } from './useExternal';

export type ClockMark = { time: ClockTime; queued: boolean } | null;

export type AttendanceToday = {
  today: TodayShift | undefined;
  /** true = data dari cache HP karena server tidak terjangkau. */
  stale: boolean;
  loading: boolean;
  error: Error | undefined;
  reload: () => Promise<void>;
  clockIn: ClockMark;
  clockOut: ClockMark;
  /** Aksi berikutnya; null bila masuk dan pulang sudah tercatat. */
  nextDirection: ClockDirection | null;
};

/**
 * Data shift hari ini + absen yang masih di antrean offline.
 * Juga menyetel jam server (serverTime) agar jam di layar tidak bergantung pada jam HP.
 */
export const useAttendanceToday = (): AttendanceToday => {
  const api = useApi();
  const { serverClock } = useServices();
  const queue = useQueue();
  const resource = useResource(() => api.employee.getToday(), [api]);
  const cached = useMemo(() => (resource.error ? loadToday() : null), [resource.error]);
  const today = resource.data ?? cached?.today;
  const stale = !resource.data && !!cached;

  useEffect(() => {
    if (resource.data) {
      saveToday(resource.data);
      serverClock.anchor(resource.data.date, resource.data.serverTime);
    } else if (cached && !serverClock.now()) {
      // Cold start offline: perkiraan jam server dari cache + selisih jam HP (fallback terakhir).
      const elapsed = Math.max(0, Math.floor((Date.now() - cached.savedAt) / 1000));
      serverClock.anchor(cached.today.date, addSecondsToClock(`${cached.today.serverTime}:00`, elapsed));
    }
  }, [resource.data, cached, serverClock]);

  // Antrean berkurang (terkirim) → muat ulang agar status dari server tampil.
  const pendingCount = queue.pending.length;
  const prevPending = useRef(pendingCount);
  const { reload } = resource;
  useEffect(() => {
    if (pendingCount < prevPending.current) void reload();
    prevPending.current = pendingCount;
  }, [pendingCount, reload]);

  return useMemo(() => {
    const queuedFor = (direction: ClockDirection) =>
      queue.pending.find((p) => p.request.direction === direction && (!today || p.date === today.date));
    const mark = (server: ClockTime | null | undefined, direction: ClockDirection): ClockMark => {
      if (server) return { time: server, queued: false };
      const local = queuedFor(direction);
      return local ? { time: local.time, queued: true } : null;
    };
    const clockIn = mark(today?.clockIn, 'in');
    const clockOut = mark(today?.clockOut, 'out');
    return {
      today,
      stale,
      loading: resource.loading,
      error: today ? undefined : resource.error,
      reload,
      clockIn,
      clockOut,
      nextDirection: !clockIn ? 'in' : !clockOut ? 'out' : null,
    };
  }, [today, stale, resource.loading, resource.error, reload, queue.pending]);
};
