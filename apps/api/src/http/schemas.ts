import { z } from 'zod';

/**
 * Validasi body request di batas HTTP. Service tetap memvalidasi aturan bisnis;
 * schema ini hanya memastikan bentuk & tipe data (anti input aneh sebelum menyentuh domain).
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Format periode YYYY-MM');
const rupiah = z.number().int().nonnegative();
const decision = z.enum(['approve', 'reject']);

export const loginBody = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const geoFix = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().nonnegative(), isMock: z.boolean() });

export const clockBody = z.object({
  clientUuid: z.string().uuid(),
  direction: z.enum(['in', 'out']),
  method: z.enum(['app_gps', 'app_qr']),
  geo: geoFix.optional(),
  qrToken: z.string().max(200).optional(),
  photoRef: z.string().max(500).optional(),
  fieldDuty: z.object({ reason: z.string().trim().min(3).max(300) }).optional(),
  deviceEventTime: z.string().datetime({ offset: true }),
  offline: z.boolean(),
});

export const syncBody = z.object({ events: z.array(clockBody).min(1).max(200) });

export const leavePreviewBody = z.object({ type: z.enum(['annual', 'permit', 'sick']), startDate: isoDate, endDate: isoDate });
export const leaveSubmitBody = leavePreviewBody.extend({ reason: z.string().trim().min(1).max(500), attachmentName: z.string().max(300).optional() });

export const correctionBody = z.object({ employeeId: z.string().min(1), workDate: isoDate, clockIn: hhmm.optional(), clockOut: hhmm.optional(), reason: z.string().trim().min(1).max(500) });

export const scheduleCellBody = z.object({ employeeId: z.string().min(1), dayIndex: z.number().int().min(0).max(6), cell: z.enum(['P', 'S', 'SB', 'OFF', 'LEAVE']) });
export const schedulePublishBody = z.object({ acknowledgedWarnings: z.number().int().nonnegative().default(0) });

export const decisionBody = z.object({ decision, note: z.string().trim().max(500).optional() });

export const kioskCardBody = z.object({ cardToken: z.string().min(1).max(200), photoRef: z.string().max(500).default('') });
export const kioskPinBody = z.object({ employeeCode: z.string().regex(/^\d{1,4}$/), pin: z.string().regex(/^\d{6}$/), photoRef: z.string().max(500).default('') });

export const createPeriodBody = z.object({ period });
export const lockPeriodBody = z.object({ confirmation: z.string().max(100) });

export const createEmployeeBody = z.object({
  fullName: z.string().trim().min(1).max(120),
  nik: z.string().max(30),
  locationId: z.string().min(1),
  position: z.string().trim().min(1).max(80),
  employmentType: z.enum(['PKWTT', 'PKWT', 'HARIAN']),
  workPattern: z.enum(['6_DAY', '5_DAY']).optional(),
  ptkpStatus: z.enum(['TK/0', 'TK/1', 'TK/2', 'TK/3', 'K/0', 'K/1', 'K/2', 'K/3']).nullable().optional(),
  joinDate: isoDate,
  contractEndDate: isoDate.nullable().optional(),
  bank: z.object({ name: z.string().trim().min(2).max(60), accountNumber: z.string().max(30) }).nullable().optional(),
});

export const compensationBody = z.object({
  effectiveFrom: isoDate,
  basicSalary: rupiah.nullable().optional(),
  dailyWage: rupiah.nullable().optional(),
  fixedAllowances: z.array(z.object({ code: z.string().regex(/^[A-Z0-9_]{2,30}$/), label: z.string().trim().min(1).max(60), amount: rupiah })).max(10).optional(),
  bpjs: z.object({ kesehatan: z.boolean(), ketenagakerjaan: z.boolean(), pensiun: z.boolean() }),
});

export const pinBody = z.object({ pin: z.string().max(10) });
export const cardBody = z.object({ cardToken: z.string().max(200) });
export const endEmploymentBody = z.object({ endDate: isoDate });

export const weekQuery = z.object({ weekStart: isoDate.optional() });
export const approvalsQuery = z.object({ kind: z.enum(['leave', 'correction', 'field_duty', 'offline_review']).optional() });
