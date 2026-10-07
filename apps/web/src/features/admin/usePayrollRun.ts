'use client';

import { useCallback, useMemo, useState } from 'react';
import { ApiError, useApi, useResource, type HrisClient, type HttpHrisClient, type PayrollRow, type PayrollRun } from '@dagingpeople/api';
import { errorMessage, useTransientMessage } from '../shared/hooks';

export type PayrollFilter = 'all' | 'needs_review' | 'casual' | 'overtime';

export type PayrollNotice = { tone: 'success' | 'danger' | 'info'; text: string };

const matches = (row: PayrollRow, filter: PayrollFilter): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'needs_review':
      return row.issue !== undefined;
    case 'casual':
      return row.employee.employmentType === 'HARIAN';
    case 'overtime':
      return row.overtimeHours > 0;
  }
};

/**
 * Kontrak HrisClient saat ini belum punya endpoint kunci periode (PAY-03).
 * Bila implementasi HTTP menambahkannya, layar langsung memakainya tanpa perubahan.
 */
type PayrollLockCapable = { lockPayrollPeriod?: (period: string) => Promise<PayrollRun> };

const lockEndpoint = (admin: HrisClient['admin']) => (admin as HrisClient['admin'] & PayrollLockCapable).lockPayrollPeriod;

export const stepStatus = (run: PayrollRun | undefined, key: PayrollRun['steps'][number]['key']) => run?.steps.find((s) => s.key === key)?.status;

/** Tanggal tutup buku payroll: periode YYYY-MM mencakup tanggal 26 bulan sebelumnya s.d. tanggal 25 bulan itu. */
const CUTOFF_DAY = 25;

/** Periode payroll yang sedang berjalan menurut tanggal WIB hari ini. */
export const currentPayrollPeriod = (now = new Date()): string => {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now).split('-').map(Number) as [number, number, number];
  const [year, month] = d > CUTOFF_DAY ? (m === 12 ? [y + 1, 1] : [y, m + 1]) : [y, m];
  return `${year}-${String(month).padStart(2, '0')}`;
};

type PeriodCreator = Pick<HttpHrisClient, 'payrollOps'>;

const canCreatePeriod = (api: HrisClient): api is HrisClient & PeriodCreator => 'payrollOps' in api;

/** Periode yang belum pernah dibuka dibuat otomatis (hanya klien HTTP; server tetap memeriksa peran HR). */
const loadRun = async (api: HrisClient, period: string): Promise<PayrollRun> => {
  try {
    return await api.admin.getPayrollRun(period);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'PERIOD_NOT_FOUND' && canCreatePeriod(api)) return api.payrollOps.createPeriod(period);
    throw e;
  }
};

export const usePayrollRun = (period = currentPayrollPeriod()) => {
  const api = useApi();
  const run = useResource(() => loadRun(api, period), [api, period]);
  const [filter, setFilter] = useState<PayrollFilter>('needs_review');
  const [busy, setBusy] = useState<'recalculate' | 'submit' | 'lock' | null>(null);
  const [notice, setNotice] = useTransientMessage<PayrollNotice>(8000);
  const { setData } = run;

  const rows = useMemo(() => (run.data?.rows ?? []).filter((r) => matches(r, filter)), [run.data, filter]);

  const mutate = useCallback(
    async (kind: 'recalculate' | 'submit' | 'lock', action: () => Promise<PayrollRun>, success: string, failure: string) => {
      setBusy(kind);
      try {
        setData(await action());
        setNotice({ tone: 'success', text: success });
        return true;
      } catch (e) {
        setNotice({ tone: 'danger', text: errorMessage(e, failure) });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [setData, setNotice],
  );

  const recalculate = () =>
    mutate('recalculate', () => api.admin.recalculatePayroll(period), 'Perhitungan diperbarui dengan data absensi dan karyawan terbaru.', 'Perhitungan ulang belum selesai. Coba lagi beberapa saat lagi.');

  const submitForApproval = () =>
    mutate('submit', () => api.admin.submitPayrollForApproval(period), 'Payroll dikirim ke Owner untuk disetujui. Anda akan mendapat notifikasi saat disetujui.', 'Payroll belum terkirim. Periksa koneksi lalu coba lagi.');

  const lockFn = lockEndpoint(api.admin);
  const lockPeriod = () =>
    lockFn
      ? mutate('lock', () => lockFn(period), 'Periode dikunci. File Mandiri MCM siap diekspor.', 'Periode belum terkunci. Coba lagi.')
      : Promise.resolve(false);

  const ownerApproved = stepStatus(run.data, 'owner_approval') === 'done';
  const submitted = stepStatus(run.data, 'hr_review') === 'done';
  const locked = stepStatus(run.data, 'lock_period') === 'done';

  const lockBlockedReason = locked
    ? 'Periode sudah dikunci.'
    : !ownerApproved
      ? 'Kunci Periode aktif setelah Owner menyetujui payroll ini.'
      : !lockFn
        ? 'Penguncian periode belum tersambung ke server.'
        : null;

  return {
    run,
    filter,
    setFilter,
    rows,
    busy,
    notice,
    setNotice,
    recalculate,
    submitForApproval,
    lockPeriod,
    submitted,
    ownerApproved,
    locked,
    lockBlockedReason,
  };
};
