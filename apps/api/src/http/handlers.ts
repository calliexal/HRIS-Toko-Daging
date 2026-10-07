import { ROUTES, type RouteName } from '@dagingpeople/routes';
import type { Actor, KioskActor } from '../common/actor';
import { DomainError } from '../common/errors';
import type { AppServices } from '../app/container';
import * as S from './schemas';

/**
 * Tabel handler per endpoint (ROUTES). Framework-agnostic: dipanggil oleh controller NestJS
 * maupun server node:http untuk uji end-to-end. Handler hanya: validasi bentuk → panggil service.
 */
export type HandlerContext = {
  actor: Actor | null;
  kiosk: KioskActor | null;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body: unknown;
};

export type FileResult = { kind: 'file'; filename: string; contentType: string; content: string; headers?: Record<string, string> };
export type Handler = (ctx: HandlerContext) => Promise<unknown>;

const user = (ctx: HandlerContext): Actor => {
  if (!ctx.actor) throw new DomainError('unauthenticated', 'UNAUTHENTICATED', 'Sesi berakhir. Silakan masuk lagi.');
  return ctx.actor;
};
const device = (ctx: HandlerContext): KioskActor => {
  if (!ctx.kiosk) throw new DomainError('unauthenticated', 'KIOSK_UNAUTHENTICATED', 'Perangkat kiosk belum terdaftar. Hubungi HR.');
  return ctx.kiosk;
};
const param = (ctx: HandlerContext, name: string) => ctx.params[name]!;

export const createHandlers = (svc: AppServices): Record<RouteName, Handler> => {
  const periodId = (ctx: HandlerContext) => {
    const p = param(ctx, 'period');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new DomainError('validation', 'INVALID_PERIOD', 'Format periode YYYY-MM.');
    return `${svc.config.legalEntityId}-${p}`;
  };

  return {
    login: async (ctx) => {
      const b = S.loginBody.parse(ctx.body);
      return svc.auth.login(b.email, b.password);
    },
    me: async (ctx) => svc.coreHr.getMe(user(ctx)),

    today: async (ctx) => svc.attendance.getToday(user(ctx)),
    geofenceCheck: async (ctx) => svc.attendance.checkGeofence(user(ctx), S.geoFix.parse(ctx.body)),
    clock: async (ctx) => svc.attendance.clockFromApp(user(ctx), S.clockBody.parse(ctx.body)),
    sync: async (ctx) => svc.attendance.sync(user(ctx), S.syncBody.parse(ctx.body).events),
    mySchedule: async (ctx) => svc.scheduling.myWeek(user(ctx), S.weekQuery.parse(ctx.query).weekStart),
    leaveBalance: async (ctx) => svc.leave.balance(user(ctx)),
    leavePreview: async (ctx) => svc.leave.preview(user(ctx), S.leavePreviewBody.parse(ctx.body)),
    leaveSubmit: async (ctx) => svc.leave.submit(user(ctx), S.leaveSubmitBody.parse(ctx.body)),
    payslipPeriods: async (ctx) => svc.payroll.listPayslipPeriods(user(ctx)),
    payslip: async (ctx) => svc.payroll.getPayslip(user(ctx), param(ctx, 'period')),

    kioskInfo: async (ctx) => svc.kiosk.getInfo(device(ctx)),
    kioskTime: async (ctx) => svc.kiosk.getServerTime(device(ctx)),
    kioskQr: async (ctx) => svc.kiosk.getDynamicQr(device(ctx)),
    kioskRecent: async (ctx) => svc.kiosk.getRecentClocks(device(ctx)),
    kioskIdentifyCard: async (ctx) => ({ identity: await svc.kiosk.identifyByCard(device(ctx), S.kioskCardBody.parse(ctx.body).cardToken) }),
    kioskLookupCode: async (ctx) => ({ identity: await svc.kiosk.lookupEmployeeCode(device(ctx), param(ctx, 'code')) }),
    kioskClockCard: async (ctx) => {
      const b = S.kioskCardBody.parse(ctx.body);
      return svc.kiosk.clockWithCard(device(ctx), b.cardToken, b.photoRef);
    },
    kioskClockPin: async (ctx) => {
      const b = S.kioskPinBody.parse(ctx.body);
      return svc.kiosk.clockWithPin(device(ctx), b.employeeCode, b.pin, b.photoRef);
    },

    locations: async (ctx) => svc.coreHr.listLocations(user(ctx)),
    attendanceSummary: async (ctx) => svc.attendance.getSummary(user(ctx), param(ctx, 'locationId')),
    attendanceRecords: async (ctx) => svc.attendance.getRecords(user(ctx), param(ctx, 'locationId')),
    attendanceAnomalies: async (ctx) => svc.attendance.getAnomalies(user(ctx), param(ctx, 'locationId')),
    attendanceCorrection: async (ctx) => svc.attendance.requestCorrection(user(ctx), S.correctionBody.parse(ctx.body)),
    // 'current' = default server: minggu depan (minggu yang sedang disusun Kepala Toko, terbit paling lambat H-3).
    adminSchedule: async (ctx) => svc.scheduling.getWeek(user(ctx), param(ctx, 'locationId'), param(ctx, 'weekStart') === 'current' ? undefined : param(ctx, 'weekStart')),
    scheduleCell: async (ctx) => {
      const b = S.scheduleCellBody.parse(ctx.body);
      return svc.scheduling.updateCell(user(ctx), param(ctx, 'locationId'), param(ctx, 'weekStart'), b.employeeId, b.dayIndex, b.cell);
    },
    schedulePublish: async (ctx) => svc.scheduling.publish(user(ctx), param(ctx, 'locationId'), param(ctx, 'weekStart'), S.schedulePublishBody.parse(ctx.body ?? {}).acknowledgedWarnings),
    approvals: async (ctx) => svc.approvals.list(user(ctx), S.approvalsQuery.parse(ctx.query).kind),
    approvalDecision: async (ctx) => {
      const b = S.decisionBody.parse(ctx.body);
      return svc.approvals.decideById(user(ctx), param(ctx, 'id'), b.decision, b.note);
    },

    payrollCreatePeriod: async (ctx) => {
      const { period } = S.createPeriodBody.parse(ctx.body);
      const id = await svc.payroll.ensurePeriod(user(ctx), svc.config.legalEntityId, period);
      return svc.payroll.getRun(user(ctx), id);
    },
    payrollRun: async (ctx) => svc.payroll.getRun(user(ctx), periodId(ctx)),
    payrollLockAttendance: async (ctx) => svc.payroll.lockAttendance(user(ctx), periodId(ctx)),
    payrollCalculate: async (ctx) => svc.payroll.calculate(user(ctx), periodId(ctx)),
    payrollSubmit: async (ctx) => svc.payroll.submitForApproval(user(ctx), periodId(ctx)),
    payrollDecision: async (ctx) => {
      const b = S.decisionBody.parse(ctx.body);
      return svc.payroll.decideApproval(user(ctx), periodId(ctx), b.decision, b.note);
    },
    payrollLock: async (ctx) => svc.payroll.lockPeriod(user(ctx), periodId(ctx), S.lockPeriodBody.parse(ctx.body).confirmation),
    payrollBankExport: async (ctx): Promise<FileResult> => {
      const f = await svc.payroll.exportBankFile(user(ctx), periodId(ctx));
      return {
        kind: 'file',
        filename: f.filename,
        contentType: f.contentType,
        content: f.content,
        headers: { 'X-Transfer-Count': String(f.count), 'X-Transfer-Total': String(f.total), 'X-Non-Mandiri-Count': String(f.nonMandiriCount) },
      };
    },

    employeeCreate: async (ctx) => svc.coreHr.createEmployee(user(ctx), S.createEmployeeBody.parse(ctx.body)),
    employeeCompensation: async (ctx) => {
      await svc.coreHr.setCompensation(user(ctx), param(ctx, 'employeeId'), S.compensationBody.parse(ctx.body));
      return { ok: true };
    },
    employeePin: async (ctx) => {
      await svc.coreHr.setKioskPin(user(ctx), param(ctx, 'employeeId'), S.pinBody.parse(ctx.body).pin);
      return { ok: true };
    },
    employeeCard: async (ctx) => {
      await svc.coreHr.setCard(user(ctx), param(ctx, 'employeeId'), S.cardBody.parse(ctx.body).cardToken);
      return { ok: true };
    },
    employeeEnd: async (ctx) => {
      await svc.coreHr.endEmployment(user(ctx), param(ctx, 'employeeId'), S.endEmploymentBody.parse(ctx.body).endDate);
      return { ok: true };
    },
  };
};

export const isFileResult = (v: unknown): v is FileResult => typeof v === 'object' && v !== null && (v as FileResult).kind === 'file';
export { ROUTES };
