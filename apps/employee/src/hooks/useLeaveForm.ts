import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi, useResource, type ISODate, type LeaveBalance, type LeavePreview, type LeaveType } from '@dagingpeople/api';

export type LeaveField = 'startDate' | 'endDate' | 'reason' | 'attachment';

export type LeaveValues = {
  type: LeaveType;
  startDate: ISODate;
  endDate: ISODate;
  reason: string;
  attachmentName: string;
};

export type LeaveErrors = Partial<Record<LeaveField, string>>;

const REASON_MIN = 5;

/** Aturan validasi sisi klien. Server tetap memvalidasi (saldo, surat dokter). */
const validate = (v: LeaveValues, preview: LeavePreview | undefined, balance: LeaveBalance | undefined, today: ISODate): LeaveErrors => {
  const errors: LeaveErrors = {};
  if (!v.startDate) errors.startDate = 'Pilih tanggal mulai.';
  else if (v.type === 'annual' && v.startDate < today) errors.startDate = 'Cuti tahunan dimulai paling cepat hari ini.';
  if (!v.endDate) errors.endDate = 'Pilih tanggal selesai.';
  else if (v.startDate && v.endDate < v.startDate) errors.endDate = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
  else if (preview && preview.workingDays === 0) errors.endDate = 'Rentang ini tidak berisi hari kerja (Minggu libur). Pilih tanggal lain.';
  else if (v.type === 'annual' && preview && balance && preview.workingDays > balance.annualRemaining)
    errors.endDate = `Saldo cuti tahunan Anda ${balance.annualRemaining} hari. Persingkat tanggal, atau pilih jenis Izin.`;
  if (v.reason.trim().length === 0) errors.reason = 'Tulis alasan singkat untuk penyetuju.';
  else if (v.reason.trim().length < REASON_MIN) errors.reason = 'Tulis sedikit lebih jelas, mis. "Acara keluarga".';
  if (preview?.attachmentRequired && !v.attachmentName) errors.attachment = 'Sakit lebih dari 1 hari wajib melampirkan surat dokter. Foto suratnya lalu unggah.';
  return errors;
};

export type LeaveSubmitResult = { id: string; days: number; balanceAfter: number | null; approverName: string };

/**
 * Form cuti LV-01: pratinjau durasi & saldo dari server, validasi saat blur,
 * error hilang begitu diperbaiki, error submit dari API diteruskan apa adanya (sudah berisi jalan keluar).
 */
export const useLeaveForm = (initial: Pick<LeaveValues, 'startDate' | 'endDate'>, today: ISODate) => {
  const api = useApi();
  const balance = useResource(() => api.employee.getLeaveBalance(), [api]);
  const [values, setValues] = useState<LeaveValues>({ type: 'annual', reason: '', attachmentName: '', ...initial });
  const [touched, setTouched] = useState<Partial<Record<LeaveField, boolean>>>({});
  const [submitError, setSubmitError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<LeaveSubmitResult>();

  const datesValid = !!values.startDate && !!values.endDate && values.endDate >= values.startDate;
  const preview = useResource<LeavePreview | undefined>(
    () => (datesValid ? api.employee.previewLeave({ type: values.type, startDate: values.startDate, endDate: values.endDate }) : Promise.resolve(undefined)),
    [api, values.type, values.startDate, values.endDate, datesValid],
  );
  const previewData = datesValid ? preview.data : undefined;

  const errors = useMemo(() => validate(values, previewData, balance.data, today), [values, previewData, balance.data, today]);
  const visibleErrors: LeaveErrors = useMemo(
    () => Object.fromEntries(Object.entries(errors).filter(([k]) => touched[k as LeaveField])) as LeaveErrors,
    [errors, touched],
  );

  // Error dari server dihapus begitu pengguna mengubah isian.
  useEffect(() => setSubmitError(undefined), [values]);

  const setField = useCallback(<K extends keyof LeaveValues>(key: K, value: LeaveValues[K]) => setValues((prev) => ({ ...prev, [key]: value })), []);
  const touch = useCallback((field: LeaveField) => setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true })), []);

  const submit = useCallback(async (): Promise<boolean> => {
    setTouched({ startDate: true, endDate: true, reason: true, attachment: true });
    if (Object.keys(errors).length > 0 || preview.loading) return false;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const res = await api.employee.submitLeave({
        type: values.type,
        startDate: values.startDate,
        endDate: values.endDate,
        reason: values.reason.trim(),
        attachmentName: values.attachmentName || undefined,
      });
      await balance.reload();
      setSubmitted({
        id: res.id,
        days: previewData?.workingDays ?? 0,
        balanceAfter: previewData?.balanceAfter ?? null,
        approverName: previewData?.approverName ?? 'Kepala Toko',
      });
      return true;
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Pengajuan belum terkirim.');
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [api, balance, errors, preview.loading, previewData, values]);

  const reset = useCallback(() => {
    setValues({ type: 'annual', reason: '', attachmentName: '', ...initial });
    setTouched({});
    setSubmitted(undefined);
    setSubmitError(undefined);
  }, [initial]);

  return {
    values,
    setField,
    touch,
    errors: visibleErrors,
    firstErrorField: (Object.keys(errors) as LeaveField[])[0],
    balance: balance.data,
    preview: previewData,
    previewLoading: datesValid && preview.loading,
    submit,
    submitting,
    submitError,
    submitted,
    reset,
  };
};
