import type {
  AdminWeekSchedule,
  Anomaly,
  ApprovalKind,
  ApprovalRequest,
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummary,
  ClockRequest,
  ClockResult,
  DynamicQr,
  GeoFix,
  GeofenceCheck,
  ISODate,
  KioskClockResult,
  KioskIdentity,
  KioskInfo,
  LeaveBalance,
  LeaveInput,
  LeavePreview,
  LoginResult,
  Me,
  Payslip,
  PayrollRun,
  RecentClock,
  ScheduleCell,
  TodayShift,
  WeekSchedule,
} from './types';

/**
 * Kontrak antara UI dan backend. Implementasi saat ini: createMockClient().
 * Implementasi HTTP mengikuti endpoint PRD 9.3 (mis. POST /attendance/clock, POST /attendance/sync).
 */
export type HrisClient = {
  /** true = data contoh; UI menampilkan <DemoBadge />. */
  readonly isMock: boolean;

  auth: {
    /** POST /auth/login. Gagal: 401 INVALID_LOGIN, 423 LOGIN_LOCKED (5x salah → 15 menit), 403 ACCOUNT_INACTIVE. */
    login(email: string, password: string): Promise<LoginResult>;
  };

  employee: {
    getMe(): Promise<Me>;
    getToday(): Promise<TodayShift>;
    checkGeofence(geo: GeoFix): Promise<GeofenceCheck>;
    /** POST /attendance/clock (online) atau POST /attendance/sync (antrean offline). */
    clock(request: ClockRequest): Promise<ClockResult>;
    getWeekSchedule(weekStart?: ISODate): Promise<WeekSchedule>;
    getLeaveBalance(): Promise<LeaveBalance>;
    previewLeave(input: Pick<LeaveInput, 'type' | 'startDate' | 'endDate'>): Promise<LeavePreview>;
    submitLeave(input: LeaveInput): Promise<{ id: string; status: 'pending' }>;
    listPayslipPeriods(): Promise<{ period: string; label: string }[]>;
    getPayslip(period: string): Promise<Payslip>;
  };

  kiosk: {
    getInfo(kioskId: string): Promise<KioskInfo>;
    getRecentClocks(kioskId: string): Promise<RecentClock[]>;
    getDynamicQr(kioskId: string): Promise<DynamicQr>;
    identifyByCard(kioskId: string, cardToken: string): Promise<KioskIdentity | null>;
    lookupEmployeeCode(code: string): Promise<KioskIdentity | null>;
    clockWithCard(kioskId: string, cardToken: string, photoRef: string): Promise<KioskClockResult>;
    clockWithPin(kioskId: string, employeeCode: string, pin: string, photoRef: string): Promise<KioskClockResult>;
  };

  admin: {
    listLocations(): Promise<{ id: string; name: string }[]>;
    getAttendanceSummary(locationId: string): Promise<AttendanceSummary>;
    getAttendanceRecords(locationId: string): Promise<AttendanceRecord[]>;
    getAnomalies(locationId: string): Promise<Anomaly[]>;
    getWeekSchedule(locationId: string, weekStart?: ISODate): Promise<AdminWeekSchedule>;
    updateScheduleCell(locationId: string, weekStart: ISODate, employeeId: string, dayIndex: number, cell: ScheduleCell): Promise<AdminWeekSchedule>;
    publishSchedule(locationId: string, weekStart: ISODate): Promise<AdminWeekSchedule>;
    listApprovals(kind?: ApprovalKind): Promise<ApprovalRequest[]>;
    decideApproval(id: string, decision: 'approve' | 'reject', note?: string): Promise<ApprovalRequest>;
    getPayrollRun(period: string): Promise<PayrollRun>;
    recalculatePayroll(period: string): Promise<PayrollRun>;
    submitPayrollForApproval(period: string): Promise<PayrollRun>;
  };
};

export type ToneName = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Satu sumber kebenaran untuk label + tone status kehadiran di seluruh aplikasi. */
export const attendanceStatusMeta = (status: AttendanceStatus, lateMinutes = 0, leaveLabel?: string): { tone: ToneName; label: string } => {
  switch (status) {
    case 'on_time':
      return { tone: 'success', label: 'Hadir' };
    case 'late':
      return { tone: 'warning', label: `Terlambat ${lateMinutes} mnt` };
    case 'absent':
      return { tone: 'danger', label: 'Mangkir' };
    case 'not_yet':
      return { tone: 'danger', label: 'Belum absen' };
    case 'leave':
      return { tone: 'info', label: leaveLabel ?? 'Cuti' };
    case 'field_duty':
      return { tone: 'info', label: 'Tugas luar' };
    case 'off':
      return { tone: 'neutral', label: 'Libur' };
    case 'later_shift':
      return { tone: 'neutral', label: 'Shift berikutnya' };
  }
};

export const clockMethodLabel: Record<NonNullable<AttendanceRecord['method']>, string> = {
  app_gps: 'Aplikasi · GPS',
  app_qr: 'Aplikasi · QR gudang',
  kiosk_card: 'Kiosk · kartu',
  kiosk_pin: 'Kiosk · PIN',
};

export const approvalKindLabel: Record<ApprovalKind, string> = {
  leave: 'Cuti & izin',
  correction: 'Koreksi absen',
  field_duty: 'Tugas luar',
  offline_review: 'Absen offline',
};
