import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatDateShort, useApi, useResource, type LeaveType } from '@dagingpeople/api';
import { Banner, Button, ButtonLink, Icon, SelectField, Skeleton, TextAreaField, TextField } from '@dagingpeople/ui';
import { RowList, Screen, TaskHeader } from '../components/Layout';
import { useLeaveForm, type LeaveField } from '../hooks/useLeaveForm';

const TYPE_OPTIONS: readonly { value: LeaveType; label: string }[] = [
  { value: 'annual', label: 'Cuti tahunan' },
  { value: 'permit', label: 'Izin' },
  { value: 'sick', label: 'Sakit' },
];

const typeLabel = (t: LeaveType) => TYPE_OPTIONS.find((o) => o.value === t)?.label ?? '';

const isLeaveType = (v: string): v is LeaveType => TYPE_OPTIONS.some((o) => o.value === v);

const FIELD_IDS: Record<LeaveField, string> = {
  startDate: 'emp-leave-start',
  endDate: 'emp-leave-end',
  reason: 'emp-leave-reason',
  attachment: 'emp-leave-attachment',
};

type AttachmentProps = { name: string; required: boolean; error?: string; onPick: (name: string) => void; onBlur: () => void };

/** Lampiran surat dokter. Input file asli disembunyikan; label besar menjadi area sentuh 64px. */
const AttachmentField = ({ name, required, error, onPick, onBlur }: AttachmentProps) => (
  <div className={`dp-field${error ? ' dp-field--error' : ''}`}>
    <span className="dp-field__label" id="emp-leave-attachment-label">
      Lampiran <span className="emp-muted emp-normal">{required ? '(wajib untuk sakit lebih dari 1 hari)' : '(opsional)'}</span>
    </span>
    <input
      id={FIELD_IDS.attachment}
      type="file"
      accept="image/*,application/pdf"
      className="dp-visually-hidden"
      aria-labelledby="emp-leave-attachment-label emp-leave-attachment-cta"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? 'emp-leave-attachment-error' : undefined}
      onChange={(e) => {
        onPick(e.target.files?.[0]?.name ?? '');
        onBlur();
      }}
    />
    <label htmlFor={FIELD_IDS.attachment} className="emp-upload" id="emp-leave-attachment-cta">
      <Icon name={name ? 'file-text' : 'upload'} size={20} />
      <span className="emp-upload__text">{name || 'Foto atau unggah surat dokter'}</span>
      {name ? <span className="emp-upload__change">Ganti</span> : null}
    </label>
    {error ? (
      <p id="emp-leave-attachment-error" className="dp-field__error" role="alert">
        {error}
      </p>
    ) : null}
  </div>
);

const Success = ({ days, balanceAfter, approverName, type, start, end, onAgain }: { days: number; balanceAfter: number | null; approverName: string; type: LeaveType; start: string; end: string; onAgain: () => void }) => {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <Screen
      footer={
        <>
          <ButtonLink href="/beranda" size="lg" block>
            Kembali ke Beranda
          </ButtonLink>
          <Button variant="ghost" block onClick={onAgain}>
            Ajukan Lagi
          </Button>
        </>
      }
    >
      <div className="emp-result__hero" role="status">
        <span className="emp-result__badge emp-result__badge--success">
          <Icon name="send" size={40} />
        </span>
        <h2 ref={ref} tabIndex={-1} className="emp-result__title">
          Pengajuan terkirim
        </h2>
        <p className="t-body emp-center">Menunggu keputusan {approverName}. Anda akan mendapat notifikasi.</p>
      </div>
      <RowList
        rows={[
          { label: 'Jenis', value: typeLabel(type) },
          { label: 'Tanggal', value: start === end ? formatDateShort(start) : `${formatDateShort(start)} – ${formatDateShort(end)}` },
          { label: 'Durasi', value: <span className="dp-num">{days} hari kerja</span> },
          ...(balanceAfter !== null ? [{ label: 'Saldo cuti tahunan', value: <b className="dp-num">{balanceAfter} hari</b> }] : []),
        ]}
      />
      {balanceAfter !== null ? <p className="t-small emp-muted emp-center">Saldo ditahan sampai pengajuan diputuskan. Bila ditolak, saldo kembali.</p> : null}
    </Screen>
  );
};

/** M6 (LV-01): ajukan cuti / izin / sakit. */
export const LeaveScreen = () => {
  const api = useApi();
  const todayRes = useResource(() => api.employee.getToday(), [api]);
  const today = todayRes.data?.date ?? '';
  const initial = useMemo(() => ({ startDate: '', endDate: '' }), []);
  const form = useLeaveForm(initial, today);
  const { values, errors, preview, balance } = form;
  const [attempted, setAttempted] = useState(false);

  if (form.submitted) {
    return (
      <>
        <TaskHeader title="Ajukan Cuti / Izin" />
        <Success {...form.submitted} type={values.type} start={values.startDate} end={values.endDate} onAgain={form.reset} />
      </>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    const ok = await form.submit();
    if (!ok && form.firstErrorField) document.getElementById(FIELD_IDS[form.firstErrorField])?.focus();
  };

  const errorCount = Object.keys(errors).length;

  return (
    <>
      <TaskHeader title="Ajukan Cuti / Izin" />
      <form className="emp-form" noValidate onSubmit={(e) => void handleSubmit(e)}>
        <Screen
          footer={
            <Button type="submit" size="lg" block icon="send" loading={form.submitting}>
              Kirim Pengajuan
            </Button>
          }
        >
          {attempted && errorCount > 0 ? (
            <Banner tone="danger" role="alert" title="Periksa isian yang ditandai">
              Ada {errorCount} isian yang perlu dilengkapi sebelum pengajuan dikirim.
            </Banner>
          ) : null}
          {form.submitError ? (
            <Banner tone="danger" role="alert" title="Pengajuan belum terkirim">
              {form.submitError} Ubah isian lalu kirim lagi, atau tanyakan Kepala Toko bila perlu bantuan.
            </Banner>
          ) : null}

          <SelectField
            label="Jenis pengajuan"
            value={values.type}
            options={TYPE_OPTIONS}
            onChange={(e) => {
              if (isLeaveType(e.target.value)) form.setField('type', e.target.value);
            }}
          />

          <div className="emp-grid-2">
            <TextField
              id={FIELD_IDS.startDate}
              type="date"
              label="Mulai"
              value={values.startDate}
              min={values.type === 'annual' ? today || undefined : undefined}
              error={errors.startDate}
              onChange={(e) => {
                form.setField('startDate', e.target.value);
                if (!values.endDate || values.endDate < e.target.value) form.setField('endDate', e.target.value);
              }}
              onBlur={() => form.touch('startDate')}
            />
            <TextField
              id={FIELD_IDS.endDate}
              type="date"
              label="Selesai"
              value={values.endDate}
              min={values.startDate || undefined}
              error={errors.endDate}
              onChange={(e) => form.setField('endDate', e.target.value)}
              onBlur={() => form.touch('endDate')}
            />
          </div>

          <section className="emp-summary" aria-live="polite" aria-label="Ringkasan pengajuan">
            <div className="emp-summary__row">
              <span className="emp-muted">Durasi</span>
              <span className="t-body-strong dp-num">{form.previewLoading ? <Skeleton width={80} height={18} /> : preview ? `${preview.workingDays} hari kerja` : '—'}</span>
            </div>
            {values.type === 'annual' ? (
              <div className="emp-summary__row">
                <span className="emp-muted">Saldo cuti tahunan</span>
                <span className="t-body-strong dp-num">
                  {!balance ? <Skeleton width={80} height={18} /> : preview?.balanceAfter != null ? `${balance.annualRemaining} → ${preview.balanceAfter} hari` : `${balance.annualRemaining} hari`}
                </span>
              </div>
            ) : null}
            <p className="t-caption emp-muted">
              {values.type === 'annual' ? 'Saldo ditahan sampai pengajuan diputuskan. ' : 'Izin dan sakit tidak memotong saldo cuti tahunan. '}Minggu tidak dihitung hari kerja.
            </p>
          </section>

          <TextAreaField
            id={FIELD_IDS.reason}
            label="Alasan"
            value={values.reason}
            maxLength={300}
            placeholder={values.type === 'sick' ? 'Contoh: demam, istirahat sesuai surat dokter' : 'Contoh: acara keluarga di kampung'}
            error={errors.reason}
            onChange={(e) => form.setField('reason', e.target.value)}
            onBlur={() => form.touch('reason')}
          />

          {values.type === 'sick' ? (
            <AttachmentField
              name={values.attachmentName}
              required={!!preview?.attachmentRequired}
              error={errors.attachment}
              onPick={(n) => form.setField('attachmentName', n)}
              onBlur={() => form.touch('attachment')}
            />
          ) : null}

          <p className="t-small emp-muted">
            Akan disetujui oleh: <b className="emp-ink">{preview?.approverName ?? 'Kepala Toko'}</b>
          </p>
        </Screen>
      </form>
    </>
  );
};
