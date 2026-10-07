import type { ApprovalKind, ApprovalRequest } from '@dagingpeople/contracts';
import { formatClock, formatDateShort } from '@dagingpeople/format';
import { requireRole, type Actor } from '../../common/actor';
import type { Clock } from '../../common/clock';
import type { Db } from '../../common/db';
import { notFound, validation } from '../../common/errors';
import type { AttendanceService } from '../attendance/attendance.service';
import { toEmployee } from '../attendance/attendance.service';
import type { LeaveService } from '../leave/leave.service';

type InboxRow = {
  kind: ApprovalKind;
  id: string;
  employee_id: string;
  location_id: string;
  submitted_ms: number;
  escalated: boolean;
  code: string;
  full_name: string;
  position: string;
  employment_type: 'PKWTT' | 'PKWT' | 'HARIAN';
};

const LEAVE_LABEL: Record<string, string> = { annual: 'Cuti tahunan', permit: 'Izin', sick: 'Sakit' };
const KINDS: readonly ApprovalKind[] = ['leave', 'correction', 'field_duty', 'offline_review'];

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const parts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return { wd: DAYS[d.getUTCDay()]!, day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()]! };
};
/** Ringkas untuk baris inbox, sama dengan mock: 'Sel 6 Okt', 'Kam 15–Jum 16 Okt', 'Sen 28 Sep–Sel 2 Okt'. */
export const compactDate = (iso: string) => {
  const p = parts(iso);
  return `${p.wd} ${p.day} ${p.month}`;
};
export const compactRange = (start: string, end: string) => {
  if (start === end) return compactDate(start);
  const a = parts(start);
  const b = parts(end);
  return a.month === b.month && start.slice(0, 4) === end.slice(0, 4) ? `${a.wd} ${a.day}–${b.wd} ${b.day} ${b.month}` : `${compactDate(start)}–${compactDate(end)}`;
};

const ago = (ms: number) => {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Baru saja';
  if (hours < 24) return `${hours} jam lalu`;
  return `${Math.floor(hours / 24)} hari lalu`;
};

/** Inbox persetujuan gabungan (W3): cuti/izin, koreksi absen, tugas luar, absen offline lama. */
export class ApprovalsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly leave: LeaveService,
    private readonly attendance: AttendanceService,
  ) {}

  async list(actor: Actor, kind?: ApprovalKind): Promise<ApprovalRequest[]> {
    requireRole(actor, 'store_manager', 'hr');
    if (kind && !KINDS.includes(kind)) throw validation('INVALID_KIND', 'Jenis persetujuan tidak dikenal.');
    const rows = await this.db.query<InboxRow>(
      `SELECT i.kind, i.id, i.employee_id, i.location_id, (extract(epoch FROM i.submitted_at) * 1000)::bigint AS submitted_ms, i.escalated,
              e.code, e.full_name, e.position, e.employment_type
         FROM approval_inbox_v i JOIN employee e ON e.id = i.employee_id
        WHERE ($1::text IS NULL OR i.kind = $1)
          AND ($2::text[] = '{}' OR i.location_id = ANY($2::text[]))
          -- Koreksi absen hanya diputuskan HR (ATT-03 AC2).
          AND (i.kind <> 'correction' OR $3 = 'hr')
          AND i.employee_id IS DISTINCT FROM $4
        ORDER BY i.escalated DESC, i.submitted_at`,
      [kind ?? null, actor.role === 'store_manager' ? [...actor.locationIds] : [], actor.role, actor.employeeId],
    );
    const now = this.clock.now().getTime();
    const result: ApprovalRequest[] = [];
    for (const r of rows) result.push({ ...(await this.detail(r)), submittedAgo: ago(now - r.submitted_ms), escalated: r.escalated });
    return result;
  }

  private async detail(r: InboxRow): Promise<Omit<ApprovalRequest, 'submittedAgo' | 'escalated'>> {
    const base = { id: r.id, kind: r.kind, status: 'pending' as const, employee: toEmployee({ ...r, location_id: r.location_id }) };
    if (r.kind === 'leave') {
      const [lr] = await this.db.query<{ type: string; start_date: string; end_date: string; working_days: number; reason: string; remaining: number | null; impact: string | null }>(
        `SELECT lr.type, lr.start_date, lr.end_date, lr.working_days, lr.reason, b.remaining,
                (SELECT string_agg(format('Shift %s %s akan terisi %s dari %s orang', st.name, to_char(se.work_date, 'DD/MM'), x.filled - 1, st.min_staff), '; ')
                   FROM schedule_entry se
                   JOIN shift_template st ON st.location_id = se.location_id AND st.code = se.cell
                   CROSS JOIN LATERAL (SELECT count(*) AS filled FROM schedule_entry o WHERE o.location_id = se.location_id AND o.work_date = se.work_date AND o.cell = se.cell) x
                  WHERE se.employee_id = lr.employee_id AND se.work_date BETWEEN lr.start_date AND lr.end_date AND x.filled - 1 < st.min_staff) AS impact
           FROM leave_request lr
           LEFT JOIN leave_balance_v b ON b.employee_id = lr.employee_id AND b.year = extract(year FROM lr.start_date)::int
          WHERE lr.id = $1::uuid`,
        [r.id],
      );
      const range = lr!.start_date === lr!.end_date ? formatDateShort(lr!.start_date) : `${formatDateShort(lr!.start_date)} – ${formatDateShort(lr!.end_date)}`;
      const details = [
        { label: 'Jenis', value: LEAVE_LABEL[lr!.type] ?? lr!.type },
        { label: 'Tanggal', value: range },
        { label: 'Durasi', value: `${lr!.working_days} hari kerja` },
      ];
      // Saldo di view sudah dikurangi pengajuan ini (ditahan); tampilkan sebelum → sesudah.
      if (lr!.type === 'annual' && lr!.remaining !== null) details.push({ label: 'Saldo', value: `${lr!.remaining + lr!.working_days} → ${lr!.remaining} hari` });
      return { ...base, summary: `${LEAVE_LABEL[lr!.type]} · ${compactRange(lr!.start_date, lr!.end_date)}`, details, reason: lr!.reason, scheduleImpact: lr!.impact ? `${lr!.impact}.` : undefined };
    }
    if (r.kind === 'correction') {
      const [c] = await this.db.query<{ work_date: string; proposed_in: string | null; proposed_out: string | null; recorded_in: string | null; recorded_out: string | null; reason: string; requested_by: string }>(
        `SELECT c.work_date, to_char(c.clock_in AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS proposed_in, to_char(c.clock_out AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS proposed_out,
                to_char(d.clock_in AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS recorded_in, to_char(d.clock_out AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS recorded_out,
                c.reason, coalesce(e.full_name, u.email, c.requested_by) AS requested_by
           FROM attendance_correction c
           LEFT JOIN attendance_day_v d ON d.employee_id = c.employee_id AND d.work_date = c.work_date
           LEFT JOIN app_user u ON u.id = c.requested_by LEFT JOIN employee e ON e.id = u.employee_id
          WHERE c.id = $1::uuid`,
        [r.id],
      );
      const t = (v: string | null) => (v ? formatClock(v) : '—');
      return {
        ...base,
        summary: `Koreksi absen${c!.proposed_in && !c!.proposed_out ? ' masuk' : !c!.proposed_in && c!.proposed_out ? ' pulang' : ''} · ${compactDate(c!.work_date)}`,
        details: [
          { label: 'Tanggal', value: formatDateShort(c!.work_date) },
          { label: 'Tercatat', value: `Masuk ${t(c!.recorded_in)} · Pulang ${t(c!.recorded_out)}` },
          { label: 'Usulan', value: [c!.proposed_in && `Masuk ${t(c!.proposed_in)}`, c!.proposed_out && `Pulang ${t(c!.proposed_out)}`].filter(Boolean).join(' · ') },
          { label: 'Diajukan oleh', value: c!.requested_by },
        ],
        reason: c!.reason,
      };
    }
    const [ev] = await this.db.query<{ work_date: string; event_clock: string; received: string; distance_m: number | null; field_duty_reason: string | null; location_name: string | null; delay_hours: number }>(
      `SELECT ev.work_date, to_char(ev.event_time AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS event_clock,
              to_char(ev.received_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS received, ev.distance_m, ev.field_duty_reason, l.name AS location_name,
              floor(extract(epoch FROM ev.received_at - ev.event_time) / 3600)::int AS delay_hours
         FROM attendance_event ev LEFT JOIN location l ON l.id = ev.location_id WHERE ev.id = $1::uuid`,
      [r.id],
    );
    if (r.kind === 'field_duty') {
      return {
        ...base,
        summary: `Absen di luar radius (${ev!.distance_m ?? '?'} m)`,
        details: [
          { label: 'Waktu', value: `${formatDateShort(ev!.work_date)} · ${formatClock(ev!.event_clock)}` },
          { label: 'Jarak', value: `${ev!.distance_m ?? '?'} m dari ${ev!.location_name ?? 'lokasi kerja'}` },
        ],
        reason: ev!.field_duty_reason ?? undefined,
      };
    }
    const [receivedDate, receivedClock] = ev!.received.split(' ');
    return {
      ...base,
      summary: `Absen offline ${ev!.delay_hours} jam · ${compactDate(ev!.work_date)}`,
      details: [
        { label: 'Waktu di perangkat', value: `${formatDateShort(ev!.work_date)} · ${formatClock(ev!.event_clock)}` },
        { label: 'Terkirim', value: `${formatDateShort(receivedDate!)} · ${formatClock(receivedClock!)}` },
        { label: 'Lokasi', value: ev!.location_name ?? '—' },
      ],
    };
  }

  /**
   * Endpoint POST /approvals/:id/decision: klien cukup mengirim id (kontrak HrisClient.decideApproval).
   * Jenis dicari dari inbox dengan filter akses yang sama seperti list(), lalu dikembalikan snapshot terbaru.
   */
  async decideById(actor: Actor, id: string, decision: 'approve' | 'reject', note?: string): Promise<ApprovalRequest> {
    const item = (await this.list(actor)).find((i) => i.id === id);
    if (!item) throw notFound('APPROVAL_NOT_FOUND', 'Pengajuan tidak ditemukan atau sudah diputuskan.');
    const result = await this.decide(actor, item.kind, id, decision, note);
    return { ...item, status: result.status };
  }

  async decide(actor: Actor, kind: ApprovalKind, id: string, decision: 'approve' | 'reject', note?: string) {
    switch (kind) {
      case 'leave':
        return this.leave.decide(actor, id, decision, note);
      case 'correction':
        await this.attendance.decideCorrection(actor, id, decision, note);
        return { id, status: decision === 'approve' ? ('approved' as const) : ('rejected' as const) };
      case 'field_duty':
      case 'offline_review':
        return this.attendance.decideReview(actor, id, decision, note);
      default:
        throw validation('INVALID_KIND', 'Jenis persetujuan tidak dikenal.');
    }
  }
}
