'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  attendanceStatusMeta,
  clockMethodLabel,
  formatClock,
  formatDateShort,
  useApi,
  useResource,
  type AttendanceRecord,
} from '@dagingpeople/api';

export type AttendanceFilter = 'all' | 'scheduled' | 'on_time' | 'late' | 'not_yet' | 'leave';

const REFRESH_MS = 60_000;

const matchesFilter = (record: AttendanceRecord, filter: AttendanceFilter): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'scheduled':
      return record.shift !== null;
    default:
      return record.status === filter;
  }
};

/** Data layar Kehadiran hari ini: ringkasan, tabel, anomali, filter, pencarian, dan ekspor CSV. */
export const useAttendanceToday = () => {
  const api = useApi();
  const [locationId, setLocationId] = useState('kemang');
  const [filter, setFilter] = useState<AttendanceFilter>('all');
  const [query, setQuery] = useState('');

  const locations = useResource(() => api.admin.listLocations(), [api]);
  const summary = useResource(() => api.admin.getAttendanceSummary(locationId), [api, locationId]);
  const records = useResource(() => api.admin.getAttendanceRecords(locationId), [api, locationId]);
  const anomalies = useResource(() => api.admin.getAnomalies(locationId), [api, locationId]);

  // Pembaruan berkala agar "diperbarui HH.mm" tetap jujur tanpa perlu muat ulang halaman.
  const { reload: reloadSummary } = summary;
  const { reload: reloadRecords } = records;
  useEffect(() => {
    const timer = setInterval(() => {
      void reloadSummary();
      void reloadRecords();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reloadSummary, reloadRecords, locationId]);

  const changeLocation = (next: string) => {
    setLocationId(next);
    setFilter('all');
    setQuery('');
  };

  /** Klik tile aktif sekali lagi = hapus filter. */
  const toggleFilter = (next: AttendanceFilter) => setFilter((current) => (current === next ? 'all' : next));

  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (records.data ?? []).filter((r) => matchesFilter(r, filter) && (!needle || r.employee.name.toLowerCase().includes(needle)));
  }, [records.data, filter, query]);

  const locationName = locations.data?.find((l) => l.id === locationId)?.name ?? '';

  const exportCsv = (): string | null => {
    const rows = records.data;
    if (!rows || rows.length === 0 || !summary.data) return null;
    const escape = (value: string) => (/[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const header = ['Tanggal', 'Lokasi', 'Kode', 'Nama', 'Jabatan', 'Shift', 'Masuk', 'Pulang', 'Metode', 'Status'];
    const lines = rows.map((r) =>
      [
        formatDateShort(r.date),
        locationName,
        r.employee.code,
        r.employee.name,
        r.employee.position,
        r.shift ? `${r.shift.name} ${formatClock(r.shift.start)}-${formatClock(r.shift.end)}` : '',
        r.clockIn ? formatClock(r.clockIn) : '',
        r.clockOut ? formatClock(r.clockOut) : '',
        r.method ? clockMethodLabel[r.method] : '',
        attendanceStatusMeta(r.status, r.lateMinutes, r.leaveLabel).label,
      ]
        .map(escape)
        .join(','),
    );
    const csv = `﻿${[header.join(','), ...lines].join('\r\n')}`;
    const fileName = `rekap-kehadiran-${locationId}-${summary.data.date}.csv`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
  };

  return {
    locationId,
    locationName,
    changeLocation,
    locations,
    summary,
    records,
    anomalies,
    filter,
    toggleFilter,
    query,
    setQuery,
    visibleRecords,
    exportCsv,
  };
};
