import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fixedClock } from '../../src/common/clock';
import type { Actor } from '../../src/common/actor';
import { ApprovalsService } from '../../src/modules/approvals/approvals.service';
import { AttendanceService } from '../../src/modules/attendance/attendance.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { CoreHrService } from '../../src/modules/core-hr/core-hr.service';
import { KioskService } from '../../src/modules/kiosk/kiosk.service';
import { LeaveService } from '../../src/modules/leave/leave.service';
import { PayrollService } from '../../src/modules/payroll/payroll.service';
import { SchedulingService } from '../../src/modules/scheduling/scheduling.service';
import { PsqlDb } from './psql-db';
import type { Db } from '../../src/common/db';

/** Kunci uji tetap (32 byte) — template database di-seed dengan kunci yang sama. */
export const TEST_KEYS = {
  dataKey: Buffer.alloc(32, 1),
  indexKey: Buffer.alloc(32, 2),
  jwtKey: Buffer.alloc(32, 3),
};

export const TEMPLATE_DB = 'dp_template';
/** "Hari ini" sama dengan demo frontend: Rabu 7 Okt 2026, 05.52 WIB. */
export const NOW = '2026-10-07T05:52:00+07:00';

export const actors = {
  hr: { userId: 'u-hr', role: 'hr', employeeId: null, locationIds: [] },
  owner: { userId: 'u-owner', role: 'owner', employeeId: null, locationIds: [] },
  finance: { userId: 'u-finance', role: 'finance', employeeId: null, locationIds: [] },
  hendra: { userId: 'u-hendra', role: 'store_manager', employeeId: 'hendra', locationIds: ['kemang'] },
  joko: { userId: 'u-joko', role: 'employee', employeeId: 'joko', locationIds: [] },
  sari: { userId: 'u-sari', role: 'employee', employeeId: 'sari', locationIds: [] },
  agus: { userId: 'u-agus', role: 'employee', employeeId: 'agus', locationIds: [] },
} satisfies Record<string, Actor>;

const psql = (args: string[]) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

/** Database baru hasil salinan template (migrasi + seed). Tiap test mendapat DB terisolasi. */
export const freshDb = async () => {
  const name = `dp_t_${randomBytes(4).toString('hex')}`;
  psql(['-d', 'postgres', '-c', `CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB}`]);
  const db = new PsqlDb(name);
  const clock = fixedClock(NOW);
  const attendance = new AttendanceService(db, clock, (id) => kiosk.qrSecret(id));
  const kiosk: KioskService = new KioskService(db, clock, TEST_KEYS, attendance);
  const leave = new LeaveService(db, clock);
  const services = {
    db,
    clock,
    attendance,
    kiosk,
    leave,
    scheduling: new SchedulingService(db, clock),
    approvals: new ApprovalsService(db, clock, leave, attendance),
    payroll: new PayrollService(db, clock, TEST_KEYS.dataKey),
    coreHr: new CoreHrService(db, clock, TEST_KEYS),
    auth: new AuthService(db, clock, { key: TEST_KEYS.jwtKey, ttlSeconds: 3600 }),
    close: async () => {
      await db.close();
      psql(['-d', 'postgres', '-c', `DROP DATABASE ${name} WITH (FORCE)`]);
    },
  };
  return services;
};

export type Services = Awaited<ReturnType<typeof freshDb>>;

export const psqlCommand = psql;

/** Absen masuk 5 menit sebelum & pulang tepat akhir shift untuk semua shift terjadwal dalam rentang. */
export const seedPeriodAttendance = async (db: Db, from: string, to: string, exclude: { employeeId: string; date: string }[] = []) => {
  for (const [direction, at] of [['in', `st.start_time - interval '5 minutes'`], ['out', 'st.end_time']] as const) {
    await db.execute(
      `INSERT INTO attendance_event (employee_id, client_uuid, direction, method, location_id, event_time, work_date, status)
       SELECT se.employee_id, gen_random_uuid(), $1, 'app_gps', se.location_id, ((se.work_date + ${at}) AT TIME ZONE 'Asia/Jakarta'), se.work_date, 'recorded'
         FROM schedule_entry se JOIN shift_template st ON st.location_id = se.location_id AND st.code = se.cell
        WHERE se.work_date BETWEEN $2::date AND $3::date
          AND NOT (se.employee_id || '|' || se.work_date::text = ANY($4::text[]))`,
      [direction, from, to, exclude.map((x) => `${x.employeeId}|${x.date}`)],
    );
  }
};
