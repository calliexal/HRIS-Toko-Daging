'use client';

import { useState } from 'react';
import {
  attendanceStatusMeta,
  clockMethodLabel,
  formatClock,
  formatDateShort,
  type Anomaly,
  type AttendanceRecord,
  type AttendanceSummary,
} from '@dagingpeople/api';
import { Banner, Button, ButtonLink, Card, EmptyState, SelectField, Skeleton, StatTile, StatusChip, TextField, type Tone } from '@dagingpeople/ui';
import { useWebPaths } from '../paths';
import { firstName, useDelayedFlag, useTransientMessage } from '../shared/hooks';
import { PageHeader } from './PageHeader';
import { useAttendanceToday, type AttendanceFilter } from './useAttendanceToday';

type TileDef = { filter: AttendanceFilter; label: string; tone: Tone; value: (s: AttendanceSummary) => number };

const TILES: readonly TileDef[] = [
  { filter: 'scheduled', label: 'Terjadwal', tone: 'neutral', value: (s) => s.scheduled },
  { filter: 'on_time', label: 'Hadir tepat waktu', tone: 'success', value: (s) => s.onTime },
  { filter: 'late', label: 'Terlambat', tone: 'warning', value: (s) => s.late },
  { filter: 'not_yet', label: 'Belum absen', tone: 'danger', value: (s) => s.notYet },
  { filter: 'leave', label: 'Cuti / izin', tone: 'info', value: (s) => s.onLeave },
];

const FILTER_LABEL: Record<AttendanceFilter, string> = {
  all: 'Semua',
  scheduled: 'Terjadwal',
  on_time: 'Hadir tepat waktu',
  late: 'Terlambat',
  not_yet: 'Belum absen',
  leave: 'Cuti / izin',
};

const anomalyCopy = (a: Anomaly): { title: string; action: string } => {
  const name = firstName(a.employee.name);
  switch (a.kind) {
    case 'missing_clock_out':
      return { title: `${name} lupa absen pulang`, action: 'Ajukan Koreksi' };
    case 'outside_geofence':
      return { title: `${name} absen di luar radius`, action: 'Tinjau Absen' };
    case 'offline_delayed':
      return { title: `${name} · absen offline lebih dari 12 jam`, action: 'Tinjau Absen' };
  }
};

const SummaryTiles = ({ summary, filter, onToggle }: { summary: AttendanceSummary | undefined; filter: AttendanceFilter; onToggle: (f: AttendanceFilter) => void }) => (
  <div className="adm-tiles" role="group" aria-label="Ringkasan kehadiran, klik untuk memfilter tabel">
    {TILES.map((tile) =>
      summary ? (
        <StatTile
          key={tile.filter}
          label={tile.label}
          value={tile.value(summary)}
          tone={tile.tone}
          pressed={filter === tile.filter}
          onClick={() => onToggle(tile.filter)}
        />
      ) : (
        <div key={tile.filter} className="dp-stat" aria-hidden="true">
          <span className="dp-stat__label">{tile.label}</span>
          <span className="dp-stat__value">–</span>
        </div>
      ),
    )}
  </div>
);

const RecordRow = ({ record }: { record: AttendanceRecord }) => {
  const meta = attendanceStatusMeta(record.status, record.lateMinutes, record.leaveLabel);
  return (
    <tr>
      <th scope="row" className="adm-cell-name">
        {record.employee.name}
      </th>
      <td>{record.employee.position}</td>
      <td className="dp-num">{record.shift ? `${formatClock(record.shift.start)}–${formatClock(record.shift.end)}` : '—'}</td>
      <td className="dp-num">{record.clockIn ? formatClock(record.clockIn) : '—'}</td>
      <td>{record.method ? clockMethodLabel[record.method] : '—'}</td>
      <td>
        <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
      </td>
    </tr>
  );
};

const AnomalyPanel = ({ anomalies, loading }: { anomalies: Anomaly[] | undefined; loading: boolean }) => {
  const paths = useWebPaths();
  const list = anomalies ?? [];
  return (
    <Card title={`Perlu tindakan${anomalies ? ` (${list.length})` : ''}`} flush className="adm-anomalies">
      {loading && !anomalies ? (
        <div className="adm-pad">
          <Skeleton height={64} />
        </div>
      ) : list.length === 0 ? (
        <EmptyState title="Tidak ada anomali">Semua absen di lokasi ini tercatat normal.</EmptyState>
      ) : (
        <ul className="adm-anomaly-list">
          {list.map((a) => {
            const copy = anomalyCopy(a);
            return (
              <li key={a.id} className="adm-anomaly">
                <p className="t-body-strong">{copy.title}</p>
                <p className="t-small adm-muted">
                  <span className="dp-num">{formatDateShort(a.date)}</span> · {a.detail}
                </p>
                <ButtonLink href={paths.approvals} variant="secondary" size="dense" className="adm-anomaly__action">
                  {copy.action}
                </ButtonLink>
              </li>
            );
          })}
        </ul>
      )}
      <p className="adm-card-note">Koreksi absen butuh persetujuan HR.</p>
    </Card>
  );
};

export const AttendanceTodayScreen = () => {
  const vm = useAttendanceToday();
  const { summary, records } = vm;
  const [exportNotice, setExportNotice] = useTransientMessage<{ tone: Tone; text: string }>();
  const [exporting, setExporting] = useState(false);
  const slow = useDelayedFlag(records.loading && !records.data);

  const hasData = (records.data?.length ?? 0) > 0;
  const locationEmpty = !records.loading && records.data !== undefined && !hasData;

  const handleExport = () => {
    setExporting(true);
    try {
      const fileName = vm.exportCsv();
      setExportNotice(fileName ? { tone: 'success', text: `Rekap diunduh: ${fileName}` } : { tone: 'warning', text: 'Belum ada data untuk diekspor di lokasi ini.' });
    } catch {
      setExportNotice({ tone: 'danger', text: 'Rekap belum bisa dibuat. Coba lagi sebentar lagi.' });
    } finally {
      setExporting(false);
    }
  };

  const locationOptions = (vm.locations.data ?? []).map((l) => ({ value: l.id, label: l.name }));

  if (vm.noLocations) {
    return (
      <div className="adm-page">
        <PageHeader title="Kehadiran hari ini" />
        <Card>
          <EmptyState icon="calendar" title="Belum ada lokasi kerja">
            Kehadiran tampil setelah outlet, gudang, atau kantor didaftarkan. Minta admin sistem menambahkan lokasi beserta jadwal shift-nya.
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="adm-page">
      <PageHeader
        title="Kehadiran hari ini"
        meta={
          summary.data ? (
            <span className="dp-num">
              {formatDateShort(summary.data.date)} · diperbarui {formatClock(summary.data.updatedAt)} WIB
            </span>
          ) : (
            <Skeleton width={240} height={18} />
          )
        }
        actions={
          <>
            <SelectField
              label="Lokasi"
              hideLabel
              className="adm-location-select"
              value={vm.locationId ?? ''}
              onChange={(e) => vm.changeLocation(e.target.value)}
              options={locationOptions}
            />
            <Button variant="secondary" icon="download" onClick={handleExport} loading={exporting} disabled={!hasData}>
              Ekspor Rekap
            </Button>
          </>
        }
      />

      <div aria-live="polite" className="adm-live">
        {exportNotice ? <Banner tone={exportNotice.tone}>{exportNotice.text}</Banner> : null}
      </div>

      {records.error ? (
        <Banner tone="danger" role="alert" title="Data kehadiran belum termuat" action={<Button variant="secondary" size="dense" onClick={() => void records.reload()}>Muat Ulang</Button>}>
          Periksa koneksi internet, lalu muat ulang.
        </Banner>
      ) : null}

      {locationEmpty ? (
        <Card>
          <EmptyState icon="users" title={`Belum ada data kehadiran untuk ${vm.locationName || 'lokasi ini'}`}>
            Belum ada karyawan yang dijadwalkan atau absen hari ini di lokasi ini. Pilih lokasi lain di atas.
          </EmptyState>
        </Card>
      ) : (
        <>
          <SummaryTiles summary={summary.data} filter={vm.filter} onToggle={vm.toggleFilter} />

          <div className="adm-split">
            <Card
              className="adm-split__main"
              flush
              title="Daftar karyawan"
              actions={
                <TextField
                  label="Cari karyawan"
                  hideLabel
                  type="search"
                  placeholder="Cari nama"
                  className="adm-search"
                  value={vm.query}
                  onChange={(e) => vm.setQuery(e.target.value)}
                />
              }
              footer={
                <span aria-live="polite">
                  Menampilkan <span className="dp-num">{vm.visibleRecords.length}</span> dari <span className="dp-num">{records.data?.length ?? 0}</span>
                  {vm.filter !== 'all' ? (
                    <>
                      {' '}
                      · filter: {FILTER_LABEL[vm.filter]} ·{' '}
                      <button type="button" className="adm-link-button" onClick={() => vm.toggleFilter(vm.filter)}>
                        Tampilkan semua
                      </button>
                    </>
                  ) : null}
                </span>
              }
            >
              {slow ? (
                <div className="adm-pad adm-stack">
                  <Skeleton height={20} />
                  <Skeleton height={20} />
                  <Skeleton height={20} />
                </div>
              ) : vm.visibleRecords.length === 0 && records.data ? (
                <EmptyState icon="search" title="Tidak ada karyawan yang cocok">
                  Ubah kata pencarian atau klik kartu ringkasan yang aktif untuk menghapus filter.
                </EmptyState>
              ) : (
                <div className="dp-table-wrap" tabIndex={0} role="region" aria-label="Tabel kehadiran karyawan">
                  <table className="dp-table adm-table">
                    <caption className="dp-visually-hidden">Kehadiran karyawan hari ini, {FILTER_LABEL[vm.filter]}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Nama</th>
                        <th scope="col">Jabatan</th>
                        <th scope="col">Shift</th>
                        <th scope="col">Masuk</th>
                        <th scope="col">Metode</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vm.visibleRecords.map((r) => (
                        <RecordRow key={r.employee.id} record={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <AnomalyPanel anomalies={vm.anomalies.data} loading={vm.anomalies.loading} />
          </div>
        </>
      )}
    </div>
  );
};
