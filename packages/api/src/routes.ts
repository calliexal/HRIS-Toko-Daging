/**
 * Daftar endpoint REST (PRD 9.3) — satu sumber kebenaran untuk klien HTTP frontend dan controller NestJS.
 * Semua path relatif terhadap prefix `/api/v1`. `:param` diisi oleh `buildPath`.
 *
 * Autentikasi:
 *  - `user`  : header `Authorization: Bearer <JWT>` dari POST /auth/login.
 *  - `kiosk` : header `X-Kiosk-Token: <token perangkat>`; `:kioskId` wajib sama dengan kiosk pemilik token.
 *  - `public`: tanpa autentikasi.
 */
export const API_PREFIX = '/api/v1';

export const ROUTES = {
  login: { method: 'POST', path: '/auth/login', auth: 'public' },
  me: { method: 'GET', path: '/me', auth: 'user' },

  // ---------------------------------------------------------------- karyawan (aplikasi)
  today: { method: 'GET', path: '/me/today', auth: 'user' },
  geofenceCheck: { method: 'POST', path: '/attendance/geofence-check', auth: 'user' },
  clock: { method: 'POST', path: '/attendance/clock', auth: 'user' },
  sync: { method: 'POST', path: '/attendance/sync', auth: 'user' },
  mySchedule: { method: 'GET', path: '/me/schedule', auth: 'user' },
  leaveBalance: { method: 'GET', path: '/me/leave-balance', auth: 'user' },
  leavePreview: { method: 'POST', path: '/leave/preview', auth: 'user' },
  leaveSubmit: { method: 'POST', path: '/leave', auth: 'user' },
  payslipPeriods: { method: 'GET', path: '/me/payslips', auth: 'user' },
  payslip: { method: 'GET', path: '/me/payslips/:period', auth: 'user' },

  // ---------------------------------------------------------------- kiosk
  kioskInfo: { method: 'GET', path: '/kiosks/:kioskId', auth: 'kiosk' },
  kioskTime: { method: 'GET', path: '/kiosks/:kioskId/time', auth: 'kiosk' },
  kioskQr: { method: 'GET', path: '/kiosks/:kioskId/qr', auth: 'kiosk' },
  kioskRecent: { method: 'GET', path: '/kiosks/:kioskId/recent', auth: 'kiosk' },
  kioskIdentifyCard: { method: 'POST', path: '/kiosks/:kioskId/identify-card', auth: 'kiosk' },
  kioskLookupCode: { method: 'GET', path: '/kiosks/:kioskId/employees/:code', auth: 'kiosk' },
  kioskClockCard: { method: 'POST', path: '/kiosks/:kioskId/clock/card', auth: 'kiosk' },
  kioskClockPin: { method: 'POST', path: '/kiosks/:kioskId/clock/pin', auth: 'kiosk' },

  // ---------------------------------------------------------------- Kepala Toko / HR
  locations: { method: 'GET', path: '/locations', auth: 'user' },
  attendanceSummary: { method: 'GET', path: '/locations/:locationId/attendance/summary', auth: 'user' },
  attendanceRecords: { method: 'GET', path: '/locations/:locationId/attendance/records', auth: 'user' },
  attendanceAnomalies: { method: 'GET', path: '/locations/:locationId/attendance/anomalies', auth: 'user' },
  attendanceCorrection: { method: 'POST', path: '/attendance/corrections', auth: 'user' },
  /** weekStart = tanggal Senin, atau 'current' untuk minggu yang sedang disusun (default server). */
  adminSchedule: { method: 'GET', path: '/locations/:locationId/schedules/:weekStart', auth: 'user' },
  scheduleCell: { method: 'PUT', path: '/locations/:locationId/schedules/:weekStart/cells', auth: 'user' },
  schedulePublish: { method: 'POST', path: '/locations/:locationId/schedules/:weekStart/publish', auth: 'user' },
  approvals: { method: 'GET', path: '/approvals', auth: 'user' },
  approvalDecision: { method: 'POST', path: '/approvals/:id/decision', auth: 'user' },

  // ---------------------------------------------------------------- payroll (HR, Finance, Owner)
  payrollCreatePeriod: { method: 'POST', path: '/payroll/periods', auth: 'user' },
  payrollRun: { method: 'GET', path: '/payroll/periods/:period', auth: 'user' },
  payrollLockAttendance: { method: 'POST', path: '/payroll/periods/:period/lock-attendance', auth: 'user' },
  payrollCalculate: { method: 'POST', path: '/payroll/periods/:period/calculate', auth: 'user' },
  payrollSubmit: { method: 'POST', path: '/payroll/periods/:period/submit', auth: 'user' },
  payrollDecision: { method: 'POST', path: '/payroll/periods/:period/decision', auth: 'user' },
  payrollLock: { method: 'POST', path: '/payroll/periods/:period/lock', auth: 'user' },
  payrollBankExport: { method: 'POST', path: '/payroll/periods/:period/bank-export', auth: 'user' },

  // ---------------------------------------------------------------- data karyawan (HR)
  employeeCreate: { method: 'POST', path: '/employees', auth: 'user' },
  employeeCompensation: { method: 'PUT', path: '/employees/:employeeId/compensation', auth: 'user' },
  employeePin: { method: 'PUT', path: '/employees/:employeeId/kiosk-pin', auth: 'user' },
  employeeCard: { method: 'PUT', path: '/employees/:employeeId/card', auth: 'user' },
  employeeEnd: { method: 'POST', path: '/employees/:employeeId/end', auth: 'user' },
} as const satisfies Record<string, { method: 'GET' | 'POST' | 'PUT'; path: string; auth: 'public' | 'user' | 'kiosk' }>;

export type RouteName = keyof typeof ROUTES;

/** Mengisi `:param` (di-encode). Melempar error bila ada parameter yang tidak diberikan. */
export const buildPath = (route: RouteName, params: Record<string, string> = {}): string =>
  ROUTES[route].path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Parameter ${key} wajib untuk ${route}`);
    return encodeURIComponent(value);
  });
