// File ini DIHASILKAN dari ROUTES (packages/api/src/routes.ts) — controller tipis yang mendelegasikan ke tabel handler bersama.
// Ubah perilaku di src/http/handlers.ts, bukan di sini.
import { Controller, Get, HttpCode, Inject, Post, Put, Res } from '@nestjs/common';
import type { RouteName } from '@dagingpeople/routes';
import type { Handler, HandlerContext } from '../http/handlers';
import { isFileResult } from '../http/handlers';
import { Ctx, Route } from './route.decorator';
import { HANDLERS } from './tokens';

type Handlers = Record<RouteName, Handler>;

@Controller()
export class AuthController {
  constructor(@Inject(HANDLERS) private readonly h: Handlers) {}

  @Post('/auth/login')
  @Route('login')
  @HttpCode(200)
  login(@Ctx() ctx: HandlerContext) {
    return this.h.login(ctx);
  }

  @Get('/me')
  @Route('me')
  me(@Ctx() ctx: HandlerContext) {
    return this.h.me(ctx);
  }

}

@Controller()
export class AttendanceController {
  constructor(@Inject(HANDLERS) private readonly h: Handlers) {}

  @Get('/me/today')
  @Route('today')
  today(@Ctx() ctx: HandlerContext) {
    return this.h.today(ctx);
  }

  @Post('/attendance/geofence-check')
  @Route('geofenceCheck')
  @HttpCode(200)
  geofenceCheck(@Ctx() ctx: HandlerContext) {
    return this.h.geofenceCheck(ctx);
  }

  @Post('/attendance/clock')
  @Route('clock')
  @HttpCode(200)
  clock(@Ctx() ctx: HandlerContext) {
    return this.h.clock(ctx);
  }

  @Post('/attendance/sync')
  @Route('sync')
  @HttpCode(200)
  sync(@Ctx() ctx: HandlerContext) {
    return this.h.sync(ctx);
  }

  @Get('/locations/:locationId/attendance/summary')
  @Route('attendanceSummary')
  attendanceSummary(@Ctx() ctx: HandlerContext) {
    return this.h.attendanceSummary(ctx);
  }

  @Get('/locations/:locationId/attendance/records')
  @Route('attendanceRecords')
  attendanceRecords(@Ctx() ctx: HandlerContext) {
    return this.h.attendanceRecords(ctx);
  }

  @Get('/locations/:locationId/attendance/anomalies')
  @Route('attendanceAnomalies')
  attendanceAnomalies(@Ctx() ctx: HandlerContext) {
    return this.h.attendanceAnomalies(ctx);
  }

  @Post('/attendance/corrections')
  @Route('attendanceCorrection')
  @HttpCode(200)
  attendanceCorrection(@Ctx() ctx: HandlerContext) {
    return this.h.attendanceCorrection(ctx);
  }

}

@Controller()
export class SchedulingController {
  constructor(@Inject(HANDLERS) private readonly h: Handlers) {}

  @Get('/me/schedule')
  @Route('mySchedule')
  mySchedule(@Ctx() ctx: HandlerContext) {
    return this.h.mySchedule(ctx);
  }

  @Get('/locations/:locationId/schedules/:weekStart')
  @Route('adminSchedule')
  adminSchedule(@Ctx() ctx: HandlerContext) {
    return this.h.adminSchedule(ctx);
  }

  @Put('/locations/:locationId/schedules/:weekStart/cells')
  @Route('scheduleCell')
  scheduleCell(@Ctx() ctx: HandlerContext) {
    return this.h.scheduleCell(ctx);
  }

  @Post('/locations/:locationId/schedules/:weekStart/publish')
  @Route('schedulePublish')
  @HttpCode(200)
  schedulePublish(@Ctx() ctx: HandlerContext) {
    return this.h.schedulePublish(ctx);
  }

}

@Controller()
export class LeaveController {
  constructor(@Inject(HANDLERS) private readonly h: Handlers) {}

  @Get('/me/leave-balance')
  @Route('leaveBalance')
  leaveBalance(@Ctx() ctx: HandlerContext) {
    return this.h.leaveBalance(ctx);
  }

  @Post('/leave/preview')
  @Route('leavePreview')
  @HttpCode(200)
  leavePreview(@Ctx() ctx: HandlerContext) {
    return this.h.leavePreview(ctx);
  }

  @Post('/leave')
  @Route('leaveSubmit')
  @HttpCode(201)
  leaveSubmit(@Ctx() ctx: HandlerContext) {
    return this.h.leaveSubmit(ctx);
  }

}

@Controller()
export class ApprovalsController {
  constructor(@Inject(HANDLERS) private readonly h: Handlers) {}

  @Get('/approvals')
  @Route('approvals')
  approvals(@Ctx() ctx: HandlerContext) {
    return this.h.approvals(ctx);
  }

  @Post('/approvals/:id/decision')
  @Route('approvalDecision')
  @HttpCode(200)
  approvalDecision(@Ctx() ctx: HandlerContext) {
    return this.h.approvalDecision(ctx);
  }

}

@Controller()
export class KioskController {
  constructor(@Inject(HANDLERS) private readonly h: Handlers) {}

  @Get('/kiosks/:kioskId')
  @Route('kioskInfo')
  kioskInfo(@Ctx() ctx: HandlerContext) {
    return this.h.kioskInfo(ctx);
  }

  @Get('/kiosks/:kioskId/time')
  @Route('kioskTime')
  kioskTime(@Ctx() ctx: HandlerContext) {
    return this.h.kioskTime(ctx);
  }

  @Get('/kiosks/:kioskId/qr')
  @Route('kioskQr')
  kioskQr(@Ctx() ctx: HandlerContext) {
    return this.h.kioskQr(ctx);
  }

  @Get('/kiosks/:kioskId/recent')
  @Route('kioskRecent')
  kioskRecent(@Ctx() ctx: HandlerContext) {
    return this.h.kioskRecent(ctx);
  }

  @Post('/kiosks/:kioskId/identify-card')
  @Route('kioskIdentifyCard')
  @HttpCode(200)
  kioskIdentifyCard(@Ctx() ctx: HandlerContext) {
    return this.h.kioskIdentifyCard(ctx);
  }

  @Get('/kiosks/:kioskId/employees/:code')
  @Route('kioskLookupCode')
  kioskLookupCode(@Ctx() ctx: HandlerContext) {
    return this.h.kioskLookupCode(ctx);
  }

  @Post('/kiosks/:kioskId/clock/card')
  @Route('kioskClockCard')
  @HttpCode(200)
  kioskClockCard(@Ctx() ctx: HandlerContext) {
    return this.h.kioskClockCard(ctx);
  }

  @Post('/kiosks/:kioskId/clock/pin')
  @Route('kioskClockPin')
  @HttpCode(200)
  kioskClockPin(@Ctx() ctx: HandlerContext) {
    return this.h.kioskClockPin(ctx);
  }

}

@Controller()
export class PayrollController {
  constructor(@Inject(HANDLERS) private readonly h: Handlers) {}

  @Post('/payroll/periods')
  @Route('payrollCreatePeriod')
  @HttpCode(200)
  payrollCreatePeriod(@Ctx() ctx: HandlerContext) {
    return this.h.payrollCreatePeriod(ctx);
  }

  @Get('/payroll/periods/:period')
  @Route('payrollRun')
  payrollRun(@Ctx() ctx: HandlerContext) {
    return this.h.payrollRun(ctx);
  }

  @Post('/payroll/periods/:period/lock-attendance')
  @Route('payrollLockAttendance')
  @HttpCode(200)
  payrollLockAttendance(@Ctx() ctx: HandlerContext) {
    return this.h.payrollLockAttendance(ctx);
  }

  @Post('/payroll/periods/:period/calculate')
  @Route('payrollCalculate')
  @HttpCode(200)
  payrollCalculate(@Ctx() ctx: HandlerContext) {
    return this.h.payrollCalculate(ctx);
  }

  @Post('/payroll/periods/:period/submit')
  @Route('payrollSubmit')
  @HttpCode(200)
  payrollSubmit(@Ctx() ctx: HandlerContext) {
    return this.h.payrollSubmit(ctx);
  }

  @Post('/payroll/periods/:period/decision')
  @Route('payrollDecision')
  @HttpCode(200)
  payrollDecision(@Ctx() ctx: HandlerContext) {
    return this.h.payrollDecision(ctx);
  }

  @Post('/payroll/periods/:period/lock')
  @Route('payrollLock')
  @HttpCode(200)
  payrollLock(@Ctx() ctx: HandlerContext) {
    return this.h.payrollLock(ctx);
  }

  @Post('/payroll/periods/:period/bank-export')
  @Route('payrollBankExport')
  @HttpCode(200)
  async payrollBankExport(@Ctx() ctx: HandlerContext, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }) {
    const file = await this.h.payrollBankExport(ctx);
    if (!isFileResult(file)) throw new Error('Ekspor bank harus berupa file');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(file.headers ?? {})) res.setHeader(k, v);
    return file.content;
  }

  @Get('/me/payslips')
  @Route('payslipPeriods')
  payslipPeriods(@Ctx() ctx: HandlerContext) {
    return this.h.payslipPeriods(ctx);
  }

  @Get('/me/payslips/:period')
  @Route('payslip')
  payslip(@Ctx() ctx: HandlerContext) {
    return this.h.payslip(ctx);
  }

}

@Controller()
export class CoreHrController {
  constructor(@Inject(HANDLERS) private readonly h: Handlers) {}

  @Get('/locations')
  @Route('locations')
  locations(@Ctx() ctx: HandlerContext) {
    return this.h.locations(ctx);
  }

  @Post('/employees')
  @Route('employeeCreate')
  @HttpCode(200)
  employeeCreate(@Ctx() ctx: HandlerContext) {
    return this.h.employeeCreate(ctx);
  }

  @Put('/employees/:employeeId/compensation')
  @Route('employeeCompensation')
  employeeCompensation(@Ctx() ctx: HandlerContext) {
    return this.h.employeeCompensation(ctx);
  }

  @Put('/employees/:employeeId/kiosk-pin')
  @Route('employeePin')
  employeePin(@Ctx() ctx: HandlerContext) {
    return this.h.employeePin(ctx);
  }

  @Put('/employees/:employeeId/card')
  @Route('employeeCard')
  employeeCard(@Ctx() ctx: HandlerContext) {
    return this.h.employeeCard(ctx);
  }

  @Post('/employees/:employeeId/end')
  @Route('employeeEnd')
  @HttpCode(200)
  employeeEnd(@Ctx() ctx: HandlerContext) {
    return this.h.employeeEnd(ctx);
  }

}

export const CONTROLLERS = [AuthController, AttendanceController, SchedulingController, LeaveController, ApprovalsController, KioskController, PayrollController, CoreHrController];
