import type { HrisClient } from './client';
import { API_PREFIX, buildPath, ROUTES, type RouteName } from './routes';
import type { AdminWeekSchedule, ClockRequest, ClockResult, KioskIdentity, PayrollRun } from './types';

/**
 * Implementasi HrisClient lewat REST API (pengganti createMockClient di produksi).
 * Endpoint dari ROUTES (satu sumber dengan backend). Pesan error dari server sudah ramah pengguna
 * (bahasa Indonesia), jadi UI cukup menampilkan `error.message`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type HttpClientOptions = {
  /** Mis. 'https://api.dagingprima.co.id' — tanpa '/api/v1'. */
  baseUrl: string;
  /** JWT pengguna yang sedang login (aplikasi karyawan & web admin). */
  getToken?: () => string | null;
  /**
   * Token perangkat kiosk (hanya di tablet kiosk). Bisa berupa fungsi per kioskId untuk satu klien yang
   * melayani beberapa kiosk (mis. demo yang menampilkan kiosk outlet dan gudang sekaligus).
   */
  kioskToken?: string | ((kioskId: string) => string | null | undefined);
  /** Id kiosk tablet ini (mis. 'kiosk-kemang-1'). */
  kioskId?: string;
  /** Dipanggil saat server menjawab 401 (mis. arahkan ke halaman login). */
  onUnauthenticated?: () => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type BankFile = { filename: string; content: string; count: number; total: number; nonMandiriCount: number };

export type HttpHrisClient = HrisClient & {
  payrollOps: {
    createPeriod(period: string): Promise<PayrollRun>;
    lockAttendance(period: string): Promise<PayrollRun>;
    decide(period: string, decision: 'approve' | 'reject', note?: string): Promise<PayrollRun>;
    lockPeriod(period: string, confirmation: string): Promise<PayrollRun>;
    exportBankFile(period: string): Promise<BankFile>;
  };
  kioskOps: { getServerTime(kioskId: string): Promise<{ time: string; date: string }> };
};

const NETWORK_MESSAGE = 'Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.';

export const createHttpClient = (options: HttpClientOptions): HttpHrisClient => {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '') + API_PREFIX;
  /** Peringatan terakhir yang dilihat pengguna per minggu jadwal → dikirim sebagai konfirmasi saat terbit. */
  const seenWarnings = new Map<string, number>();
  let lastKioskId: string | null = null;
  const remember = (locationId: string, s: AdminWeekSchedule) => {
    seenWarnings.set(`${locationId}:${s.weekStart}`, s.warnings.length);
    return s;
  };

  const raw = async (route: RouteName, init: { params?: Record<string, string>; query?: Record<string, string | undefined>; body?: unknown } = {}) => {
    const r = ROUTES[route];
    const qs = new URLSearchParams(Object.entries(init.query ?? {}).filter((e): e is [string, string] => e[1] !== undefined)).toString();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (r.auth === 'user') {
      const token = options.getToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (r.auth === 'kiosk') {
      const kioskToken = typeof options.kioskToken === 'function' ? options.kioskToken(init.params?.kioskId ?? '') : options.kioskToken;
      if (kioskToken) headers['X-Kiosk-Token'] = kioskToken;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await doFetch(`${base}${buildPath(route, init.params)}${qs ? `?${qs}` : ''}`, {
        method: r.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { code?: string; message?: string; details?: Record<string, unknown> } | null;
      // 401 dari /auth/login berarti sandi salah, bukan sesi habis.
      if (res.status === 401 && r.auth === 'user') options.onUnauthenticated?.();
      throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? 'Permintaan gagal. Coba lagi.', err?.details);
    }
    return res;
  };
  const call = async <T>(route: RouteName, init?: Parameters<typeof raw>[1]): Promise<T> => (await (await raw(route, init)).json()) as T;

  const client: HttpHrisClient = {
    isMock: false,
    auth: { login: (email, password) => call('login', { body: { email, password } }) },

    employee: {
      getMe: () => call('me'),
      getToday: () => call('today'),
      checkGeofence: (geo) => call('geofenceCheck', { body: geo }),
      async clock(request: ClockRequest): Promise<ClockResult> {
        if (!request.offline) return call('clock', { body: request });
        const [first] = await call<{ clientUuid: string; result: ClockResult }[]>('sync', { body: { events: [request] } });
        return first!.result;
      },
      getWeekSchedule: (weekStart) => call('mySchedule', { query: { weekStart } }),
      getLeaveBalance: () => call('leaveBalance'),
      previewLeave: (input) => call('leavePreview', { body: input }),
      submitLeave: (input) => call('leaveSubmit', { body: input }),
      listPayslipPeriods: () => call('payslipPeriods'),
      getPayslip: (period) => call('payslip', { params: { period } }),
    },

    kiosk: {
      getInfo: (kioskId) => {
        lastKioskId = kioskId;
        return call('kioskInfo', { params: { kioskId } });
      },
      getRecentClocks: (kioskId) => call('kioskRecent', { params: { kioskId } }),
      getDynamicQr: (kioskId) => call('kioskQr', { params: { kioskId } }),
      identifyByCard: async (kioskId, cardToken) => (await call<{ identity: KioskIdentity | null }>('kioskIdentifyCard', { params: { kioskId }, body: { cardToken } })).identity,
      lookupEmployeeCode: async (code) => {
        // Kontrak tidak membawa kioskId untuk pencarian kode; pakai id kiosk dari konfigurasi / getInfo terakhir.
        const kioskId = options.kioskId ?? lastKioskId;
        if (!kioskId) throw new ApiError(0, 'KIOSK_NOT_CONFIGURED', 'Kiosk belum diatur. Hubungi HR.');
        return (await call<{ identity: KioskIdentity | null }>('kioskLookupCode', { params: { kioskId, code } })).identity;
      },
      clockWithCard: (kioskId, cardToken, photoRef) => call('kioskClockCard', { params: { kioskId }, body: { cardToken, photoRef } }),
      clockWithPin: (kioskId, employeeCode, pin, photoRef) => call('kioskClockPin', { params: { kioskId }, body: { employeeCode, pin, photoRef } }),
    },
    kioskOps: { getServerTime: (kioskId) => call('kioskTime', { params: { kioskId } }) },

    admin: {
      listLocations: () => call('locations'),
      getAttendanceSummary: (locationId) => call('attendanceSummary', { params: { locationId } }),
      getAttendanceRecords: (locationId) => call('attendanceRecords', { params: { locationId } }),
      getAnomalies: (locationId) => call('attendanceAnomalies', { params: { locationId } }),
      getWeekSchedule: async (locationId, weekStart) => remember(locationId, await call('adminSchedule', { params: { locationId, weekStart: weekStart ?? 'current' } })),
      updateScheduleCell: async (locationId, weekStart, employeeId, dayIndex, cell) =>
        remember(locationId, await call('scheduleCell', { params: { locationId, weekStart }, body: { employeeId, dayIndex, cell } })),
      publishSchedule: async (locationId, weekStart) =>
        remember(locationId, await call('schedulePublish', { params: { locationId, weekStart }, body: { acknowledgedWarnings: seenWarnings.get(`${locationId}:${weekStart}`) ?? 0 } })),
      listApprovals: (kind) => call('approvals', { query: { kind } }),
      decideApproval: (id, decision, note) => call('approvalDecision', { params: { id }, body: { decision, note } }),
      getPayrollRun: (period) => call('payrollRun', { params: { period } }),
      recalculatePayroll: (period) => call('payrollCalculate', { params: { period } }),
      submitPayrollForApproval: (period) => call('payrollSubmit', { params: { period } }),
    },

    payrollOps: {
      createPeriod: (period) => call('payrollCreatePeriod', { body: { period } }),
      lockAttendance: (period) => call('payrollLockAttendance', { params: { period } }),
      decide: (period, decision, note) => call('payrollDecision', { params: { period }, body: { decision, note } }),
      lockPeriod: (period, confirmation) => call('payrollLock', { params: { period }, body: { confirmation } }),
      async exportBankFile(period) {
        const res = await raw('payrollBankExport', { params: { period } });
        const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `payroll-${period}.csv`;
        return {
          filename,
          content: await res.text(),
          count: Number(res.headers.get('X-Transfer-Count')),
          total: Number(res.headers.get('X-Transfer-Total')),
          nonMandiriCount: Number(res.headers.get('X-Non-Mandiri-Count')),
        };
      },
    },
  };

  return client;
};
