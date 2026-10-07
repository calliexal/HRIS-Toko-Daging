import { useState } from 'react';
import { addDays, attendanceStatusMeta, dayParts, formatClock, formatDateShort, formatRange, useApi, useResource, type ScheduleDay, type WeekSchedule } from '@dagingpeople/api';
import { Banner, Button, cx, EmptyState, IconButton, Skeleton, StatusChip } from '@dagingpeople/ui';
import { PageHeader, Screen } from '../components/Layout';

/** Minggu ini dimuat tanpa argumen (server menentukan). Navigasi menggeser ±7 hari dari situ. */
const useWeek = () => {
  const api = useApi();
  const [offset, setOffset] = useState(0);
  const current = useResource(() => api.employee.getWeekSchedule(), [api]);
  const base = current.data;
  const target = base ? addDays(base.weekStart, offset * 7) : undefined;
  const todayDate = base?.days.find((d) => d.isToday)?.date;
  /** Minggu depan baru terlihat setelah dipublikasi (SHF-01: paling lambat H-3). */
  const unpublished = offset > 0 && !!base && !!todayDate && todayDate < base.nextWeekPublishBy;
  const other = useResource<WeekSchedule | undefined>(
    () => (offset !== 0 && target && !unpublished ? api.employee.getWeekSchedule(target) : Promise.resolve(undefined)),
    [api, offset, target, unpublished],
  );
  const week = offset === 0 ? base : other.data;
  const loading = offset === 0 ? current.loading : other.loading;
  const error = offset === 0 ? current.error : other.error;
  return { offset, setOffset, week, loading, error, current: base, target, unpublished, reload: offset === 0 ? current.reload : other.reload };
};

const DayRow = ({ day }: { day: ScheduleDay }) => {
  const { weekday, day: dayNum } = dayParts(day.date);
  const meta = day.attendance ? attendanceStatusMeta(day.attendance.status, day.attendance.lateMinutes) : null;
  const off = day.cell === 'OFF';
  const leave = day.cell === 'LEAVE';
  return (
    <li className={cx('emp-day', day.isToday && 'is-today')} aria-current={day.isToday ? 'date' : undefined}>
      <span className="emp-day__date">
        <span className="t-caption">{weekday}</span>
        <span className="emp-day__num dp-num">{dayNum}</span>
      </span>
      <span className="emp-day__main">
        {off ? (
          <span className="emp-muted">Tidak ada shift</span>
        ) : leave ? (
          <span>Cuti</span>
        ) : (
          <>
            <span className="emp-day__shift">
              {day.shift?.name}
              {day.isToday ? ' · Hari ini' : ''}
            </span>
            <span className="t-small emp-muted dp-num">
              {day.shift ? `${formatClock(day.shift.start)}–${formatClock(day.shift.end)}` : ''} · {day.locationName}
            </span>
          </>
        )}
      </span>
      {off ? (
        <StatusChip tone="neutral">Libur</StatusChip>
      ) : leave ? (
        <StatusChip tone="info">Cuti</StatusChip>
      ) : meta ? (
        <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
      ) : null}
    </li>
  );
};

/** M5 (SHF-01): jadwal mingguan read-only. Tukar shift (SHF-02) belum ada di R1. */
export const ScheduleScreen = () => {
  const { offset, setOffset, week, loading, error, current, target, unpublished, reload } = useWeek();
  const rangeStart = week?.weekStart ?? target;
  const rangeLabel = rangeStart ? formatRange(rangeStart, addDays(rangeStart, 6)) : '';

  return (
    <Screen>
      <PageHeader title="Jadwal Saya">
        <div className="emp-weeknav">
          <IconButton icon="chevron-left" label="Minggu sebelumnya" variant="ghost" onClick={() => setOffset(offset - 1)} disabled={!current} />
          <span className="t-body-strong dp-num" aria-live="polite">
            {rangeLabel || <Skeleton width={120} height={18} />}
          </span>
          <IconButton icon="chevron-right" label="Minggu berikutnya" variant="ghost" onClick={() => setOffset(offset + 1)} disabled={!current || offset >= 1} />
        </div>
      </PageHeader>

      {unpublished && current ? (
        <EmptyState icon="calendar" title="Jadwal minggu ini belum terbit">
          Jadwal {formatRange(addDays(current.weekStart, 7), addDays(current.weekStart, 13))} terbit paling lambat {formatDateShort(current.nextWeekPublishBy)}. Anda akan
          mendapat notifikasi.
        </EmptyState>
      ) : error ? (
        <Banner tone="danger" title="Jadwal belum termuat" action={<Button variant="secondary" onClick={() => void reload()}>Muat Ulang</Button>}>
          Periksa sinyal lalu muat ulang.
        </Banner>
      ) : loading || !week ? (
        <div className="emp-stack-2" aria-busy="true">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} height={56} />
          ))}
        </div>
      ) : (
        <ul className="emp-week" aria-label={`Jadwal ${rangeLabel}`}>
          {week.days.map((d) => (
            <DayRow key={d.date} day={d} />
          ))}
        </ul>
      )}

      {current && offset === 0 ? (
        <Banner tone="neutral" icon="info">
          Jadwal {formatRange(addDays(current.weekStart, 7), addDays(current.weekStart, 13))} terbit paling lambat {formatDateShort(current.nextWeekPublishBy)}.
        </Banner>
      ) : null}
    </Screen>
  );
};
