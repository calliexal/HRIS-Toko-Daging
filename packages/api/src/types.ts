/**
 * Tipe domain front-end. Nama field mengikuti entitas di PRD bagian 9.2.
 * Tanggal = 'YYYY-MM-DD', jam = 'HH:mm' (WIB, dari server), uang = integer rupiah.
 */
export type ISODate = string;
export type ClockTime = string;
export type Rupiah = number;

export type EmploymentType = 'PKWTT' | 'PKWT' | 'HARIAN';
export type LocationType = 'outlet' | 'gudang' | 'kantor';

export type Location = {
  id: string;
  name: string;
  type: LocationType;
  radiusM: number;
};

export type Employee = {
  id: string;
  /** Format DPN-YYYY-NNNN (HR-01). */
  code: string;
  name: string;
  position: string;
  locationId: string;
  employmentType: EmploymentType;
};

export type ShiftCode = 'P' | 'S' | 'SB';

export type ShiftTemplate = {
  code: ShiftCode;
  name: string;
  start: ClockTime;
  end: ClockTime;
};

/** Isi satu sel jadwal: kode shift, Libur, atau Cuti (dari pengajuan yang disetujui). */
export type ScheduleCell = ShiftCode | 'OFF' | 'LEAVE';

export type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'not_yet' | 'leave' | 'off' | 'field_duty' | 'later_shift';

export type ClockMethod = 'app_gps' | 'app_qr' | 'kiosk_card' | 'kiosk_pin';

export type AttendanceRecord = {
  employee: Employee;
  date: ISODate;
  shift: ShiftTemplate | null;
  clockIn: ClockTime | null;
  clockOut: ClockTime | null;
  method: ClockMethod | null;
  status: AttendanceStatus;
  lateMinutes: number;
  leaveLabel?: string;
};

// ---------- Aplikasi karyawan ----------

export type Me = Employee & { location: Location; greetingName: string };

export type TodayShift = {
  date: ISODate;
  shift: ShiftTemplate | null;
  location: Location;
  clockIn: ClockTime | null;
  clockOut: ClockTime | null;
  status: AttendanceStatus;
  /** Waktu server saat data diambil; jam di layar dihitung maju dari sini, bukan dari jam HP. */
  serverTime: ClockTime;
};

export type GeoFix = { lat: number; lng: number; accuracyM: number; isMock: boolean };

export type GeofenceCheck = { inside: boolean; distanceM: number; locationName: string };

export type ClockDirection = 'in' | 'out';

export type ClockRequest = {
  clientUuid: string;
  direction: ClockDirection;
  method: ClockMethod;
  geo?: GeoFix;
  qrToken?: string;
  /** Data URL/Blob URL foto; diunggah terpisah secara async (ADR-07). */
  photoRef?: string;
  fieldDuty?: { reason: string };
  /** Waktu event dari jam monotonik perangkat (ATT-01 AC3). */
  deviceEventTime: string;
  offline: boolean;
};

export type ClockRejectReason = 'outside_geofence' | 'mock_location' | 'qr_expired' | 'qr_invalid';

export type ClockResult =
  | { outcome: 'recorded'; direction: ClockDirection; time: ClockTime; status: 'on_time' | 'late'; lateMinutes: number; locationName: string; shiftLabel: string }
  | { outcome: 'queued_offline'; direction: ClockDirection; time: ClockTime; locationName: string; shiftLabel: string }
  | { outcome: 'pending_approval'; direction: ClockDirection; time: ClockTime; locationName: string; shiftLabel: string }
  | { outcome: 'rejected'; reason: ClockRejectReason; detail: string };

export type ScheduleDay = {
  date: ISODate;
  cell: ScheduleCell;
  shift: ShiftTemplate | null;
  locationName: string;
  isToday: boolean;
  /** Status kehadiran untuk hari yang sudah lewat. */
  attendance?: { status: AttendanceStatus; lateMinutes: number };
};

export type WeekSchedule = {
  weekStart: ISODate;
  days: ScheduleDay[];
  /** Kapan jadwal minggu berikutnya paling lambat terbit (H-3). */
  nextWeekPublishBy: ISODate;
};

export type LeaveType = 'annual' | 'permit' | 'sick';

export type LeaveBalance = { annualRemaining: number; annualEntitlement: number };

export type LeaveInput = {
  type: LeaveType;
  startDate: ISODate;
  endDate: ISODate;
  reason: string;
  attachmentName?: string;
};

export type LeavePreview = { workingDays: number; balanceAfter: number | null; attachmentRequired: boolean; approverName: string };

export type MoneyLine = { label: string; amount: Rupiah };

export type Payslip = {
  period: string;
  periodLabel: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  payDate: ISODate;
  earnings: MoneyLine[];
  deductions: MoneyLine[];
  takeHome: Rupiah;
  bankAccountMasked: string;
  pdfUrl: string;
};

// ---------- Kiosk ----------

export type KioskInfo = { id: string; name: string; location: Location; mode: 'card' | 'dynamic_qr' };

export type RecentClock = { name: string; direction: ClockDirection; time: ClockTime };

export type DynamicQr = { token: string; expiresAt: number; periodSeconds: number };

export type KioskIdentity = { employeeId: string; name: string; position: string };

export type KioskClockResult =
  | { outcome: 'recorded'; name: string; direction: ClockDirection; time: ClockTime; status: 'on_time' | 'late'; lateMinutes: number }
  | { outcome: 'rejected'; reason: 'unknown_card' | 'wrong_pin' | 'locked'; attemptsLeft?: number; lockedUntil?: ClockTime };

// ---------- Web admin ----------

export type AnomalyKind = 'missing_clock_out' | 'outside_geofence' | 'offline_delayed';

export type Anomaly = { id: string; kind: AnomalyKind; employee: Employee; date: ISODate; detail: string };

export type AttendanceSummary = {
  date: ISODate;
  updatedAt: ClockTime;
  scheduled: number;
  onTime: number;
  late: number;
  notYet: number;
  onLeave: number;
};

export type ScheduleRow = { employee: Employee; cells: ScheduleCell[]; hoursPerWeek: number };

export type CoverageCount = { shift: ShiftCode; required: number; filled: number[] };

export type AdminWeekSchedule = {
  location: Location;
  weekStart: ISODate;
  days: ISODate[];
  status: 'draft' | 'published';
  publishBy: ISODate;
  rows: ScheduleRow[];
  coverage: CoverageCount[];
  warnings: string[];
  templates: ShiftTemplate[];
};

export type ApprovalKind = 'leave' | 'correction' | 'field_duty' | 'offline_review';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type ApprovalRequest = {
  id: string;
  kind: ApprovalKind;
  employee: Employee;
  submittedAgo: string;
  summary: string;
  status: ApprovalStatus;
  /** Lewat 24/48 jam dan sudah dieskalasi ke atasan berikutnya. */
  escalated: boolean;
  details: { label: string; value: string }[];
  reason?: string;
  scheduleImpact?: string;
};

export type PayrollStepKey = 'lock_attendance' | 'calculate' | 'hr_review' | 'owner_approval' | 'lock_period' | 'export_bank';
export type PayrollStep = { key: PayrollStepKey; label: string; status: 'done' | 'active' | 'todo'; dateLabel: string };

export type PayrollIssueKind = 'missing_ptkp' | 'missing_wage' | 'missing_ytd' | 'manual_tax' | 'casual_21_days' | 'non_mandiri_account';

export type PayrollRow = {
  employee: Employee;
  locationName: string;
  daysPresent: number;
  overtimeHours: number;
  gross: Rupiah;
  takeHome: Rupiah;
  issue?: { kind: PayrollIssueKind; label: string; actionLabel: string };
};

export type PayrollRun = {
  period: string;
  periodLabel: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  payDate: ISODate;
  steps: PayrollStep[];
  employeesTotal: number;
  employeesReady: number;
  totals: { gross: Rupiah; takeHome: Rupiah };
  counts: { all: number; needsReview: number; casual: number; withOvertime: number };
  rows: PayrollRow[];
};

// ---------------------------------------------------------------- autentikasi
export type UserRole = 'employee' | 'store_manager' | 'hr' | 'finance' | 'owner' | 'super_admin';

/** Identitas yang dikembalikan saat login; disimpan bersama token untuk header aplikasi. */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  employeeId: string | null;
  /** Lingkup lokasi Kepala Toko; kosong untuk peran pusat. */
  locationIds: string[];
};

export type LoginResult = { token: string; expiresInSeconds: number; user: SessionUser };
