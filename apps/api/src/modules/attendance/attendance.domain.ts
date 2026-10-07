import type { AttendanceStatus, ClockMethod, ClockRejectReason } from '@dagingpeople/contracts';
import { minutesOfDay } from '../../common/time';

/** Absen offline yang terkirim lebih dari 12 jam setelah kejadian masuk antrean review (Tech Lead #7). */
export const OFFLINE_REVIEW_AFTER_MS = 12 * 60 * 60 * 1000;

export type ClockFacts = {
  method: ClockMethod;
  isMockLocation: boolean;
  /** Hanya untuk app_gps. */
  geofence?: { inside: boolean; distanceM: number };
  /** Hanya untuk app_qr. */
  qr?: 'valid' | 'expired' | 'invalid';
  fieldDutyReason?: string;
  offline: boolean;
  eventTime: Date;
  receivedAt: Date;
};

export type ClockDecision =
  | { status: 'recorded' }
  | { status: 'needs_review'; reviewKind: 'field_duty' | 'offline_delayed' }
  | { status: 'rejected'; reason: ClockRejectReason };

/**
 * Aturan penerimaan absen (ATT-01, ATT-04). Urutan penting:
 * lokasi palsu selalu ditolak → QR harus sah → di luar radius hanya lewat Tugas Luar → offline lama direview.
 */
export const decideClock = (f: ClockFacts): ClockDecision => {
  if (f.isMockLocation) return { status: 'rejected', reason: 'mock_location' };
  if (f.method === 'app_qr') {
    if (f.qr === 'invalid' || f.qr === undefined) return { status: 'rejected', reason: 'qr_invalid' };
    if (f.qr === 'expired') return { status: 'rejected', reason: 'qr_expired' };
  }
  if (f.method === 'app_gps' && f.geofence && !f.geofence.inside) {
    return f.fieldDutyReason?.trim() ? { status: 'needs_review', reviewKind: 'field_duty' } : { status: 'rejected', reason: 'outside_geofence' };
  }
  if (f.offline && f.receivedAt.getTime() - f.eventTime.getTime() > OFFLINE_REVIEW_AFTER_MS) {
    return { status: 'needs_review', reviewKind: 'offline_delayed' };
  }
  return { status: 'recorded' };
};

/** Waktu kejadian: online = jam server; offline = waktu perangkat (monotonik), tidak boleh di masa depan. */
export const resolveEventTime = (offline: boolean, deviceEventTime: string | undefined, receivedAt: Date): Date => {
  if (!offline || !deviceEventTime) return receivedAt;
  const t = new Date(deviceEventTime);
  if (Number.isNaN(t.getTime())) return receivedAt;
  return t.getTime() > receivedAt.getTime() ? receivedAt : t;
};

export const lateMinutes = (shiftStart: string, clockIn: string): number => Math.max(0, minutesOfDay(clockIn) - minutesOfDay(shiftStart));

/**
 * Status harian satu karyawan untuk dashboard Kepala Toko (ATT-03 AC1).
 * `nowClock` = jam lokal sekarang bila tanggalnya hari ini, null untuk hari yang sudah lewat.
 */
export const dailyStatus = (input: {
  cell: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  clockIn: string | null;
  nowClock: string | null;
}): { status: AttendanceStatus; lateMinutes: number } => {
  if (input.cell === 'LEAVE') return { status: 'leave', lateMinutes: 0 };
  if (input.cell === 'OFF' || !input.shiftStart) return { status: input.clockIn ? 'on_time' : 'off', lateMinutes: 0 };
  if (input.clockIn) {
    const late = lateMinutes(input.shiftStart, input.clockIn);
    return { status: late > 0 ? 'late' : 'on_time', lateMinutes: late };
  }
  if (input.nowClock === null) return { status: 'absent', lateMinutes: 0 };
  // Shift belum dimulai (lebih dari 30 menit lagi) → bukan "belum absen", melainkan shift berikutnya.
  if (minutesOfDay(input.nowClock) < minutesOfDay(input.shiftStart) - 30) return { status: 'later_shift', lateMinutes: 0 };
  if (input.shiftEnd && minutesOfDay(input.nowClock) > minutesOfDay(input.shiftEnd)) return { status: 'absent', lateMinutes: 0 };
  return { status: 'not_yet', lateMinutes: 0 };
};

export const rejectMessage: Record<ClockRejectReason, (ctx: { distanceM?: number; locationName?: string }) => string> = {
  mock_location: () => 'Aplikasi lokasi palsu terdeteksi di HP Anda. Matikan aplikasi tersebut lalu coba lagi, atau absen di kiosk.',
  outside_geofence: ({ distanceM, locationName }) =>
    `Lokasi Anda ${distanceM ?? '?'} m dari ${locationName ?? 'lokasi kerja'}. Dekati lokasi atau pilih Tugas Luar.`,
  qr_expired: () => 'QR kedaluwarsa, silakan pindai ulang.',
  qr_invalid: () => 'QR ini bukan QR absensi DagingPeople. Pindai QR di layar kiosk gudang.',
};
