'use client';

import { useMemo, useState } from 'react';
import { dayParts, formatClock, formatDateShort, formatRange, type AdminWeekSchedule, type CoverageCount, type ScheduleRow } from '@dagingpeople/api';
import { Banner, Button, Card, EmptyState, Icon, SelectField, Skeleton, StatusChip } from '@dagingpeople/ui';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { useDelayedFlag } from '../shared/hooks';
import { PageHeader } from './PageHeader';
import { ShiftCellMenu, shiftOptions, type ShiftOption } from './ShiftCellMenu';
import { useWeeklySchedule } from './useWeeklySchedule';

const dayLabel = (iso: string) => {
  const { weekday, day } = dayParts(iso);
  return `${weekday} ${day}`;
};

const ScheduleTableRow = ({
  row,
  days,
  options,
  pendingCell,
  onChange,
}: {
  row: ScheduleRow;
  days: string[];
  options: ShiftOption[];
  pendingCell: string | null;
  onChange: (employeeId: string, dayIndex: number, value: ShiftOption['value']) => void;
}) => (
  <tr>
    <th scope="row" className="adm-sched__person">
      <span className="adm-sched__name">{row.employee.name}</span>
      <span className="adm-sched__role">{row.employee.position}</span>
    </th>
    {row.cells.map((cell, i) => {
      const date = days[i] ?? '';
      const context = `${row.employee.name}, ${formatDateShort(date)}`;
      return (
        <td key={date} className="adm-sched__cell">
          {cell === 'LEAVE' ? (
            <div className="adm-cell adm-cell--leave" role="img" aria-label={`${context}: Cuti disetujui, tidak bisa diubah di sini`} title="Cuti dari pengajuan yang disetujui">
              <Icon name="lock" size={14} />
              <span className="adm-cell__label">Cuti</span>
            </div>
          ) : (
            <ShiftCellMenu
              value={cell}
              options={options}
              context={context}
              pending={pendingCell === `${row.employee.id}:${i}`}
              onChange={(next) => onChange(row.employee.id, i, next)}
            />
          )}
        </td>
      );
    })}
    <td className="is-num dp-num adm-sched__hours">{row.hoursPerWeek} jam</td>
  </tr>
);

const CoverageRow = ({ coverage, name, first }: { coverage: CoverageCount; name: string; first: boolean }) => (
  <tr className={first ? 'adm-sched__coverage adm-sched__coverage--first' : 'adm-sched__coverage'}>
    <th scope="row">
      {name} · butuh <span className="dp-num">{coverage.required}</span>
    </th>
    {coverage.filled.map((filled, i) => {
      const short = coverage.required - filled;
      return (
        <td key={i} className="adm-sched__count">
          {short > 0 ? (
            <StatusChip tone="warning" icon="alert-triangle">
              <span className="dp-num">{filled}</span> · kurang <span className="dp-num">{short}</span>
            </StatusChip>
          ) : (
            <span className="dp-num">{filled}</span>
          )}
        </td>
      );
    })}
    <td />
  </tr>
);

const ScheduleGrid = ({ data, pendingCell, onChange }: { data: AdminWeekSchedule; pendingCell: string | null; onChange: (employeeId: string, dayIndex: number, value: ShiftOption['value']) => void }) => {
  const options = useMemo(() => shiftOptions(data.templates), [data.templates]);
  const templateName = (code: string) => data.templates.find((t) => t.code === code)?.name ?? code;
  return (
    <Card flush className="adm-sched-card">
      <div className="dp-table-wrap" tabIndex={0} role="region" aria-label="Tabel jadwal shift, gulir ke samping bila perlu">
        <table className="dp-table adm-sched">
          <caption className="dp-visually-hidden">
            Jadwal shift {data.location.name}, {formatRange(data.days[0] ?? data.weekStart, data.days[data.days.length - 1] ?? data.weekStart)}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="adm-sched__person-col">
                Karyawan
              </th>
              {data.days.map((d) => (
                <th key={d} scope="col" className="adm-sched__day">
                  {dayLabel(d)}
                </th>
              ))}
              <th scope="col" className="is-num">
                Jam/minggu
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <ScheduleTableRow key={row.employee.id} row={row} days={data.days} options={options} pendingCell={pendingCell} onChange={onChange} />
            ))}
            {data.coverage.map((c, i) => (
              <CoverageRow key={c.shift} coverage={c} name={templateName(c.shift)} first={i === 0} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export const WeeklyScheduleScreen = () => {
  const { locations, locationId, changeLocation, noLocations, schedule, updateCell, pendingCell, publish, publishing, notice } = useWeeklySchedule();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const slow = useDelayedFlag(schedule.loading && !schedule.data);
  const data = schedule.data;
  const published = data?.status === 'published';
  const warnings = data?.warnings ?? [];

  const handlePublish = () => {
    if (warnings.length > 0) setConfirmOpen(true);
    else void publish();
  };

  const confirmPublish = async () => {
    await publish();
    setConfirmOpen(false);
  };

  const range = data ? formatRange(data.days[0] ?? data.weekStart, data.days[data.days.length - 1] ?? data.weekStart) : '';
  const locationOptions = (locations.data ?? []).map((l) => ({ value: l.id, label: l.name }));

  if (noLocations) {
    return (
      <div className="adm-page">
        <PageHeader title="Jadwal Shift" />
        <Card>
          <EmptyState icon="calendar" title="Belum ada lokasi kerja">
            Jadwal shift bisa disusun setelah outlet, gudang, atau kantor didaftarkan beserta template shift-nya.
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="adm-page">
      <PageHeader
        title={`Jadwal Shift${data ? ` · ${data.location.name}` : ''}`}
        meta={
          data ? (
            <span className="adm-inline">
              {published ? <StatusChip tone="success">Terbit</StatusChip> : <StatusChip tone="warning" icon="file-text">Draf</StatusChip>}
              <span className="dp-num">
                {published ? 'Karyawan sudah bisa melihat jadwal ini' : `Terbit paling lambat ${formatDateShort(data.publishBy)} (H-3)`}
              </span>
            </span>
          ) : (
            <Skeleton width={280} height={18} />
          )
        }
        actions={
          <>
            {locationOptions.length > 1 ? (
              <SelectField
                label="Lokasi"
                hideLabel
                className="adm-location-select"
                value={locationId ?? ''}
                onChange={(e) => changeLocation(e.target.value)}
                options={locationOptions}
              />
            ) : null}
            <span className="adm-week-label dp-num">
              <Icon name="calendar" size={18} />
              {range || '—'}
            </span>
            <Button variant="primary" icon="send" onClick={handlePublish} loading={publishing && !confirmOpen} disabled={!data || published}>
              {published ? 'Jadwal Sudah Terbit' : 'Publikasikan Jadwal'}
            </Button>
          </>
        }
      />

      <div aria-live="polite" className="adm-live">
        {notice ? (
          <Banner tone={notice.tone} role={notice.tone === 'danger' ? 'alert' : 'status'}>
            {notice.text}
          </Banner>
        ) : null}
      </div>

      {schedule.error ? (
        <Banner tone="danger" role="alert" title="Jadwal belum termuat" action={<Button variant="secondary" size="dense" onClick={() => void schedule.reload()}>Muat Ulang</Button>}>
          Periksa koneksi internet, lalu muat ulang.
        </Banner>
      ) : null}

      {warnings.length > 0 ? (
        <Banner tone="warning" title={`${warnings.length} peringatan sebelum publikasi`}>
          <ul className="adm-warning-list">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      {data ? (
        <ScheduleGrid data={data} pendingCell={pendingCell} onChange={(id, i, v) => void updateCell(id, i, v)} />
      ) : slow ? (
        <Card>
          <div className="adm-stack">
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        </Card>
      ) : null}

      {data ? (
        <ul className="adm-legend">
          {data.templates.map((t) => (
            <li key={t.code}>
              <b>{t.name}</b> <span className="dp-num">{`${formatClock(t.start)}–${formatClock(t.end)}`}</span>
            </li>
          ))}
          <li>Klik sel untuk mengganti shift</li>
          <li>
            <Icon name="lock" size={14} /> Cuti diisi otomatis dari pengajuan yang disetujui
          </li>
        </ul>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={`Publikasikan dengan ${warnings.length} peringatan?`}
        confirmLabel="Tetap Publikasikan"
        cancelLabel="Perbaiki Dulu"
        loading={publishing}
        onConfirm={() => void confirmPublish()}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>Jadwal akan langsung terlihat oleh karyawan. Peringatan yang masih ada:</p>
        <ul className="adm-warning-list">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
};
