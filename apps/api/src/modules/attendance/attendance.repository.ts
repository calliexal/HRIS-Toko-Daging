import { one, type Db } from '../../common/db';

export type EmployeeContext = {
  id: string;
  code: string;
  full_name: string;
  position: string;
  employment_type: 'PKWTT' | 'PKWT' | 'HARIAN';
  location_id: string;
  location_name: string;
  location_type: 'outlet' | 'gudang' | 'kantor';
  lat: number;
  lng: number;
  radius_m: number;
  timezone: string;
};

export type DayShift = { cell: string | null; shift_code: string | null; shift_name: string | null; start_time: string | null; end_time: string | null };

export type DayRow = {
  employee_id: string;
  code: string;
  full_name: string;
  position: string;
  employment_type: 'PKWTT' | 'PKWT' | 'HARIAN';
  location_id: string;
  cell: string | null;
  shift_code: string | null;
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
  clock_in: string | null;
  clock_out: string | null;
  method: string | null;
  leave_type: string | null;
};

export type NewEvent = {
  employeeId: string;
  clientUuid: string;
  deviceId: string | null;
  direction: 'in' | 'out';
  method: string;
  locationId: string | null;
  eventTime: Date;
  workDate: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  distanceM: number | null;
  isMock: boolean;
  offline: boolean;
  fieldDutyReason: string | null;
  photoObjectKey: string | null;
  status: string;
  rejectReason: string | null;
  reviewKind: string | null;
};

export type StoredEvent = {
  id: string;
  direction: 'in' | 'out';
  method: string;
  status: 'recorded' | 'needs_review' | 'rejected';
  reject_reason: string | null;
  review_kind: string | null;
  distance_m: number | null;
  work_date: string;
  event_clock: string;
  location_name: string | null;
};

const EVENT_COLUMNS = `
  e.id::text, e.direction, e.method, e.status, e.reject_reason, e.review_kind, e.distance_m, e.work_date,
  to_char(e.event_time AT TIME ZONE coalesce(l.timezone, 'Asia/Jakarta'), 'HH24:MI') AS event_clock,
  l.name AS location_name`;

export class AttendanceRepository {
  constructor(private readonly db: Db) {}

  employeeContext(employeeId: string) {
    return one(
      this.db.query<EmployeeContext>(
        `SELECT e.id, e.code, e.full_name, e.position, e.employment_type, e.location_id,
                l.name AS location_name, l.type AS location_type, l.lat, l.lng, l.radius_m, l.timezone
           FROM employee e JOIN location l ON l.id = e.location_id
          WHERE e.id = $1 AND e.end_date IS NULL`,
        [employeeId],
      ),
    );
  }

  location(locationId: string) {
    return one(this.db.query<{ id: string; name: string; type: string; timezone: string; lat: number; lng: number; radius_m: number }>(
      'SELECT id, name, type, timezone, lat, lng, radius_m FROM location WHERE id = $1',
      [locationId],
    ));
  }

  dayShift(employeeId: string, workDate: string) {
    return one(
      this.db.query<DayShift>(
        `SELECT se.cell, st.code AS shift_code, st.name AS shift_name,
                to_char(st.start_time, 'HH24:MI') AS start_time, to_char(st.end_time, 'HH24:MI') AS end_time
           FROM schedule_entry se
           LEFT JOIN shift_template st ON st.location_id = se.location_id AND st.code = se.cell
          WHERE se.employee_id = $1 AND se.work_date = $2::date`,
        [employeeId, workDate],
      ),
    );
  }

  /** Tercatat sekali per (karyawan, client_uuid): pengiriman ulang dari antrean offline mengembalikan event yang sama. */
  async insertEvent(e: NewEvent): Promise<{ event: StoredEvent; duplicate: boolean }> {
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO attendance_event (employee_id, client_uuid, device_id, direction, method, location_id, event_time, work_date,
                                     lat, lng, accuracy_m, distance_m, is_mock_location, offline, field_duty_reason,
                                     photo_object_key, status, reject_reason, review_kind)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::date, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (employee_id, client_uuid) DO NOTHING
       RETURNING id::text`,
      [e.employeeId, e.clientUuid, e.deviceId, e.direction, e.method, e.locationId, e.eventTime, e.workDate, e.lat, e.lng,
        e.accuracyM, e.distanceM, e.isMock, e.offline, e.fieldDutyReason, e.photoObjectKey, e.status, e.rejectReason, e.reviewKind],
    );
    const event = await one(
      this.db.query<StoredEvent>(
        `SELECT ${EVENT_COLUMNS} FROM attendance_event e LEFT JOIN location l ON l.id = e.location_id
          WHERE e.employee_id = $1 AND e.client_uuid = $2::uuid`,
        [e.employeeId, e.clientUuid],
      ),
    );
    if (!event) throw new Error('Event absensi tidak tersimpan.');
    return { event, duplicate: inserted.length === 0 };
  }

  dayRecord(employeeId: string, workDate: string) {
    return one(
      this.db.query<{ clock_in: string | null; clock_out: string | null }>(
        `SELECT to_char(d.clock_in AT TIME ZONE l.timezone, 'HH24:MI') AS clock_in,
                to_char(d.clock_out AT TIME ZONE l.timezone, 'HH24:MI') AS clock_out
           FROM attendance_day_v d JOIN employee e ON e.id = d.employee_id JOIN location l ON l.id = e.location_id
          WHERE d.employee_id = $1 AND d.work_date = $2::date`,
        [employeeId, workDate],
      ),
    );
  }

  /** Satu baris per karyawan aktif di lokasi: jadwal, absen, dan cuti pada tanggal itu. */
  locationDay(locationId: string, workDate: string) {
    return this.db.query<DayRow>(
      `SELECT e.id AS employee_id, e.code, e.full_name, e.position, e.employment_type, e.location_id,
              se.cell, st.code AS shift_code, st.name AS shift_name,
              to_char(st.start_time, 'HH24:MI') AS start_time, to_char(st.end_time, 'HH24:MI') AS end_time,
              to_char(d.clock_in AT TIME ZONE l.timezone, 'HH24:MI') AS clock_in,
              to_char(d.clock_out AT TIME ZONE l.timezone, 'HH24:MI') AS clock_out,
              d.method,
              (SELECT lr.type FROM leave_request lr
                WHERE lr.employee_id = e.id AND lr.status = 'approved' AND $2::date BETWEEN lr.start_date AND lr.end_date
                LIMIT 1) AS leave_type
         FROM employee e
         JOIN location l ON l.id = e.location_id
         LEFT JOIN schedule_entry se ON se.employee_id = e.id AND se.work_date = $2::date
         LEFT JOIN shift_template st ON st.location_id = se.location_id AND st.code = se.cell
         LEFT JOIN attendance_day_v d ON d.employee_id = e.id AND d.work_date = $2::date
        WHERE e.location_id = $1 AND e.end_date IS NULL
        ORDER BY st.start_time NULLS LAST, e.full_name`,
      [locationId, workDate],
    );
  }

  /** Anomali 7 hari terakhir: lupa absen pulang, event yang menunggu review. */
  anomalies(locationId: string, today: string) {
    return this.db.query<{ id: string; kind: string; employee_id: string; work_date: string; detail_clock: string | null; distance_m: number | null; field_duty_reason: string | null; delay_hours: number | null }>(
      `SELECT 'missing:' || d.employee_id || ':' || d.work_date AS id, 'missing_clock_out' AS kind, d.employee_id, d.work_date,
              to_char(d.clock_in AT TIME ZONE l.timezone, 'HH24:MI') AS detail_clock, NULL::int AS distance_m,
              NULL::text AS field_duty_reason, NULL::int AS delay_hours
         FROM attendance_day_v d JOIN employee e ON e.id = d.employee_id JOIN location l ON l.id = e.location_id
        WHERE e.location_id = $1 AND d.work_date >= $2::date - 7 AND d.work_date < $2::date
          AND d.clock_in IS NOT NULL AND d.clock_out IS NULL
       UNION ALL
       SELECT ev.id::text, CASE ev.review_kind WHEN 'field_duty' THEN 'outside_geofence' ELSE 'offline_delayed' END,
              ev.employee_id, ev.work_date, to_char(ev.event_time AT TIME ZONE l.timezone, 'HH24:MI'),
              ev.distance_m, ev.field_duty_reason,
              floor(extract(epoch FROM ev.received_at - ev.event_time) / 3600)::int
         FROM attendance_event ev JOIN employee e ON e.id = ev.employee_id JOIN location l ON l.id = e.location_id
         LEFT JOIN attendance_review r ON r.event_id = ev.id
        WHERE e.location_id = $1 AND ev.status = 'needs_review' AND r.event_id IS NULL
        ORDER BY work_date DESC`,
      [locationId, today],
    );
  }

  insertReview(eventId: string, decision: 'approved' | 'rejected', decidedBy: string, note: string | null) {
    return this.db.query<{ event_id: string }>(
      `INSERT INTO attendance_review (event_id, decision, decided_by, note) VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id::text`,
      [eventId, decision, decidedBy, note],
    );
  }

  reviewTarget(eventId: string) {
    return one(this.db.query<{ id: string; employee_id: string; location_id: string; review_kind: string }>(
      `SELECT ev.id::text, ev.employee_id, e.location_id, ev.review_kind
         FROM attendance_event ev JOIN employee e ON e.id = ev.employee_id
        WHERE ev.id = $1::uuid AND ev.status = 'needs_review'`,
      [eventId],
    ));
  }

  insertCorrection(c: { employeeId: string; workDate: string; clockIn: Date | null; clockOut: Date | null; reason: string; requestedBy: string }) {
    return one(this.db.query<{ id: string }>(
      `INSERT INTO attendance_correction (employee_id, work_date, clock_in, clock_out, reason, requested_by)
       VALUES ($1, $2::date, $3::timestamptz, $4::timestamptz, $5, $6) RETURNING id::text`,
      [c.employeeId, c.workDate, c.clockIn, c.clockOut, c.reason, c.requestedBy],
    ));
  }

  decideCorrection(id: string, decision: 'approved' | 'rejected', decidedBy: string, note: string | null) {
    return one(this.db.query<{ id: string; employee_id: string; work_date: string }>(
      `UPDATE attendance_correction SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
        WHERE id = $1::uuid AND status = 'pending' RETURNING id::text, employee_id, work_date`,
      [id, decision, decidedBy, note],
    ));
  }
}
