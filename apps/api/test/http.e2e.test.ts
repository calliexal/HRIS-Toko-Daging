import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { ApiError, createHttpClient, type HttpHrisClient } from '../../../packages/api/src/http-client';
import { buildServices } from '../src/app/container';
import { createNodeServer, matchRoute } from '../src/http/node-server';
import { DEMO_DEVICE_TOKENS, DEMO_PASSWORD } from '../src/seed/seed';
import { freshDb, seedPeriodAttendance, TEST_KEYS, type Services } from './support/env';

/** Uji ujung-ke-ujung: klien HTTP frontend → server (tabel handler + auth + pemetaan error) → service → Postgres. */
let s: Services;
let server: ReturnType<typeof createNodeServer>;
let baseUrl = '';
const tokens: Record<string, string> = {};
const as = (who: string, extra: Partial<Parameters<typeof createHttpClient>[0]> = {}): HttpHrisClient =>
  createHttpClient({ baseUrl, getToken: () => tokens[who] ?? null, ...extra });

before(async () => {
  s = await freshDb();
  const svc = buildServices(s.db, s.clock, { ...TEST_KEYS, jwtTtlSeconds: 3600, legalEntityId: 'dpn' });
  server = createNodeServer(svc, (m, e) => console.error(m, e));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const who of ['joko', 'hendra', 'hr', 'owner', 'finance']) {
    tokens[who] = (await as('none').auth.login(`${who}@dagingprima.co.id`, DEMO_PASSWORD)).token;
  }
});
after(async () => {
  await new Promise((r) => server.close(r));
  await s.close();
});

describe('routing', () => {
  test('path dengan parameter cocok ke route yang benar', () => {
    assert.equal(matchRoute('GET', '/api/v1/locations/kemang/schedules/2026-10-12')?.name, 'adminSchedule');
    assert.deepEqual(matchRoute('POST', '/api/v1/payroll/periods/2026-09/lock')?.params, { period: '2026-09' });
    assert.equal(matchRoute('DELETE', '/api/v1/locations'), null);
  });
});

describe('HTTP end-to-end', () => {
  test('tanpa token → 401 dengan pesan ramah; token salah → 401', async () => {
    const anon = as('none');
    await assert.rejects(anon.employee.getMe(), (e: ApiError) => e.status === 401 && e.code === 'UNAUTHENTICATED');
    let called = false;
    const bad = createHttpClient({ baseUrl, getToken: () => 'x.y.z', onUnauthenticated: () => (called = true) });
    await assert.rejects(bad.employee.getMe());
    assert.ok(called);
  });

  test('karyawan: profil, hari ini, absen online, dan absen dari antrean offline', async () => {
    const joko = as('joko');
    assert.equal((await joko.employee.getMe()).code, 'DPN-2024-0042');
    assert.equal((await joko.employee.getToday()).shift?.name, 'Pagi');
    const geo = { lat: -6.2607, lng: 106.8137, accuracyM: 8, isMock: false };
    assert.deepEqual(await joko.employee.checkGeofence(geo), { inside: true, distanceM: 0, locationName: 'Outlet Kemang' });
    const r = await joko.employee.clock({ clientUuid: randomUUID(), direction: 'in', method: 'app_gps', geo, deviceEventTime: '2026-10-07T05:52:00+07:00', offline: false });
    assert.equal(r.outcome, 'recorded');
    const off = await joko.employee.clock({ clientUuid: randomUUID(), direction: 'in', method: 'app_gps', deviceEventTime: '2026-10-06T05:58:00+07:00', offline: true });
    assert.equal(off.outcome, 'pending_approval', 'offline > 12 jam');
    assert.equal((await joko.employee.getLeaveBalance()).annualRemaining, 9);
  });

  test('validasi bentuk request → 422 dengan daftar field', async () => {
    const joko = as('joko');
    await assert.rejects(
      joko.employee.clock({ clientUuid: 'bukan-uuid', direction: 'in', method: 'app_gps', deviceEventTime: 'kemarin', offline: false }),
      (e: ApiError) => e.status === 422 && e.code === 'INVALID_REQUEST' && 'clientUuid' in (e.details!.fields as object),
    );
  });

  test('Kepala Toko: rekap, jadwal (default minggu depan & terbit dengan konfirmasi), inbox persetujuan', async () => {
    const km = as('hendra');
    assert.deepEqual((await km.admin.listLocations()).map((l) => l.id), ['kemang']);
    assert.equal((await km.admin.getAttendanceSummary('kemang')).onTime, 1);
    await assert.rejects(km.admin.getAttendanceSummary('gudang'), (e: ApiError) => e.status === 403);
    const week = await km.admin.getWeekSchedule('kemang');
    assert.equal(week.weekStart, '2026-10-12', 'default = minggu depan yang sedang disusun');
    for (const id of ['budi', 'rina', 'andi']) await km.admin.updateScheduleCell('kemang', '2026-10-12', id, 0, 'OFF');
    const published = await km.admin.publishSchedule('kemang', '2026-10-12');
    assert.equal(published.status, 'published', 'peringatan yang sudah terlihat dikirim sebagai konfirmasi');

    const pending = await km.admin.listApprovals('offline_review');
    assert.equal(pending.length, 1);
    await assert.rejects(km.admin.decideApproval(pending[0]!.id, 'reject'), (e: ApiError) => e.status === 422 && e.code === 'NOTE_REQUIRED');
    assert.equal((await km.admin.decideApproval(pending[0]!.id, 'approve')).status, 'approved');
  });

  test('karyawan tidak bisa membuka data gaji orang lain / payroll', async () => {
    await assert.rejects(as('joko').admin.getPayrollRun('2026-09'), (e: ApiError) => e.status === 403);
  });

  test('payroll via HTTP: buat periode → kunci absensi → hitung → ajukan → setuju → kunci → file bank', async () => {
    const hr = as('hr');
    await seedPeriodAttendance(s.db, '2026-08-26', '2026-09-25');
    await hr.payrollOps.createPeriod('2026-09');
    await assert.rejects(hr.admin.recalculatePayroll('2026-09'), (e: ApiError) => e.status === 409);
    await hr.payrollOps.lockAttendance('2026-09');
    const run = await hr.admin.recalculatePayroll('2026-09');
    assert.equal(run.employeesTotal, 14);
    await hr.admin.submitPayrollForApproval('2026-09');
    await as('owner').payrollOps.decide('2026-09', 'approve');
    await assert.rejects(hr.payrollOps.lockPeriod('2026-09', 'ok'), (e: ApiError) => e.status === 422);
    await hr.payrollOps.lockPeriod('2026-09', 'Kunci periode September 2026');
    const file = await as('finance').payrollOps.exportBankFile('2026-09');
    assert.equal(file.filename, 'payroll-mcm-2026-09-bayar-2026-09-28.csv');
    assert.equal(file.total, (await hr.admin.getPayrollRun('2026-09')).totals.takeHome);
    assert.equal(file.content.split('\r\n').filter(Boolean).length, file.count + 1);
    const slips = await as('joko').employee.listPayslipPeriods();
    assert.equal(slips[0]?.period, '2026-09');
  });

  test('kiosk: token perangkat wajib & harus cocok dengan kiosk di URL', async () => {
    const kiosk = as('none', { kioskToken: DEMO_DEVICE_TOKENS['kiosk-kemang-1'], kioskId: 'kiosk-kemang-1' });
    assert.equal((await kiosk.kiosk.getInfo('kiosk-kemang-1')).mode, 'card');
    await assert.rejects(kiosk.kiosk.getInfo('kiosk-gudang-1'), (e: ApiError) => e.status === 403);
    await assert.rejects(as('none').kiosk.getInfo('kiosk-kemang-1'), (e: ApiError) => e.status === 401);
    assert.equal((await kiosk.kiosk.lookupEmployeeCode('42'))?.name, 'Joko Prasetyo');
    assert.equal(await kiosk.kiosk.identifyByCard('kiosk-kemang-1', 'CARD-TIDAK-ADA'), null);
    const r = await kiosk.kiosk.clockWithPin('kiosk-kemang-1', '0063', '222222', 'photo://x');
    assert.equal(r.outcome, 'recorded');
    assert.equal((await kiosk.kioskOps.getServerTime('kiosk-kemang-1')).time.slice(0, 5), '05:52');
  });

  test('route tidak ada → 404; JSON rusak → 400', async () => {
    const r404 = await fetch(`${baseUrl}/api/v1/nope`);
    assert.equal(r404.status, 404);
    const r400 = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(r400.status, 400);
  });
});
