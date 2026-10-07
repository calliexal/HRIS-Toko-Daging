import type { Anomaly, AttendanceRecord, AttendanceSummary, ClockRequest, ClockResult, Employee, GeoFix, GeofenceCheck, TodayShift } from '@dagingpeople/contracts';
import { requireEmployee, requireLocation, requireRole, type Actor } from '../../common/actor';
import { writeAudit } from '../../common/audit';
import type { Clock } from '../../common/clock';
import type { Db } from '../../common/db';
import { forbidden, notFound, validation } from '../../common/errors';
import { distanceMeters, localClock, localDate, zonedDateTime } from '../../common/time';
import { parseQrToken, verifyQrToken } from '../kiosk/kiosk.domain';
import { dailyStatus, decideClock, lateMinutes, rejectMessage, resolveEventTime, type ClockDecision } from './attendance.domain';
import { AttendanceRepository, type DayRow, type EmployeeContext, type StoredEvent } from './attendance.repository';

/** Rahasia QR kiosk gudang (dibaca & didekripsi oleh modul kiosk). */
export type QrSecretLookup = (kioskId: string) => Promise<{ secret: Buffer; locationId: string } | null>;

const LEAVE_LABEL: Record<string, string> = { annual: 'Cuti tahunan', permit: 'Izin', sick: 'Sakit' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const toEmployee = (r: { employee_id?: string; id?: string; code: string; full_name: string; position: string; location_id: string; employment_type: Employee['employmentType'] }): Employee => ({
  id: (r.employee_id ?? r.id)!,
  code: r.code,
  name: r.full_name,
  position: r.position,
  locationId: r.location_id,
  employmentType: r.employment_type,
});

export class AttendanceService {
  private readonly repo: AttendanceRepository;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly qrSecrets: QrSecretLookup,
  ) {
    this.repo = new AttendanceRepository(db);
  }

  private async context(employeeId: string): Promise<EmployeeContext> {
    const ctx = await this.repo.employeeContext(employeeId);
    if (!ctx) throw notFound('EMPLOYEE_NOT_FOUND', 'Data karyawan tidak ditemukan atau sudah tidak aktif.');
    return ctx;
  }

  private shiftLabel = (name: string | null, start: string | null, end: string | null) =>
    name && start && end ? `${name} · ${start.replace(':', '.')}–${end.replace(':', '.')}` : 'Tanpa shift';

  // ------------------------------------------------------------------ karyawan
  async getToday(actor: Actor): Promise<TodayShift> {
    const ctx = await this.context(requireEmployee(actor));
    const now = this.clock.now();
    const date = localDate(now, ctx.timezone);
    const [shift, day] = await Promise.all([this.repo.dayShift(ctx.id, date), this.repo.dayRecord(ctx.id, date)]);
    const { status } = dailyStatus({
      cell: shift?.cell ?? null,
      shiftStart: shift?.start_time ?? null,
      shiftEnd: shift?.end_time ?? null,
      clockIn: day?.clock_in ?? null,
      nowClock: localClock(now, ctx.timezone),
    });
    return {
      date,
      shift: shift?.shift_code ? { code: shift.shift_code as 'P' | 'S' | 'SB', name: shift.shift_name!, start: shift.start_time!, end: shift.end_time! } : null,
      location: { id: ctx.location_id, name: ctx.location_name, type: ctx.location_type, radiusM: ctx.radius_m },
      clockIn: day?.clock_in ?? null,
      clockOut: day?.clock_out ?? null,
      status: status === 'later_shift' ? 'not_yet' : status,
      serverTime: localClock(now, ctx.timezone),
    };
  }

  async checkGeofence(actor: Actor, geo: GeoFix): Promise<GeofenceCheck> {
    const ctx = await this.context(requireEmployee(actor));
    const distance = Math.round(distanceMeters({ lat: geo.lat, lng: geo.lng }, { lat: ctx.lat, lng: ctx.lng }));
    return { inside: distance <= ctx.radius_m, distanceM: distance, locationName: ctx.location_name };
  }

  /** POST /attendance/clock (dan tiap item POST /attendance/sync). Idempoten per clientUuid. */
  async clockFromApp(actor: Actor, request: ClockRequest): Promise<ClockResult> {
    const employeeId = requireEmployee(actor);
    if (request.method === 'kiosk_card' || request.method === 'kiosk_pin') throw forbidden('Absen kiosk hanya lewat perangkat kiosk.');
    return this.record(employeeId, request, null);
  }

  async sync(actor: Actor, requests: ClockRequest[]): Promise<{ clientUuid: string; result: ClockResult }[]> {
    if (requests.length > 200) throw validation('SYNC_TOO_LARGE', 'Kirim paling banyak 200 absen sekaligus.');
    const results: { clientUuid: string; result: ClockResult }[] = [];
    for (const r of requests) results.push({ clientUuid: r.clientUuid, result: await this.clockFromApp(actor, { ...r, offline: true }) });
    return results;
  }

  /** Dipakai juga oleh modul kiosk (method kiosk_card / kiosk_pin, lokasi = lokasi kiosk). */
  async record(employeeId: string, request: ClockRequest, kiosk: { kioskId: string; locationId: string } | null): Promise<ClockResult> {
    if (!UUID.test(request.clientUuid)) throw validation('INVALID_CLIENT_UUID', 'ID absen dari aplikasi tidak valid. Perbarui aplikasi lalu coba lagi.');
    const ctx = await this.context(employeeId);
    const receivedAt = this.clock.now();
    const eventTime = resolveEventTime(request.offline, request.deviceEventTime, receivedAt);

    let locationId: string | null = kiosk?.locationId ?? ctx.location_id;
    let geofence: { inside: boolean; distanceM: number } | undefined;
    let qr: 'valid' | 'expired' | 'invalid' | undefined;

    if (request.method === 'app_gps' && request.geo) {
      const distanceM = Math.round(distanceMeters(request.geo, { lat: ctx.lat, lng: ctx.lng }));
      geofence = { inside: distanceM <= ctx.radius_m, distanceM };
    }
    if (request.method === 'app_gps' && !request.geo && !request.offline) {
      throw validation('LOCATION_REQUIRED', 'Lokasi HP belum terbaca. Nyalakan GPS lalu coba lagi.');
    }
    if (request.method === 'app_qr') {
      const parsed = request.qrToken ? parseQrToken(request.qrToken) : null;
      const kioskSecret = parsed ? await this.qrSecrets(parsed.kioskId) : null;
      qr = parsed && kioskSecret ? verifyQrToken(parsed, kioskSecret.secret, eventTime.getTime()) : 'invalid';
      locationId = kioskSecret?.locationId ?? null;
    }

    const decision: ClockDecision = decideClock({
      method: request.method,
      isMockLocation: request.geo?.isMock ?? false,
      geofence,
      qr,
      fieldDutyReason: request.fieldDuty?.reason,
      offline: request.offline,
      eventTime,
      receivedAt,
    });

    const location = locationId ? await this.repo.location(locationId) : undefined;
    const tz = location?.timezone ?? ctx.timezone;
    const workDate = localDate(eventTime, tz);
    const { event } = await this.repo.insertEvent({
      employeeId,
      clientUuid: request.clientUuid,
      deviceId: kiosk?.kioskId ?? null,
      direction: request.direction,
      method: request.method,
      locationId,
      eventTime,
      workDate,
      lat: request.geo?.lat ?? null,
      lng: request.geo?.lng ?? null,
      accuracyM: request.geo ? Math.round(request.geo.accuracyM) : null,
      distanceM: geofence?.distanceM ?? null,
      isMock: request.geo?.isMock ?? false,
      offline: request.offline,
      fieldDutyReason: request.fieldDuty?.reason ?? null,
      photoObjectKey: request.photoRef ?? null,
      status: decision.status,
      rejectReason: decision.status === 'rejected' ? decision.reason : null,
      reviewKind: decision.status === 'needs_review' ? decision.reviewKind : null,
    });
    return this.toResult(event, employeeId);
  }

  /** Hasil dibangun dari event TERSIMPAN, sehingga pengiriman ulang mendapat jawaban yang sama. */
  private async toResult(event: StoredEvent, employeeId: string): Promise<ClockResult> {
    const shift = await this.repo.dayShift(employeeId, event.work_date);
    const shiftLabel = this.shiftLabel(shift?.shift_name ?? null, shift?.start_time ?? null, shift?.end_time ?? null);
    const locationName = event.location_name ?? '';
    if (event.status === 'rejected') {
      const reason = event.reject_reason as Extract<ClockResult, { outcome: 'rejected' }>['reason'];
      return { outcome: 'rejected', reason, detail: rejectMessage[reason]({ distanceM: event.distance_m ?? undefined, locationName }) };
    }
    if (event.status === 'needs_review') {
      return { outcome: 'pending_approval', direction: event.direction, time: event.event_clock, locationName, shiftLabel };
    }
    const late = event.direction === 'in' && shift?.start_time ? lateMinutes(shift.start_time, event.event_clock) : 0;
    return { outcome: 'recorded', direction: event.direction, time: event.event_clock, status: late > 0 ? 'late' : 'on_time', lateMinutes: late, locationName, shiftLabel };
  }

  // ------------------------------------------------------------------ Kepala Toko / HR
  async getRecords(actor: Actor, locationId: string): Promise<AttendanceRecord[]> {
    requireLocation(actor, locationId);
    const location = await this.repo.location(locationId);
    if (!location) throw notFound('LOCATION_NOT_FOUND', 'Lokasi tidak ditemukan.');
    const now = this.clock.now();
    const date = localDate(now, location.timezone);
    const rows = await this.repo.locationDay(locationId, date);
    return rows.map((r) => this.toRecord(r, date, localClock(now, location.timezone)));
  }

  private toRecord(r: DayRow, date: string, nowClock: string): AttendanceRecord {
    const cell = r.leave_type ? 'LEAVE' : r.cell;
    const { status, lateMinutes: late } = dailyStatus({ cell, shiftStart: r.start_time, shiftEnd: r.end_time, clockIn: r.clock_in, nowClock });
    return {
      employee: toEmployee(r),
      date,
      shift: r.shift_code ? { code: r.shift_code as 'P' | 'S' | 'SB', name: r.shift_name!, start: r.start_time!, end: r.end_time! } : null,
      clockIn: r.clock_in,
      clockOut: r.clock_out,
      method: (r.method as AttendanceRecord['method']) ?? null,
      status,
      lateMinutes: late,
      leaveLabel: r.leave_type ? LEAVE_LABEL[r.leave_type] : undefined,
    };
  }

  async getSummary(actor: Actor, locationId: string): Promise<AttendanceSummary> {
    const records = await this.getRecords(actor, locationId);
    const now = this.clock.now();
    return {
      date: localDate(now),
      updatedAt: localClock(now),
      scheduled: records.filter((r) => r.shift).length,
      onTime: records.filter((r) => r.status === 'on_time').length,
      late: records.filter((r) => r.status === 'late').length,
      notYet: records.filter((r) => r.status === 'not_yet').length,
      onLeave: records.filter((r) => r.status === 'leave').length,
    };
  }

  async getAnomalies(actor: Actor, locationId: string): Promise<Anomaly[]> {
    requireLocation(actor, locationId);
    const location = await this.repo.location(locationId);
    if (!location) throw notFound('LOCATION_NOT_FOUND', 'Lokasi tidak ditemukan.');
    const rows = await this.repo.anomalies(locationId, localDate(this.clock.now(), location.timezone));
    const employees = new Map((await this.repo.locationDay(locationId, localDate(this.clock.now(), location.timezone))).map((r) => [r.employee_id, toEmployee(r)]));
    return rows.flatMap((a) => {
      const employee = employees.get(a.employee_id);
      if (!employee) return [];
      const detail =
        a.kind === 'missing_clock_out'
          ? `Masuk ${a.detail_clock?.replace(':', '.')}, absen pulang tidak tercatat`
          : a.kind === 'outside_geofence'
            ? `${a.distance_m ?? '?'} m dari ${location.name}${a.field_duty_reason ? ` · alasan: ${a.field_duty_reason}` : ''}`
            : `Absen offline, terkirim ${a.delay_hours ?? '?'} jam kemudian`;
      return [{ id: a.id, kind: a.kind as Anomaly['kind'], employee, date: a.work_date, detail }];
    });
  }

  /** Kepala Toko mengajukan koreksi; HR memutuskan (ATT-03 AC2). */
  async requestCorrection(actor: Actor, input: { employeeId: string; workDate: string; clockIn?: string; clockOut?: string; reason: string }) {
    requireRole(actor, 'store_manager', 'hr');
    const ctx = await this.context(input.employeeId);
    requireLocation(actor, ctx.location_id);
    if (!input.reason.trim()) throw validation('REASON_REQUIRED', 'Tulis alasan koreksi agar HR bisa memeriksa.');
    if (!input.clockIn && !input.clockOut) throw validation('TIME_REQUIRED', 'Isi jam masuk atau jam pulang yang benar.');
    const at = (hhmm?: string) => (hhmm ? zonedDateTime(input.workDate, hhmm, ctx.timezone) : null);
    const row = await this.repo.insertCorrection({ employeeId: input.employeeId, workDate: input.workDate, clockIn: at(input.clockIn), clockOut: at(input.clockOut), reason: input.reason, requestedBy: actor.userId });
    return { id: row!.id, status: 'pending' as const };
  }

  async decideCorrection(actor: Actor, id: string, decision: 'approve' | 'reject', note?: string) {
    requireRole(actor, 'hr');
    if (decision === 'reject' && !note?.trim()) throw validation('NOTE_REQUIRED', 'Tulis alasan penolakan agar karyawan tahu langkah berikutnya.');
    return this.db.transaction(async (tx) => {
      const repo = new AttendanceRepository(tx);
      const row = await repo.decideCorrection(id, decision === 'approve' ? 'approved' : 'rejected', actor.userId, note ?? null);
      if (!row) throw notFound('CORRECTION_NOT_FOUND', 'Koreksi tidak ditemukan atau sudah diputuskan.');
      await writeAudit(tx, { actorId: actor.userId, action: `attendance_correction.${decision}`, entity: 'attendance_correction', entityId: id, diff: { employeeId: row.employee_id, workDate: row.work_date } });
      return row;
    });
  }

  /** Tugas luar & absen offline lama: Kepala Toko lokasi itu atau HR. */
  async decideReview(actor: Actor, eventId: string, decision: 'approve' | 'reject', note?: string) {
    requireRole(actor, 'store_manager', 'hr');
    if (decision === 'reject' && !note?.trim()) throw validation('NOTE_REQUIRED', 'Tulis alasan penolakan agar karyawan tahu langkah berikutnya.');
    const target = await this.repo.reviewTarget(eventId);
    if (!target) throw notFound('REVIEW_NOT_FOUND', 'Absen ini tidak menunggu persetujuan.');
    requireLocation(actor, target.location_id);
    return this.db.transaction(async (tx) => {
      const inserted = await new AttendanceRepository(tx).insertReview(eventId, decision === 'approve' ? 'approved' : 'rejected', actor.userId, note ?? null);
      if (inserted.length === 0) throw notFound('REVIEW_NOT_FOUND', 'Absen ini sudah diputuskan.');
      await writeAudit(tx, { actorId: actor.userId, action: `attendance_review.${decision}`, entity: 'attendance_event', entityId: eventId, diff: { employeeId: target.employee_id, kind: target.review_kind } });
      return { id: eventId, status: decision === 'approve' ? ('approved' as const) : ('rejected' as const) };
    });
  }
}
