import type { AdminWeekSchedule, ScheduleCell, ScheduleDay, ShiftCode, WeekSchedule } from '@dagingpeople/contracts';
import { requireEmployee, requireLocation, requireRole, type Actor } from '../../common/actor';
import { writeAudit } from '../../common/audit';
import type { Clock } from '../../common/clock';
import { one, type Db } from '../../common/db';
import { conflict, notFound, validation } from '../../common/errors';
import { addDays, localDate, mondayOf } from '../../common/time';
import { toEmployee } from '../attendance/attendance.service';
import { dailyStatus } from '../attendance/attendance.domain';
import { coverage, hoursPerWeek, scheduleWarnings, type GridRow, type Template } from './scheduling.domain';

type EmployeeRow = { id: string; code: string; full_name: string; position: string; location_id: string; employment_type: 'PKWTT' | 'PKWT' | 'HARIAN' };
type TemplateRow = { code: ShiftCode; name: string; start_time: string; end_time: string; min_staff: number };

const EDITABLE: readonly ScheduleCell[] = ['P', 'S', 'SB', 'OFF'];
const PUBLISH_LEAD_DAYS = 3;

export class SchedulingService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  private templates(locationId: string) {
    return this.db.query<TemplateRow>(
      `SELECT code, name, to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time, min_staff
         FROM shift_template WHERE location_id = $1 ORDER BY start_time`,
      [locationId],
    );
  }

  private assertWeek(weekStart: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || mondayOf(weekStart) !== weekStart) throw validation('WEEK_START_NOT_MONDAY', 'Minggu jadwal harus dimulai hari Senin.');
  }

  async getWeek(actor: Actor, locationId: string, weekStart?: string): Promise<AdminWeekSchedule> {
    requireLocation(actor, locationId);
    const start = weekStart ?? addDays(mondayOf(localDate(this.clock.now())), 7);
    this.assertWeek(start);
    const location = await one(this.db.query<{ id: string; name: string; type: 'outlet' | 'gudang' | 'kantor'; radius_m: number }>('SELECT id, name, type, radius_m FROM location WHERE id = $1', [locationId]));
    if (!location) throw notFound('LOCATION_NOT_FOUND', 'Lokasi tidak ditemukan.');

    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const [employees, entries, week, templates] = await Promise.all([
      this.db.query<EmployeeRow>(
        `SELECT id, code, full_name, position, location_id, employment_type FROM employee
          WHERE location_id = $1 AND end_date IS NULL ORDER BY full_name`,
        [locationId],
      ),
      this.db.query<{ employee_id: string; work_date: string; cell: ScheduleCell }>(
        `SELECT employee_id, work_date, cell FROM schedule_entry WHERE location_id = $1 AND work_date BETWEEN $2::date AND $3::date`,
        [locationId, start, days[6]],
      ),
      one(this.db.query<{ status: 'draft' | 'published' }>('SELECT status FROM schedule_week WHERE location_id = $1 AND week_start = $2::date', [locationId, start])),
      this.templates(locationId),
    ]);

    const cellOf = new Map(entries.map((e) => [`${e.employee_id}|${e.work_date}`, e.cell]));
    const rows = employees.map((e) => {
      const cells = days.map((d) => cellOf.get(`${e.id}|${d}`) ?? 'OFF');
      return { employee: toEmployee(e), cells, hoursPerWeek: hoursPerWeek(cells) };
    });
    const tpl: Template[] = templates.map((t) => ({ code: t.code, name: t.name, minStaff: t.min_staff }));
    const grid: GridRow[] = rows.map((r) => ({ employeeId: r.employee.id, name: r.employee.name, cells: r.cells }));

    return {
      location: { id: location.id, name: location.name, type: location.type, radiusM: location.radius_m },
      weekStart: start,
      days,
      status: week?.status ?? 'draft',
      publishBy: addDays(start, -PUBLISH_LEAD_DAYS),
      rows,
      coverage: coverage(grid, tpl),
      warnings: scheduleWarnings(grid, tpl, days),
      templates: templates.map((t) => ({ code: t.code, name: t.name, start: t.start_time, end: t.end_time })),
    };
  }

  /** SHF-01: ubah satu sel. Sel Cuti dikunci (diisi otomatis dari cuti yang disetujui). Mengubah jadwal terbit = kembali draf. */
  async updateCell(actor: Actor, locationId: string, weekStart: string, employeeId: string, dayIndex: number, cell: ScheduleCell): Promise<AdminWeekSchedule> {
    requireRole(actor, 'store_manager', 'hr');
    requireLocation(actor, locationId);
    this.assertWeek(weekStart);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) throw validation('INVALID_DAY', 'Hari harus antara Senin dan Minggu.');
    if (!EDITABLE.includes(cell)) throw validation('INVALID_CELL', 'Pilih Pagi, Siang, Subuh, atau Libur. Cuti diisi otomatis dari pengajuan yang disetujui.');
    const date = addDays(weekStart, dayIndex);

    await this.db.transaction(async (tx) => {
      const emp = await one(tx.query<{ location_id: string }>('SELECT location_id FROM employee WHERE id = $1 AND end_date IS NULL', [employeeId]));
      if (!emp || emp.location_id !== locationId) throw notFound('EMPLOYEE_NOT_FOUND', 'Karyawan tidak ada di jadwal lokasi ini.');
      const current = await one(tx.query<{ cell: ScheduleCell }>('SELECT cell FROM schedule_entry WHERE employee_id = $1 AND work_date = $2::date', [employeeId, date]));
      if (current?.cell === 'LEAVE') throw conflict('CELL_ON_LEAVE', 'Hari ini cuti yang sudah disetujui. Ubah lewat pembatalan cuti.');
      if (cell !== 'OFF') {
        const tpl = await one(tx.query<{ code: string }>('SELECT code FROM shift_template WHERE location_id = $1 AND code = $2', [locationId, cell]));
        if (!tpl) throw validation('SHIFT_NOT_AVAILABLE', 'Shift ini tidak tersedia di lokasi ini.');
      }
      await tx.execute(
        `INSERT INTO schedule_entry (employee_id, work_date, location_id, cell, updated_by) VALUES ($1, $2::date, $3, $4, $5)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET cell = EXCLUDED.cell, location_id = EXCLUDED.location_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [employeeId, date, locationId, cell, actor.userId],
      );
      await tx.execute(
        `INSERT INTO schedule_week (location_id, week_start, status) VALUES ($1, $2::date, 'draft')
         ON CONFLICT (location_id, week_start) DO UPDATE SET status = 'draft', published_at = NULL, published_by = NULL`,
        [locationId, weekStart],
      );
    });
    return this.getWeek(actor, locationId, weekStart);
  }

  /** Publikasi wajib mengonfirmasi peringatan yang ada (dialog di UI). */
  async publish(actor: Actor, locationId: string, weekStart: string, acknowledgedWarnings: number): Promise<AdminWeekSchedule> {
    requireRole(actor, 'store_manager', 'hr');
    const week = await this.getWeek(actor, locationId, weekStart);
    if (week.warnings.length > acknowledgedWarnings) {
      throw conflict('UNACKNOWLEDGED_WARNINGS', `Ada ${week.warnings.length} peringatan yang belum dikonfirmasi.`, { warnings: week.warnings });
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO schedule_week (location_id, week_start, status, published_at, published_by) VALUES ($1, $2::date, 'published', now(), $3)
         ON CONFLICT (location_id, week_start) DO UPDATE SET status = 'published', published_at = now(), published_by = EXCLUDED.published_by`,
        [locationId, weekStart, actor.userId],
      );
      await writeAudit(tx, { actorId: actor.userId, action: 'schedule.publish', entity: 'schedule_week', entityId: `${locationId}:${weekStart}`, diff: { warnings: week.warnings.length } });
    });
    return { ...week, status: 'published' };
  }

  /** Jadwal karyawan sendiri. Minggu yang belum terbit tidak ditampilkan isinya. */
  async myWeek(actor: Actor, weekStart?: string): Promise<WeekSchedule> {
    const employeeId = requireEmployee(actor);
    const today = localDate(this.clock.now());
    const start = weekStart ?? mondayOf(today);
    this.assertWeek(start);
    const emp = await one(this.db.query<{ location_id: string; location_name: string }>(
      'SELECT e.location_id, l.name AS location_name FROM employee e JOIN location l ON l.id = e.location_id WHERE e.id = $1',
      [employeeId],
    ));
    if (!emp) throw notFound('EMPLOYEE_NOT_FOUND', 'Data karyawan tidak ditemukan.');
    const [published, templates, rows] = await Promise.all([
      one(this.db.query<{ status: string }>('SELECT status FROM schedule_week WHERE location_id = $1 AND week_start = $2::date', [emp.location_id, start])),
      this.templates(emp.location_id),
      this.db.query<{ work_date: string; cell: ScheduleCell; clock_in: string | null }>(
        `SELECT se.work_date, se.cell, to_char(d.clock_in AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS clock_in
           FROM schedule_entry se LEFT JOIN attendance_day_v d ON d.employee_id = se.employee_id AND d.work_date = se.work_date
          WHERE se.employee_id = $1 AND se.work_date BETWEEN $2::date AND $2::date + 6`,
        [employeeId, start],
      ),
    ]);
    const isPublished = published?.status === 'published' || start <= mondayOf(today);
    const byDate = new Map(rows.map((r) => [r.work_date, r]));
    const tpl = new Map(templates.map((t) => [t.code, t]));
    const days: ScheduleDay[] = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(start, i);
      const row = isPublished ? byDate.get(date) : undefined;
      const cell: ScheduleCell = row?.cell ?? 'OFF';
      const t = tpl.get(cell as ShiftCode);
      const day: ScheduleDay = { date, cell, shift: t ? { code: t.code, name: t.name, start: t.start_time, end: t.end_time } : null, locationName: emp.location_name, isToday: date === today };
      if (date < today && t) {
        const s = dailyStatus({ cell, shiftStart: t.start_time, shiftEnd: t.end_time, clockIn: row?.clock_in ?? null, nowClock: null });
        day.attendance = { status: s.status, lateMinutes: s.lateMinutes };
      }
      return day;
    });
    return { weekStart: start, days, nextWeekPublishBy: addDays(start, 7 - PUBLISH_LEAD_DAYS) };
  }
}
