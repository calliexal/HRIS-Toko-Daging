import type { HrisClient } from './client';
import { ApiError } from './http-client';
import { addDays, addSecondsToClock, formatClock, minutesBetween } from './format';
import type {
  AdminWeekSchedule,
  Anomaly,
  ApprovalRequest,
  AttendanceRecord,
  ClockResult,
  Employee,
  ISODate,
  KioskClockResult,
  KioskIdentity,
  Location,
  LoginResult,
  SessionUser,
  Payslip,
  PayrollRun,
  ScheduleCell,
  ScheduleDay,
  ShiftCode,
  ShiftTemplate,
} from './types';

/**
 * Klien MOCK: data contoh di memori, meniru perilaku backend sesuai AC di PRD v1.1.
 * Hari "ini" dikunci ke Rab, 7 Okt 2026 pukul 05.52 WIB agar demo konsisten.
 * Skenario lapangan (di luar radius, lokasi palsu, offline) bisa diubah lewat setScenario().
 */

export type MockScenario = {
  /** Posisi karyawan terhadap geofence outlet. */
  geofence: 'inside' | 'outside';
  /** Simulasi aplikasi mendeteksi mock location (ATT-01 AC4). */
  mockLocation: boolean;
  /** Simulasi perangkat offline (ATT-01 AC3). */
  offline: boolean;
};

export type MockOptions = { latencyMs?: number };

const TODAY: ISODate = '2026-10-07';
const SERVER_TIME = '05:52';

const LOCATIONS: Record<string, Location> = {
  kemang: { id: 'kemang', name: 'Outlet Kemang', type: 'outlet', radiusM: 100 },
  gudang: { id: 'gudang', name: 'Gudang & Cold Storage', type: 'gudang', radiusM: 150 },
  kantor: { id: 'kantor', name: 'Kantor Pusat', type: 'kantor', radiusM: 80 },
};

const TEMPLATES: Record<ShiftCode, ShiftTemplate> = {
  P: { code: 'P', name: 'Pagi', start: '06:00', end: '14:00' },
  S: { code: 'S', name: 'Siang', start: '13:00', end: '21:00' },
  SB: { code: 'SB', name: 'Subuh', start: '03:00', end: '11:00' },
};

const emp = (id: string, code: string, name: string, position: string, locationId: string, employmentType: Employee['employmentType'] = 'PKWTT'): Employee => ({
  id,
  code,
  name,
  position,
  locationId,
  employmentType,
});

const EMPLOYEES = {
  joko: emp('joko', 'DPN-2024-0042', 'Joko Prasetyo', 'Butcher', 'kemang'),
  sari: emp('sari', 'DPN-2023-0017', 'Sari Wulandari', 'Kasir', 'kemang'),
  rina: emp('rina', 'DPN-2025-0063', 'Rina Kusuma', 'Pramuniaga', 'kemang'),
  budi: emp('budi', 'DPN-2022-0008', 'Budi Santoso', 'Butcher', 'kemang'),
  dewi: emp('dewi', 'DPN-2024-0051', 'Dewi Lestari', 'Kasir', 'kemang'),
  andi: emp('andi', 'DPN-2025-0071', 'Andi Wijaya', 'Butcher', 'kemang', 'PKWT'),
  fajar: emp('fajar', 'DPN-2025-0080', 'Fajar Nugroho', 'Butcher', 'kemang', 'PKWT'),
  tono: emp('tono', 'DPN-2026-0102', 'Tono Saputra', 'Pramuniaga', 'kemang', 'HARIAN'),
  yusuf: emp('yusuf', 'DPN-2026-0110', 'Yusuf Hakim', 'Butcher', 'kemang', 'HARIAN'),
  lina: emp('lina', 'DPN-2023-0029', 'Lina Marlina', 'Kasir', 'kemang'),
  agus: emp('agus', 'DPN-2025-0090', 'Agus Setiawan', 'Staf Gudang', 'gudang', 'PKWT'),
  wahyu: emp('wahyu', 'DPN-2026-0121', 'Wahyu Hidayat', 'Staf Gudang', 'gudang', 'HARIAN'),
  dedi: emp('dedi', 'DPN-2024-0055', 'Dedi Kurniawan', 'Juru Sembelih', 'gudang'),
} satisfies Record<string, Employee>;

type EmployeeKey = keyof typeof EMPLOYEES;

/** Akun demo, sama dengan seed backend (apps/api/src/seed). Sandi semua akun: Demo#2026. */
export const DEMO_PASSWORD = 'Demo#2026';
const DEMO_USERS: readonly SessionUser[] = [
  { id: 'u-hr', name: 'Hr', email: 'hr@dagingprima.co.id', role: 'hr', employeeId: null, locationIds: [] },
  { id: 'u-owner', name: 'Owner', email: 'owner@dagingprima.co.id', role: 'owner', employeeId: null, locationIds: [] },
  { id: 'u-finance', name: 'Finance', email: 'finance@dagingprima.co.id', role: 'finance', employeeId: null, locationIds: [] },
  { id: 'u-hendra', name: 'Hendra Gunawan', email: 'hendra@dagingprima.co.id', role: 'store_manager', employeeId: 'hendra', locationIds: ['kemang'] },
  { id: 'u-joko', name: 'Joko Prasetyo', email: 'joko@dagingprima.co.id', role: 'employee', employeeId: 'joko', locationIds: [] },
  { id: 'u-sari', name: 'Sari Wulandari', email: 'sari@dagingprima.co.id', role: 'employee', employeeId: 'sari', locationIds: [] },
  { id: 'u-agus', name: 'Agus Setiawan', email: 'agus@dagingprima.co.id', role: 'employee', employeeId: 'agus', locationIds: [] },
];
export const DEMO_ACCOUNTS = DEMO_USERS.map((u) => ({ email: u.email, name: u.name, role: u.role }));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`;

/** Hari kerja 6 hari/minggu: Minggu tidak dihitung (keputusan client #1). */
const countWorkingDays = (start: ISODate, end: ISODate) => {
  let count = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) count += 1;
  }
  return count;
};

const shiftLabel = (t: ShiftTemplate | null) => (t ? `${t.name} · ${formatClock(t.start)}–${formatClock(t.end)}` : 'Tanpa shift');

export const createMockClient = (options: MockOptions = {}): HrisClient & { setScenario(s: Partial<MockScenario>): void; getScenario(): MockScenario } => {
  const latency = options.latencyMs ?? 250;
  const delay = () => wait(latency);
  const startedAt = Date.now();

  let scenario: MockScenario = { geofence: 'inside', mockLocation: false, offline: false };

  /** Jam server mock: 05.52 saat klien dibuat, lalu berjalan maju sesuai waktu nyata. */
  const serverNow = () => addSecondsToClock(`${SERVER_TIME}:00`, Math.floor((Date.now() - startedAt) / 1000));

  // ---------- State karyawan (Joko) ----------
  const me = EMPLOYEES.joko;
  let myClockIn: string | null = null;
  let myClockOut: string | null = null;
  let leaveBalance = 9;

  // ---------- State kiosk ----------
  const pinAttempts = new Map<string, { failures: number; lockedUntil?: string }>();
  const PINS: Record<string, string> = { '0042': '123456', '0017': '111111', '0063': '222222' };
  const CARDS: Record<string, EmployeeKey> = { 'CARD-0042': 'joko', 'CARD-0017': 'sari', 'CARD-0063': 'rina', 'CARD-0090': 'agus' };
  const recentByKiosk: Record<string, { name: string; direction: 'in' | 'out'; time: string }[]> = {
    'kiosk-kemang-1': [
      { name: 'Rina', direction: 'in', time: '05:51' },
      { name: 'Budi', direction: 'in', time: '05:50' },
      { name: 'Sari', direction: 'in', time: '05:48' },
    ],
    'kiosk-gudang-1': [
      { name: 'Wahyu', direction: 'in', time: '02:59' },
      { name: 'Dedi', direction: 'in', time: '02:58' },
      { name: 'Agus', direction: 'in', time: '02:56' },
    ],
  };

  const currentQrToken = (offsetWindows = 0) => `DPQR-gudang-${Math.floor(Date.now() / 30000) - offsetWindows}`;

  // ---------- State admin ----------
  const todayRecords: AttendanceRecord[] = [
    { employee: EMPLOYEES.joko, date: TODAY, shift: TEMPLATES.P, clockIn: null, clockOut: null, method: null, status: 'not_yet', lateMinutes: 0 },
    { employee: EMPLOYEES.sari, date: TODAY, shift: TEMPLATES.P, clockIn: '05:48', clockOut: null, method: 'kiosk_card', status: 'on_time', lateMinutes: 0 },
    { employee: EMPLOYEES.fajar, date: TODAY, shift: TEMPLATES.P, clockIn: '05:55', clockOut: null, method: 'app_gps', status: 'on_time', lateMinutes: 0 },
    { employee: EMPLOYEES.tono, date: TODAY, shift: TEMPLATES.P, clockIn: '05:50', clockOut: null, method: 'kiosk_pin', status: 'on_time', lateMinutes: 0 },
    { employee: EMPLOYEES.rina, date: TODAY, shift: TEMPLATES.P, clockIn: '06:12', clockOut: null, method: 'app_gps', status: 'late', lateMinutes: 12 },
    { employee: EMPLOYEES.yusuf, date: TODAY, shift: TEMPLATES.P, clockIn: '06:05', clockOut: null, method: 'kiosk_card', status: 'late', lateMinutes: 5 },
    { employee: EMPLOYEES.budi, date: TODAY, shift: TEMPLATES.P, clockIn: null, clockOut: null, method: null, status: 'not_yet', lateMinutes: 0 },
    { employee: EMPLOYEES.dewi, date: TODAY, shift: null, clockIn: null, clockOut: null, method: null, status: 'leave', lateMinutes: 0, leaveLabel: 'Cuti tahunan' },
    { employee: EMPLOYEES.andi, date: TODAY, shift: TEMPLATES.S, clockIn: null, clockOut: null, method: null, status: 'later_shift', lateMinutes: 0 },
    { employee: EMPLOYEES.lina, date: TODAY, shift: TEMPLATES.S, clockIn: null, clockOut: null, method: null, status: 'later_shift', lateMinutes: 0 },
  ];

  const anomalies: Anomaly[] = [
    { id: 'an-1', kind: 'missing_clock_out', employee: EMPLOYEES.budi, date: '2026-10-06', detail: 'Masuk 05.55, absen pulang tidak tercatat' },
    { id: 'an-2', kind: 'outside_geofence', employee: EMPLOYEES.rina, date: TODAY, detail: '230 m dari Outlet Kemang · alasan: antar pesanan' },
    { id: 'an-3', kind: 'offline_delayed', employee: EMPLOYEES.andi, date: '2026-10-05', detail: 'Absen offline, terkirim 13 jam kemudian' },
  ];

  const ADMIN_WEEK = '2026-10-12';
  const scheduleRows: { key: EmployeeKey; cells: ScheduleCell[] }[] = [
    { key: 'joko', cells: ['P', 'P', 'P', 'S', 'S', 'OFF', 'P'] },
    { key: 'budi', cells: ['S', 'S', 'S', 'OFF', 'P', 'P', 'P'] },
    { key: 'sari', cells: ['P', 'P', 'OFF', 'P', 'P', 'P', 'S'] },
    { key: 'rina', cells: ['S', 'OFF', 'P', 'P', 'S', 'S', 'S'] },
    { key: 'andi', cells: ['P', 'S', 'S', 'S', 'S', 'LEAVE', 'OFF'] },
    { key: 'dewi', cells: ['OFF', 'P', 'P', 'P', 'P', 'P', 'S'] },
  ];
  let scheduleStatus: AdminWeekSchedule['status'] = 'draft';
  const REQUIRED: Record<'P' | 'S', number> = { P: 3, S: 2 };

  const buildAdminSchedule = (): AdminWeekSchedule => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(ADMIN_WEEK, i));
    const rows = scheduleRows.map((r) => ({
      employee: EMPLOYEES[r.key],
      cells: [...r.cells],
      // 8 jam per shift termasuk istirahat 1 jam = 7 jam kerja efektif (asumsi PRD v1.1).
      hoursPerWeek: r.cells.filter((c) => c === 'P' || c === 'S' || c === 'SB').length * 7,
    }));
    const coverage = (['P', 'S'] as const).map((shift) => ({
      shift,
      required: REQUIRED[shift],
      filled: days.map((_, i) => rows.filter((r) => r.cells[i] === shift).length),
    }));
    const warnings: string[] = [];
    coverage.forEach((c) =>
      c.filled.forEach((n, i) => {
        if (n < c.required) {
          const { weekday, day } = { weekday: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'][i], day: Number(days[i]?.slice(8)) };
          warnings.push(`${weekday} ${day} Okt · Shift ${TEMPLATES[c.shift].name} terisi ${n} dari ${c.required} orang`);
        }
      }),
    );
    rows.forEach((r) => {
      if (r.hoursPerWeek > 42) warnings.push(`${r.employee.name} dijadwalkan ${r.hoursPerWeek} jam (lebih dari 6 shift/minggu)`);
    });
    return {
      location: LOCATIONS.kemang!,
      weekStart: ADMIN_WEEK,
      days,
      status: scheduleStatus,
      publishBy: addDays(ADMIN_WEEK, -3),
      rows,
      coverage,
      warnings,
      templates: [TEMPLATES.P, TEMPLATES.S],
    };
  };

  let approvals: ApprovalRequest[] = [
    {
      id: 'ap-1',
      kind: 'leave',
      employee: EMPLOYEES.dewi,
      submittedAgo: '2 jam lalu',
      summary: 'Cuti tahunan · Kam 15–Jum 16 Okt',
      status: 'pending',
      escalated: false,
      details: [
        { label: 'Jenis', value: 'Cuti tahunan' },
        { label: 'Tanggal', value: 'Kam 15 – Jum 16 Okt 2026' },
        { label: 'Durasi', value: '2 hari kerja' },
        { label: 'Saldo', value: '9 → 7 hari' },
      ],
      reason: 'Acara keluarga di kampung',
      scheduleImpact: 'Shift Pagi Kam 15 dan Jum 16 Okt akan terisi 2 dari 3 orang.',
    },
    {
      id: 'ap-2',
      kind: 'correction',
      employee: EMPLOYEES.budi,
      submittedAgo: '5 jam lalu',
      summary: 'Koreksi absen pulang · Sel 6 Okt',
      status: 'pending',
      escalated: false,
      details: [
        { label: 'Tanggal', value: 'Sel, 6 Okt 2026' },
        { label: 'Tercatat', value: 'Masuk 05.55 · Pulang —' },
        { label: 'Usulan', value: 'Pulang 14.03' },
        { label: 'Diajukan oleh', value: 'Hendra (Kepala Toko)' },
      ],
      reason: 'Lupa absen pulang, terlihat di CCTV keluar 14.03',
    },
    {
      id: 'ap-3',
      kind: 'field_duty',
      employee: EMPLOYEES.rina,
      submittedAgo: 'Hari ini',
      summary: 'Absen di luar radius (230 m)',
      status: 'pending',
      escalated: false,
      details: [
        { label: 'Waktu', value: 'Rab, 7 Okt 2026 · 06.12' },
        { label: 'Jarak', value: '230 m dari Outlet Kemang' },
      ],
      reason: 'Antar pesanan pelanggan ke Jl. Bangka',
    },
    {
      id: 'ap-4',
      kind: 'offline_review',
      employee: EMPLOYEES.andi,
      submittedAgo: '26 jam lalu',
      summary: 'Absen offline 13 jam · Sen 5 Okt',
      status: 'pending',
      escalated: true,
      details: [
        { label: 'Waktu di perangkat', value: 'Sen, 5 Okt 2026 · 12.58' },
        { label: 'Terkirim', value: 'Sel, 6 Okt 2026 · 02.10' },
        { label: 'Lokasi', value: 'Outlet Kemang (QR tidak dipakai)' },
      ],
    },
  ];

  // ---------- Payroll ----------
  const payrollRows = () => [
    {
      employee: EMPLOYEES.agus,
      locationName: 'Gudang',
      daysPresent: 26,
      overtimeHours: 4,
      gross: 5_612_000,
      takeHome: 5_301_000,
      issue: { kind: 'missing_ptkp' as const, label: 'Status PTKP kosong', actionLabel: 'Lengkapi data' },
    },
    {
      employee: EMPLOYEES.wahyu,
      locationName: 'Gudang',
      daysPresent: 22,
      overtimeHours: 0,
      gross: 3_960_000,
      takeHome: 3_840_000,
      issue: { kind: 'casual_21_days' as const, label: '≥ 21 hari, 3 bulan berturut-turut', actionLabel: 'Tinjau status' },
    },
    {
      employee: EMPLOYEES.rina,
      locationName: 'Outlet Kemang',
      daysPresent: 25,
      overtimeHours: 2,
      gross: 5_480_000,
      takeHome: 5_172_000,
      issue: { kind: 'non_mandiri_account' as const, label: 'Rekening bukan Mandiri', actionLabel: 'Periksa rekening' },
    },
    { employee: EMPLOYEES.joko, locationName: 'Outlet Kemang', daysPresent: 26, overtimeHours: 6, gross: 6_101_734, takeHome: 5_733_734 },
    { employee: EMPLOYEES.sari, locationName: 'Outlet Kemang', daysPresent: 26, overtimeHours: 0, gross: 5_650_000, takeHome: 5_322_000 },
    { employee: EMPLOYEES.dedi, locationName: 'Gudang', daysPresent: 26, overtimeHours: 8, gross: 6_420_000, takeHome: 6_011_000 },
  ];
  let payrollStage: 'hr_review' | 'owner_approval' = 'hr_review';

  const buildPayroll = (period: string): PayrollRun => {
    const active = payrollStage;
    const stepStatus = (key: string, order: number) => {
      const activeOrder = active === 'hr_review' ? 2 : 3;
      return order < activeOrder ? 'done' : order === activeOrder ? 'active' : 'todo';
    };
    const steps = [
      { key: 'lock_attendance', label: 'Kunci absensi', dateLabel: '25 Apr' },
      { key: 'calculate', label: 'Hitung gaji', dateLabel: '26 Apr' },
      { key: 'hr_review', label: 'Review HR', dateLabel: '26 Apr' },
      { key: 'owner_approval', label: 'Persetujuan Owner', dateLabel: 'Target 27 Apr 12.00' },
      { key: 'lock_period', label: 'Kunci periode', dateLabel: '27 Apr' },
      { key: 'export_bank', label: 'Ekspor Mandiri MCM', dateLabel: '27 Apr' },
    ] as const;
    return {
      period,
      periodLabel: 'April 2027',
      periodStart: '2027-03-26',
      periodEnd: '2027-04-25',
      payDate: '2027-04-28',
      steps: steps.map((s, i) => ({ ...s, status: stepStatus(s.key, i) })),
      employeesTotal: 120,
      employeesReady: 117,
      totals: { gross: 648_250_000, takeHome: 609_380_000 },
      counts: { all: 120, needsReview: 3, casual: 48, withOvertime: 31 },
      rows: payrollRows(),
    };
  };

  // ---------- Payslip ----------
  const payslips: Record<string, Payslip> = {
    '2026-09': {
      period: '2026-09',
      periodLabel: 'September 2026',
      periodStart: '2026-08-26',
      periodEnd: '2026-09-25',
      payDate: '2026-09-28',
      earnings: [
        { label: 'Gaji pokok', amount: 5_500_000 },
        { label: 'Tunjangan tetap', amount: 300_000 },
        { label: 'Lembur · 6 jam', amount: 301_734 },
      ],
      deductions: [
        { label: 'BPJS Kesehatan 1%', amount: 58_000 },
        { label: 'BPJS JHT 2%', amount: 116_000 },
        { label: 'BPJS JP 1%', amount: 58_000 },
        { label: 'PPh 21 (TER)', amount: 136_000 },
      ],
      takeHome: 5_733_734,
      bankAccountMasked: 'Mandiri ••• 4821',
      pdfUrl: '#slip-2026-09.pdf',
    },
    '2026-08': {
      period: '2026-08',
      periodLabel: 'Agustus 2026',
      periodStart: '2026-07-26',
      periodEnd: '2026-08-25',
      payDate: '2026-08-28',
      earnings: [
        { label: 'Gaji pokok', amount: 5_500_000 },
        { label: 'Tunjangan tetap', amount: 300_000 },
      ],
      deductions: [
        { label: 'BPJS Kesehatan 1%', amount: 58_000 },
        { label: 'BPJS JHT 2%', amount: 116_000 },
        { label: 'BPJS JP 1%', amount: 58_000 },
        { label: 'PPh 21 (TER)', amount: 116_000 },
      ],
      takeHome: 5_452_000,
      bankAccountMasked: 'Mandiri ••• 4821',
      pdfUrl: '#slip-2026-08.pdf',
    },
  };

  const identity = (key: EmployeeKey): KioskIdentity => ({ employeeId: EMPLOYEES[key].id, name: EMPLOYEES[key].name, position: EMPLOYEES[key].position });

  const kioskRecord = (kioskId: string, key: EmployeeKey): KioskClockResult => {
    const time = serverNow();
    const late = Math.max(0, minutesBetween(TEMPLATES.P.start, time));
    recentByKiosk[kioskId] = [{ name: EMPLOYEES[key].name.split(' ')[0] ?? '', direction: 'in' as const, time }, ...(recentByKiosk[kioskId] ?? [])].slice(0, 5);
    return { outcome: 'recorded', name: EMPLOYEES[key].name, direction: 'in', time, status: late > 0 ? 'late' : 'on_time', lateMinutes: late };
  };

  // =====================================================================
  // ---------- Login (meniru AuthService: 5x salah → terkunci 15 menit) ----------
  const loginFailures = new Map<string, { count: number; lockedUntil?: number }>();
  const lockedMessage = (until: number) => {
    const d = new Date(until);
    const hhmm = `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
    return `Terlalu banyak percobaan masuk. Coba lagi pukul ${hhmm} WIB, atau hubungi HR untuk reset kata sandi.`;
  };

  return {
    isMock: true,
    auth: {
      async login(email: string, password: string): Promise<LoginResult> {
        await delay();
        const key = email.trim().toLowerCase();
        if (!key || !password) throw new ApiError(422, 'LOGIN_REQUIRED', 'Isi email dan kata sandi.');
        const user = DEMO_USERS.find((u) => u.email === key);
        const state = loginFailures.get(key) ?? { count: 0 };
        if (state.lockedUntil && state.lockedUntil > Date.now()) throw new ApiError(423, 'LOGIN_LOCKED', lockedMessage(state.lockedUntil));
        if (!user || password !== DEMO_PASSWORD) {
          if (user) {
            const count = state.count + 1;
            const lockedUntil = count >= 5 ? Date.now() + 15 * 60_000 : undefined;
            loginFailures.set(key, { count: lockedUntil ? 0 : count, lockedUntil });
            if (lockedUntil) throw new ApiError(423, 'LOGIN_LOCKED', lockedMessage(lockedUntil));
          }
          throw new ApiError(401, 'INVALID_LOGIN', 'Email atau kata sandi salah. Periksa lagi, atau hubungi HR bila lupa kata sandi.');
        }
        loginFailures.delete(key);
        return { token: `demo.${user.id}.${Date.now()}`, expiresInSeconds: 12 * 3600, user };
      },
    },
    setScenario: (s) => {
      scenario = { ...scenario, ...s };
    },
    getScenario: () => scenario,

    employee: {
      async getMe() {
        await delay();
        return { ...me, location: LOCATIONS.kemang!, greetingName: 'Joko' };
      },
      async getToday() {
        await delay();
        const status = myClockIn
          ? minutesBetween(TEMPLATES.P.start, myClockIn) > 0
            ? 'late'
            : 'on_time'
          : 'not_yet';
        return { date: TODAY, shift: TEMPLATES.P, location: LOCATIONS.kemang!, clockIn: myClockIn, clockOut: myClockOut, status, serverTime: serverNow() };
      },
      async checkGeofence() {
        await delay();
        return scenario.geofence === 'inside'
          ? { inside: true, distanceM: 42, locationName: 'Outlet Kemang' }
          : { inside: false, distanceM: 230, locationName: 'Outlet Kemang' };
      },
      async clock(request): Promise<ClockResult> {
        await delay();
        const shift = shiftLabel(TEMPLATES.P);
        if (request.geo?.isMock || scenario.mockLocation) {
          return { outcome: 'rejected', reason: 'mock_location', detail: 'Aplikasi lokasi palsu terdeteksi di HP Anda. Matikan aplikasi tersebut lalu coba lagi, atau absen di kiosk.' };
        }
        if (request.method === 'app_qr') {
          const valid = request.qrToken === currentQrToken(0) || request.qrToken === currentQrToken(1);
          if (!request.qrToken?.startsWith('DPQR-')) return { outcome: 'rejected', reason: 'qr_invalid', detail: 'QR ini bukan QR absensi DagingPeople.' };
          if (!valid) return { outcome: 'rejected', reason: 'qr_expired', detail: 'QR kedaluwarsa, silakan pindai ulang.' };
        }
        const time = serverNow();
        const setTime = () => {
          if (request.direction === 'in') myClockIn = time;
          else myClockOut = time;
        };
        const locationName = request.method === 'app_qr' ? LOCATIONS.gudang!.name : LOCATIONS.kemang!.name;
        if (request.offline || scenario.offline) {
          setTime();
          return { outcome: 'queued_offline', direction: request.direction, time, locationName, shiftLabel: shift };
        }
        if (request.method === 'app_gps' && scenario.geofence === 'outside') {
          if (!request.fieldDuty) {
            return { outcome: 'rejected', reason: 'outside_geofence', detail: 'Lokasi Anda 230 m dari Outlet Kemang. Dekati outlet atau pilih Tugas Luar.' };
          }
          setTime();
          return { outcome: 'pending_approval', direction: request.direction, time, locationName, shiftLabel: shift };
        }
        setTime();
        const late = request.direction === 'in' ? Math.max(0, minutesBetween(TEMPLATES.P.start, time)) : 0;
        return { outcome: 'recorded', direction: request.direction, time, status: late > 0 ? 'late' : 'on_time', lateMinutes: late, locationName, shiftLabel: shift };
      },
      async getWeekSchedule(weekStart = '2026-10-05') {
        await delay();
        const pattern: ScheduleCell[] = ['P', 'P', 'P', 'S', 'S', 'P', 'OFF'];
        const days: ScheduleDay[] = pattern.map((cell, i) => {
          const date = addDays(weekStart, i);
          const shift = cell === 'OFF' || cell === 'LEAVE' ? null : TEMPLATES[cell];
          const day: ScheduleDay = { date, cell, shift, locationName: 'Outlet Kemang', isToday: date === TODAY };
          if (date === '2026-10-05') day.attendance = { status: 'on_time', lateMinutes: 0 };
          if (date === '2026-10-06') day.attendance = { status: 'late', lateMinutes: 8 };
          if (date < '2026-10-05' && shift) day.attendance = { status: 'on_time', lateMinutes: 0 };
          return day;
        });
        return { weekStart, days, nextWeekPublishBy: addDays(weekStart, 4) };
      },
      async getLeaveBalance() {
        await delay();
        return { annualRemaining: leaveBalance, annualEntitlement: 12 };
      },
      async previewLeave({ type, startDate, endDate }) {
        await delay();
        const workingDays = endDate >= startDate ? countWorkingDays(startDate, endDate) : 0;
        return {
          workingDays,
          balanceAfter: type === 'annual' ? leaveBalance - workingDays : null,
          attachmentRequired: type === 'sick' && workingDays > 1,
          approverName: 'Hendra (Kepala Toko)',
        };
      },
      async submitLeave(input) {
        await delay();
        const days = countWorkingDays(input.startDate, input.endDate);
        if (input.type === 'annual' && days > leaveBalance) throw new Error(`Saldo cuti tidak cukup: sisa ${leaveBalance} hari, diminta ${days} hari.`);
        if (input.type === 'sick' && days > 1 && !input.attachmentName) throw new Error('Surat dokter wajib untuk sakit lebih dari 1 hari.');
        if (input.type === 'annual') leaveBalance -= days;
        return { id: uuid(), status: 'pending' };
      },
      async listPayslipPeriods() {
        await delay();
        return Object.values(payslips).map((p) => ({ period: p.period, label: `${p.periodLabel} · dibayar ${Number(p.payDate.slice(8))} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][Number(p.payDate.slice(5, 7)) - 1]}` }));
      },
      async getPayslip(period) {
        await delay();
        const slip = payslips[period];
        if (!slip) throw new Error('Slip gaji periode ini belum terbit.');
        return slip;
      },
    },

    kiosk: {
      async getInfo(kioskId) {
        await delay();
        return kioskId === 'kiosk-gudang-1'
          ? { id: kioskId, name: 'Pintu Masuk', location: LOCATIONS.gudang!, mode: 'dynamic_qr' }
          : { id: kioskId, name: 'Kiosk 1', location: LOCATIONS.kemang!, mode: 'card' };
      },
      async getRecentClocks(kioskId) {
        await delay();
        return recentByKiosk[kioskId] ?? [];
      },
      async getDynamicQr() {
        // Tanpa delay: QR harus segera tampil. Di produksi token = TOTP dari kunci rahasia kiosk.
        const windowStart = Math.floor(Date.now() / 30000) * 30000;
        return { token: currentQrToken(0), expiresAt: windowStart + 30000, periodSeconds: 30 };
      },
      async identifyByCard(_kioskId, cardToken) {
        await delay();
        const key = CARDS[cardToken];
        return key ? identity(key) : null;
      },
      async lookupEmployeeCode(code) {
        await delay();
        const entry = (Object.keys(EMPLOYEES) as EmployeeKey[]).find((k) => EMPLOYEES[k].code.endsWith(`-${code.padStart(4, '0')}`));
        return entry ? identity(entry) : null;
      },
      async clockWithCard(kioskId, cardToken) {
        await delay();
        const key = CARDS[cardToken];
        if (!key) return { outcome: 'rejected', reason: 'unknown_card' };
        return kioskRecord(kioskId, key);
      },
      async clockWithPin(kioskId, employeeCode, pin) {
        await delay();
        const code = employeeCode.padStart(4, '0');
        const state = pinAttempts.get(code) ?? { failures: 0 };
        if (state.lockedUntil) return { outcome: 'rejected', reason: 'locked', lockedUntil: state.lockedUntil };
        const key = (Object.keys(EMPLOYEES) as EmployeeKey[]).find((k) => EMPLOYEES[k].code.endsWith(`-${code}`));
        if (!key || PINS[code] !== pin) {
          const failures = state.failures + 1;
          // ATT-02 AC2: 3x salah → akun (bukan kiosk) terkunci 15 menit.
          const next = failures >= 3 ? { failures, lockedUntil: addSecondsToClock(`${serverNow()}:00`, 15 * 60) } : { failures };
          pinAttempts.set(code, next);
          return next.lockedUntil
            ? { outcome: 'rejected', reason: 'locked', lockedUntil: next.lockedUntil }
            : { outcome: 'rejected', reason: 'wrong_pin', attemptsLeft: 3 - failures };
        }
        pinAttempts.delete(code);
        return kioskRecord(kioskId, key);
      },
    },

    admin: {
      async listLocations() {
        await delay();
        return Object.values(LOCATIONS).map((l) => ({ id: l.id, name: l.name }));
      },
      async getAttendanceSummary(locationId) {
        await delay();
        const records = locationId === 'kemang' ? todayRecords : [];
        const syncedJoko = records.map((r) => (r.employee.id === 'joko' && myClockIn ? { ...r, clockIn: myClockIn, status: 'on_time' as const, method: 'app_gps' as const } : r));
        return {
          date: TODAY,
          updatedAt: serverNow(),
          scheduled: syncedJoko.filter((r) => r.shift).length,
          onTime: syncedJoko.filter((r) => r.status === 'on_time').length,
          late: syncedJoko.filter((r) => r.status === 'late').length,
          notYet: syncedJoko.filter((r) => r.status === 'not_yet').length,
          onLeave: syncedJoko.filter((r) => r.status === 'leave').length,
        };
      },
      async getAttendanceRecords(locationId) {
        await delay();
        if (locationId !== 'kemang') return [];
        return todayRecords.map((r) => (r.employee.id === 'joko' && myClockIn ? { ...r, clockIn: myClockIn, status: 'on_time' as const, method: 'app_gps' as const } : r));
      },
      async getAnomalies(locationId) {
        await delay();
        return anomalies.filter((a) => a.employee.locationId === locationId);
      },
      async getWeekSchedule() {
        await delay();
        return buildAdminSchedule();
      },
      async updateScheduleCell(_locationId, _weekStart, employeeId, dayIndex, cell) {
        await delay();
        const row = scheduleRows.find((r) => EMPLOYEES[r.key].id === employeeId);
        if (!row) throw new Error('Karyawan tidak ditemukan di jadwal ini.');
        if (row.cells[dayIndex] === 'LEAVE') throw new Error('Hari ini cuti yang sudah disetujui. Ubah lewat pembatalan cuti.');
        row.cells[dayIndex] = cell;
        scheduleStatus = 'draft';
        return buildAdminSchedule();
      },
      async publishSchedule() {
        await delay();
        scheduleStatus = 'published';
        return buildAdminSchedule();
      },
      async listApprovals(kind) {
        await delay();
        return approvals.filter((a) => a.status === 'pending' && (!kind || a.kind === kind));
      },
      async decideApproval(id, decision, note) {
        await delay();
        if (decision === 'reject' && !note?.trim()) throw new Error('Tulis alasan penolakan agar karyawan tahu langkah berikutnya.');
        const found = approvals.find((a) => a.id === id);
        if (!found) throw new Error('Pengajuan tidak ditemukan atau sudah diputuskan.');
        const updated = { ...found, status: decision === 'approve' ? ('approved' as const) : ('rejected' as const) };
        approvals = approvals.map((a) => (a.id === id ? updated : a));
        return updated;
      },
      async getPayrollRun(period) {
        await delay();
        return buildPayroll(period);
      },
      async recalculatePayroll(period) {
        await wait(latency * 4);
        return buildPayroll(period);
      },
      async submitPayrollForApproval(period) {
        await delay();
        payrollStage = 'owner_approval';
        return buildPayroll(period);
      },
    },
  };
};

export type MockHrisClient = ReturnType<typeof createMockClient>;

/** Token QR & kartu contoh, untuk tombol simulasi di demo. */
export const DEMO_FIXTURES = {
  cards: ['CARD-0042', 'CARD-0017', 'CARD-0063'],
  pins: [{ code: '0042', pin: '123456', name: 'Joko Prasetyo' }],
  currentGudangQr: () => `DPQR-gudang-${Math.floor(Date.now() / 30000)}`,
} as const;
