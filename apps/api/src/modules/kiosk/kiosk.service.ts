import type { ClockDirection, DynamicQr, KioskClockResult, KioskIdentity, KioskInfo, RecentClock } from '@dagingpeople/contracts';
import { randomUUID } from 'node:crypto';
import type { KioskActor } from '../../common/actor';
import type { Clock } from '../../common/clock';
import { one, type Db } from '../../common/db';
import { DomainError, notFound, validation } from '../../common/errors';
import { decrypt, tokenHash, verifySecret } from '../../common/security';
import { localClock, localDate } from '../../common/time';
import type { AttendanceService } from '../attendance/attendance.service';
import { generateQrToken, isPinLocked, PIN_MAX_FAILURES, pinAfterFailure } from './kiosk.domain';

type KioskRow = { id: string; location_id: string; name: string; mode: 'card' | 'dynamic_qr'; qr_secret_ciphertext: string | null; location_name: string; location_type: 'outlet' | 'gudang' | 'kantor'; radius_m: number; timezone: string };
type EmployeeRow = { id: string; code: string; full_name: string; position: string; kiosk_pin_hash: string | null; pin_failed_count: number; pin_locked_until_ms: number | null };

const hexToBuffer = (v: string | null) => (v ? Buffer.from(v.replace(/^\\x/, ''), 'hex') : null);

export class KioskService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly keys: { dataKey: Buffer; indexKey: Buffer },
    private readonly attendance: AttendanceService,
  ) {}

  /** Kiosk login dengan token perangkat (disimpan hanya hash-nya). */
  async authenticate(deviceToken: string): Promise<KioskActor | null> {
    const row = await one(this.db.query<{ id: string; location_id: string; mode: 'card' | 'dynamic_qr' }>(
      `SELECT id, location_id, mode FROM kiosk_device WHERE device_token_hash = decode($1, 'hex') AND active`,
      [tokenHash(deviceToken, this.keys.indexKey).toString('hex')],
    ));
    return row ? { kioskId: row.id, locationId: row.location_id, mode: row.mode } : null;
  }

  private async kiosk(kioskId: string): Promise<KioskRow> {
    const row = await one(this.db.query<KioskRow>(
      `SELECT k.id, k.location_id, k.name, k.mode, encode(k.qr_secret_ciphertext, 'hex') AS qr_secret_ciphertext,
              l.name AS location_name, l.type AS location_type, l.radius_m, l.timezone
         FROM kiosk_device k JOIN location l ON l.id = k.location_id WHERE k.id = $1 AND k.active`,
      [kioskId],
    ));
    if (!row) throw notFound('KIOSK_NOT_FOUND', 'Kiosk tidak terdaftar atau nonaktif. Hubungi HR.');
    return row;
  }

  /** Dipakai AttendanceService untuk memverifikasi QR yang dipindai aplikasi karyawan. */
  readonly qrSecret = async (kioskId: string): Promise<{ secret: Buffer; locationId: string } | null> => {
    const row = await one(this.db.query<{ location_id: string; qr_secret_ciphertext: string | null }>(
      `SELECT location_id, encode(qr_secret_ciphertext, 'hex') AS qr_secret_ciphertext FROM kiosk_device WHERE id = $1 AND active AND mode = 'dynamic_qr'`,
      [kioskId],
    ));
    const cipher = hexToBuffer(row?.qr_secret_ciphertext ?? null);
    return row && cipher ? { secret: Buffer.from(decrypt(cipher, this.keys.dataKey), 'base64'), locationId: row.location_id } : null;
  };

  async getInfo(k: KioskActor): Promise<KioskInfo> {
    const row = await this.kiosk(k.kioskId);
    return { id: row.id, name: row.name, location: { id: row.location_id, name: row.location_name, type: row.location_type, radiusM: row.radius_m }, mode: row.mode };
  }

  async getServerTime(k: KioskActor): Promise<{ time: string; date: string }> {
    const row = await this.kiosk(k.kioskId);
    const now = this.clock.now();
    return { time: localClock(now, row.timezone), date: localDate(now, row.timezone) };
  }

  async getDynamicQr(k: KioskActor): Promise<DynamicQr> {
    const secret = await this.qrSecret(k.kioskId);
    if (!secret) throw validation('NOT_QR_KIOSK', 'Kiosk ini memakai mode kartu, bukan QR dinamis.');
    return generateQrToken(k.kioskId, secret.secret, this.clock.now().getTime());
  }

  async getRecentClocks(k: KioskActor): Promise<RecentClock[]> {
    const row = await this.kiosk(k.kioskId);
    const rows = await this.db.query<{ first_name: string; direction: ClockDirection; time: string }>(
      `SELECT split_part(e.full_name, ' ', 1) AS first_name, ev.direction,
              to_char(ev.event_time AT TIME ZONE $3, 'HH24:MI') AS time
         FROM attendance_event ev JOIN employee e ON e.id = ev.employee_id
        WHERE ev.location_id = $1 AND ev.work_date = $2::date AND ev.status = 'recorded'
          AND ev.method IN ('kiosk_card', 'kiosk_pin', 'app_qr')
        ORDER BY ev.event_time DESC LIMIT 5`,
      [row.location_id, localDate(this.clock.now(), row.timezone), row.timezone],
    );
    return rows.map((r) => ({ name: r.first_name, direction: r.direction, time: r.time }));
  }

  private employeeBy(where: string, value: string) {
    return one(this.db.query<EmployeeRow>(
      `SELECT id, code, full_name, position, kiosk_pin_hash, pin_failed_count,
              (extract(epoch FROM pin_locked_until) * 1000)::bigint AS pin_locked_until_ms
         FROM employee WHERE ${where} AND end_date IS NULL`,
      [value],
    ));
  }

  async identifyByCard(_k: KioskActor, cardToken: string): Promise<KioskIdentity | null> {
    const e = await this.employeeBy(`card_token_hash = decode($1, 'hex')`, tokenHash(cardToken, this.keys.indexKey).toString('hex'));
    return e ? { employeeId: e.id, name: e.full_name, position: e.position } : null;
  }

  async lookupEmployeeCode(_k: KioskActor, code: string): Promise<KioskIdentity | null> {
    if (!/^\d{1,4}$/.test(code)) return null;
    const e = await this.employeeBy(`code LIKE 'DPN-____-' || $1`, code.padStart(4, '0'));
    return e ? { employeeId: e.id, name: e.full_name, position: e.position } : null;
  }

  /** Arah absen: masuk bila hari ini belum ada absen masuk, selain itu pulang. */
  private async nextDirection(employeeId: string, tz: string): Promise<ClockDirection> {
    const row = await one(this.db.query<{ has_in: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM attendance_event WHERE employee_id = $1 AND work_date = $2::date AND direction = 'in' AND status = 'recorded') AS has_in`,
      [employeeId, localDate(this.clock.now(), tz)],
    ));
    return row?.has_in ? 'out' : 'in';
  }

  private async clockFor(k: KioskActor, employee: { id: string; full_name: string }, method: 'kiosk_card' | 'kiosk_pin', photoRef: string): Promise<KioskClockResult> {
    const row = await this.kiosk(k.kioskId);
    const direction = await this.nextDirection(employee.id, row.timezone);
    const result = await this.attendance.record(
      employee.id,
      { clientUuid: randomUUID(), direction, method, photoRef, deviceEventTime: this.clock.now().toISOString(), offline: false },
      { kioskId: k.kioskId, locationId: k.locationId },
    );
    if (result.outcome !== 'recorded') throw new DomainError('conflict', 'KIOSK_CLOCK_FAILED', 'Absen belum tercatat. Coba lagi atau hubungi Kepala Toko.');
    return { outcome: 'recorded', name: employee.full_name, direction, time: result.time, status: result.status, lateMinutes: result.lateMinutes };
  }

  async clockWithCard(k: KioskActor, cardToken: string, photoRef: string): Promise<KioskClockResult> {
    const e = await this.employeeBy(`card_token_hash = decode($1, 'hex')`, tokenHash(cardToken, this.keys.indexKey).toString('hex'));
    if (!e) return { outcome: 'rejected', reason: 'unknown_card' };
    return this.clockFor(k, e, 'kiosk_card', photoRef);
  }

  /** ATT-02 AC2: lock per karyawan; kiosk tetap bisa dipakai orang lain. */
  async clockWithPin(k: KioskActor, employeeCode: string, pin: string, photoRef: string): Promise<KioskClockResult> {
    const row = await this.kiosk(k.kioskId);
    const e = await this.employeeBy(`code LIKE 'DPN-____-' || $1`, employeeCode.padStart(4, '0'));
    if (!e || !e.kiosk_pin_hash) return { outcome: 'rejected', reason: 'wrong_pin', attemptsLeft: undefined };
    const now = this.clock.now();
    const state = { failedCount: e.pin_failed_count, lockedUntil: e.pin_locked_until_ms ? new Date(e.pin_locked_until_ms) : null };
    if (isPinLocked(state, now)) return { outcome: 'rejected', reason: 'locked', lockedUntil: localClock(state.lockedUntil!, row.timezone) };

    // Jatah percobaan dipesan atomik sebelum PIN diperiksa: PIN 6 digit hanya aman bila batas 3x tidak bisa
    // dilewati dengan mengirim banyak tebakan paralel.
    const attempt = await one(this.db.query<{ attempt: number }>(
      `UPDATE employee SET pin_failed_count = pin_failed_count + 1
        WHERE id = $1 AND (pin_locked_until IS NULL OR pin_locked_until <= $2::timestamptz)
        RETURNING pin_failed_count AS attempt`,
      [e.id, now],
    ));
    const lockOut = async () => {
      const next = pinAfterFailure({ failedCount: PIN_MAX_FAILURES - 1, lockedUntil: null }, now);
      const locked = await one(this.db.query<{ until_ms: number }>(
        `UPDATE employee SET pin_failed_count = 0,
                pin_locked_until = CASE WHEN pin_locked_until > $2::timestamptz THEN pin_locked_until ELSE $3::timestamptz END
          WHERE id = $1 RETURNING (extract(epoch FROM pin_locked_until) * 1000)::bigint AS until_ms`,
        [e.id, now, next.lockedUntil],
      ));
      return { outcome: 'rejected' as const, reason: 'locked' as const, lockedUntil: localClock(new Date(Number(locked!.until_ms)), row.timezone) };
    };
    if (!attempt || attempt.attempt > PIN_MAX_FAILURES) return lockOut();

    if (!(await verifySecret(pin, e.kiosk_pin_hash))) {
      if (attempt.attempt >= PIN_MAX_FAILURES) return lockOut();
      return { outcome: 'rejected', reason: 'wrong_pin', attemptsLeft: PIN_MAX_FAILURES - attempt.attempt };
    }
    await this.db.execute('UPDATE employee SET pin_failed_count = 0, pin_locked_until = NULL WHERE id = $1', [e.id]);
    return this.clockFor(k, e, 'kiosk_pin', photoRef);
  }
}
