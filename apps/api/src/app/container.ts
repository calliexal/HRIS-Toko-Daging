import type { Clock } from '../common/clock';
import type { Db } from '../common/db';
import { ApprovalsService } from '../modules/approvals/approvals.service';
import { AttendanceService } from '../modules/attendance/attendance.service';
import { AuthService } from '../modules/auth/auth.service';
import { CoreHrService } from '../modules/core-hr/core-hr.service';
import { KioskService } from '../modules/kiosk/kiosk.service';
import { LeaveService } from '../modules/leave/leave.service';
import { PayrollService } from '../modules/payroll/payroll.service';
import { SchedulingService } from '../modules/scheduling/scheduling.service';

export type ContainerConfig = {
  dataKey: Buffer;
  indexKey: Buffer;
  jwtKey: Buffer;
  jwtTtlSeconds: number;
  /** Payroll v1 hanya satu badan hukum (PT Daging Prima Nusantara). */
  legalEntityId: string;
};

/**
 * Merakit semua service modul. Dipakai bersama oleh AppModule NestJS (factory provider)
 * dan server HTTP ringan untuk uji end-to-end, supaya wiring-nya satu.
 * Siklus kiosk ↔ absensi diputus lewat fungsi lookup rahasia QR (dipanggil lambat).
 */
export const buildServices = (db: Db, clock: Clock, config: ContainerConfig) => {
  const keys = { dataKey: config.dataKey, indexKey: config.indexKey };
  const attendance = new AttendanceService(db, clock, (kioskId) => kiosk.qrSecret(kioskId));
  const kiosk: KioskService = new KioskService(db, clock, keys, attendance);
  const leave = new LeaveService(db, clock);
  return {
    config,
    attendance,
    kiosk,
    leave,
    scheduling: new SchedulingService(db, clock),
    approvals: new ApprovalsService(db, clock, leave, attendance),
    payroll: new PayrollService(db, clock, config.dataKey),
    coreHr: new CoreHrService(db, clock, keys),
    auth: new AuthService(db, clock, { key: config.jwtKey, ttlSeconds: config.jwtTtlSeconds }),
  };
};

export type AppServices = ReturnType<typeof buildServices>;
