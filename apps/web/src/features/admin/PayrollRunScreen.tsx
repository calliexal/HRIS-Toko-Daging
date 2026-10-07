'use client';

import { useId, useState } from 'react';
import { formatDateShort, formatRange, formatRupiah, type EmploymentType, type PayrollRow, type PayrollRun, type PayrollStep } from '@dagingpeople/api';
import { Banner, Button, Card, cx, EmptyState, Icon, Skeleton, StatTile, StatusChip, TextField } from '@dagingpeople/ui';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { useDelayedFlag } from '../shared/hooks';
import { PageHeader } from './PageHeader';
import { usePayrollRun, type PayrollFilter } from './usePayrollRun';

const EMPLOYMENT_LABEL: Record<EmploymentType, string> = { PKWTT: 'PKWTT', PKWT: 'PKWT', HARIAN: 'Harian lepas' };

const stepCaption = (step: PayrollStep, index: number) => {
  const n = index + 1;
  if (step.status === 'done') return `${n} · Selesai ${step.dateLabel}`;
  if (step.status === 'active') return `${n} · Sedang berjalan`;
  return `${n} · ${step.dateLabel}`;
};

const STEP_STATUS_SR: Record<PayrollStep['status'], string> = { done: 'selesai', active: 'langkah saat ini', todo: 'belum dimulai' };

const Stepper = ({ steps }: { steps: PayrollStep[] }) => (
  <ol className="adm-stepper" aria-label="Tahapan payroll">
    {steps.map((step, i) => (
      <li key={step.key} className={cx('adm-step', `adm-step--${step.status}`)} aria-current={step.status === 'active' ? 'step' : undefined}>
        <span className="adm-step__caption">
          {step.status === 'done' ? <Icon name="check-circle" size={14} /> : step.status === 'active' ? <Icon name="clock" size={14} /> : null}
          <span className="dp-num">{stepCaption(step, i)}</span>
        </span>
        <span className="adm-step__label">{step.label}</span>
        <span className="dp-visually-hidden">, {STEP_STATUS_SR[step.status]}</span>
      </li>
    ))}
  </ol>
);

const Tiles = ({ run }: { run: PayrollRun }) => (
  <div className="adm-tiles adm-tiles--wide">
    <StatTile label="Karyawan siap" value={`${run.employeesReady} / ${run.employeesTotal}`} tone="success" />
    <StatTile label="Perlu review" value={run.counts.needsReview} tone={run.counts.needsReview > 0 ? 'warning' : 'neutral'} />
    <StatTile label="Total bruto" value={formatRupiah(run.totals.gross)} className="adm-tile--amount" />
    <StatTile label="Total ditransfer" value={formatRupiah(run.totals.takeHome)} className="adm-tile--amount" />
  </div>
);

const PayrollTableRow = ({ row, onIssueAction }: { row: PayrollRow; onIssueAction: (row: PayrollRow) => void }) => (
  <tr>
    <th scope="row" className="adm-cell-name">
      {row.employee.name}
    </th>
    <td>
      {EMPLOYMENT_LABEL[row.employee.employmentType]} · {row.locationName}
    </td>
    <td className="is-num">{row.daysPresent}</td>
    <td className="is-num">{row.overtimeHours > 0 ? `${row.overtimeHours} jam` : '—'}</td>
    <td className="is-num">{formatRupiah(row.gross)}</td>
    <td className="is-num">{formatRupiah(row.takeHome)}</td>
    <td>
      {row.issue ? (
        <span className="adm-issue">
          <StatusChip tone="warning" icon="alert-triangle">
            {row.issue.label}
          </StatusChip>
          <Button variant="ghost" size="dense" onClick={() => onIssueAction(row)}>
            {row.issue.actionLabel}
          </Button>
        </span>
      ) : (
        <StatusChip tone="success">Siap</StatusChip>
      )}
    </td>
  </tr>
);

export const PayrollRunScreen = () => {
  const vm = usePayrollRun();
  const run = vm.run.data;
  const [dialog, setDialog] = useState<'submit' | 'lock' | null>(null);
  const [typed, setTyped] = useState('');
  const lockReasonId = useId();
  const slow = useDelayedFlag(vm.run.loading && !run);

  const lockPhrase = run ? `Kunci periode ${run.periodLabel}` : '';
  const phraseMatches = typed.trim().toLowerCase() === lockPhrase.toLowerCase();

  const filters: { value: PayrollFilter; label: string; count: number | undefined }[] = [
    { value: 'all', label: 'Semua', count: run?.counts.all },
    { value: 'needs_review', label: 'Perlu review', count: run?.counts.needsReview },
    { value: 'casual', label: 'Harian lepas', count: run?.counts.casual },
    { value: 'overtime', label: 'Ada lembur', count: run?.counts.withOvertime },
  ];

  const confirmSubmit = async () => {
    await vm.submitForApproval();
    setDialog(null);
  };

  const confirmLock = async () => {
    if (!phraseMatches) return;
    await vm.lockPeriod();
    setDialog(null);
    setTyped('');
  };

  const openLock = () => {
    setTyped('');
    setDialog('lock');
  };

  return (
    <div className="adm-page">
      <PageHeader
        title={run ? `Payroll ${run.periodLabel}` : 'Payroll'}
        meta={
          run ? (
            <span className="dp-num">
              Periode {formatRange(run.periodStart, run.periodEnd)} · dibayar {formatDateShort(run.payDate)}
            </span>
          ) : (
            <Skeleton width={300} height={18} />
          )
        }
        actions={
          <>
            <Button variant="secondary" icon="refresh" onClick={() => void vm.recalculate()} loading={vm.busy === 'recalculate'} disabled={!run || vm.busy !== null || vm.submitted}>
              Hitung Ulang
            </Button>
            <Button variant="primary" icon="send" onClick={() => setDialog('submit')} disabled={!run || vm.busy !== null || vm.submitted}>
              {vm.submitted ? 'Menunggu Persetujuan Owner' : 'Kirim untuk Persetujuan'}
            </Button>
          </>
        }
      />

      <div aria-live="polite" className="adm-live">
        {vm.notice ? (
          <Banner tone={vm.notice.tone} role={vm.notice.tone === 'danger' ? 'alert' : 'status'}>
            {vm.notice.text}
          </Banner>
        ) : null}
      </div>

      {vm.run.error ? (
        <Banner tone="danger" role="alert" title="Data payroll belum termuat" action={<Button variant="secondary" size="dense" onClick={() => void vm.run.reload()}>Muat Ulang</Button>}>
          Periksa koneksi internet, lalu muat ulang.
        </Banner>
      ) : null}

      {run ? (
        <>
          <Stepper steps={run.steps} />
          <Tiles run={run} />

          <Card flush className="adm-payroll-card">
            <div className="adm-filter-chips adm-filter-chips--bar" role="group" aria-label="Filter karyawan">
              {filters.map((f) => (
                <button key={f.value} type="button" className={cx('adm-filter-chip', vm.filter === f.value && 'is-active')} aria-pressed={vm.filter === f.value} onClick={() => vm.setFilter(f.value)}>
                  {f.label} {f.count !== undefined ? <span className="dp-num">{f.count}</span> : null}
                </button>
              ))}
            </div>
            {vm.rows.length === 0 ? (
              <EmptyState icon="check-circle" title="Tidak ada karyawan di filter ini">
                Pilih filter lain untuk melihat karyawan.
              </EmptyState>
            ) : (
              <div className="dp-table-wrap" tabIndex={0} role="region" aria-label="Tabel payroll per karyawan">
                <table className="dp-table adm-table adm-table--payroll">
                  <caption className="dp-visually-hidden">Rincian payroll {run.periodLabel}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Nama</th>
                      <th scope="col">Status kerja</th>
                      <th scope="col" className="is-num">
                        Hari hadir
                      </th>
                      <th scope="col" className="is-num">
                        Lembur
                      </th>
                      <th scope="col" className="is-num">
                        Bruto
                      </th>
                      <th scope="col" className="is-num">
                        Diterima
                      </th>
                      <th scope="col">Masalah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.rows.map((row) => (
                      <PayrollTableRow
                        key={row.employee.id}
                        row={row}
                        onIssueAction={(r) =>
                          vm.setNotice({ tone: 'info', text: `Data karyawan ${r.employee.name} dibuka di modul Karyawan (menyusul di rilis berikutnya).` })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="adm-payroll-footer">
              <p className="t-small adm-muted">
                Menampilkan <span className="dp-num">{vm.rows.length}</span> baris contoh. Karyawan bermasalah tidak menahan{' '}
                <span className="dp-num">{run.employeesReady}</span> karyawan lain. File Mandiri MCM bisa diekspor setelah periode dikunci.
              </p>
              <div className="adm-payroll-footer__actions">
                <div className="adm-lock">
                  <Button variant="secondary" icon="lock" onClick={openLock} disabled={vm.lockBlockedReason !== null || vm.busy !== null} aria-describedby={vm.lockBlockedReason ? lockReasonId : undefined}>
                    Kunci Periode
                  </Button>
                  {vm.lockBlockedReason ? (
                    <p id={lockReasonId} className="t-small adm-muted">
                      {vm.lockBlockedReason}
                    </p>
                  ) : null}
                </div>
                <Button variant="secondary" icon="download" disabled aria-describedby={`${lockReasonId}-mcm`}>
                  Ekspor Mandiri MCM
                </Button>
                <p id={`${lockReasonId}-mcm`} className="dp-visually-hidden">
                  Ekspor aktif setelah periode dikunci.
                </p>
              </div>
            </div>
          </Card>
        </>
      ) : slow ? (
        <Card>
          <div className="adm-stack">
            <Skeleton height={64} />
            <Skeleton height={96} />
            <Skeleton height={200} />
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        open={dialog === 'submit'}
        title={`Kirim payroll ${run?.periodLabel ?? ''} ke Owner?`}
        confirmLabel="Kirim untuk Persetujuan"
        loading={vm.busy === 'submit'}
        onConfirm={() => void confirmSubmit()}
        onCancel={() => setDialog(null)}
      >
        {run ? (
          <>
            <p>
              <span className="dp-num">{run.employeesReady}</span> karyawan siap dengan total ditransfer <b className="dp-num">{formatRupiah(run.totals.takeHome)}</b>.
            </p>
            {run.counts.needsReview > 0 ? (
              <p>
                <span className="dp-num">{run.counts.needsReview}</span> karyawan yang perlu review tetap bisa diselesaikan sebelum periode dikunci.
              </p>
            ) : null}
            <p>Setelah dikirim, angka tidak bisa dihitung ulang kecuali Owner mengembalikannya.</p>
          </>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'lock'}
        title={`Kunci periode ${run?.periodLabel ?? ''}?`}
        confirmLabel="Kunci Periode"
        confirmDisabled={!phraseMatches}
        loading={vm.busy === 'lock'}
        initialFocusSelector="input"
        onConfirm={() => void confirmLock()}
        onCancel={() => setDialog(null)}
      >
        <p>Setelah dikunci, absensi dan gaji periode ini tidak bisa diubah lagi. Koreksi masuk ke periode berikutnya.</p>
        <TextField label={`Ketik "${lockPhrase}" untuk melanjutkan`} value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
};
