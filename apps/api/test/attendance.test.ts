import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import type { ClockRequest } from '@dagingpeople/contracts';
import { DomainError } from '../src/common/errors';
import { DEMO_DEVICE_TOKENS } from '../src/seed/seed';
import { actors, freshDb, type Services } from './support/env';

const KEMANG = { lat: -6.2607, lng: 106.8137 };
const gps = (over: Partial<ClockRequest> = {}): ClockRequest => ({
  clientUuid: randomUUID(),
  direction: 'in',
  method: 'app_gps',
  geo: { ...KEMANG, accuracyM: 12, isMock: false },
  deviceEventTime: '2026-10-07T05:52:00+07:00',
  offline: false,
  ...over,
});

let s: Services;
before(async () => {
  s = await freshDb();
});
after(async () => s.close());

describe('ATT-01 absen aplikasi (GPS)', () => {
  test('masuk di dalam radius sebelum shift → tercatat tepat waktu', async () => {
    const r = await s.attendance.clockFromApp(actors.joko, gps());
    assert.equal(r.outcome, 'recorded');
    assert.ok(r.outcome === 'recorded' && r.status === 'on_time' && r.time === '05:52');
    const today = await s.attendance.getToday(actors.joko);
    assert.equal(today.clockIn, '05:52');
    assert.equal(today.shift?.code, 'P');
  });

  test('kirim ulang clientUuid yang sama → hasil identik, tidak dobel (idempoten)', async () => {
    const req = gps({ direction: 'out', deviceEventTime: '2026-10-07T05:53:00+07:00' });
    s.clock.set('2026-10-07T14:05:00+07:00');
    const first = await s.attendance.clockFromApp(actors.joko, req);
    s.clock.set('2026-10-07T14:09:00+07:00');
    const again = await s.attendance.clockFromApp(actors.joko, req);
    assert.deepEqual(again, first);
    const [{ n }] = (await s.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM attendance_event WHERE client_uuid = $1::uuid`, [req.clientUuid])) as [{ n: number }];
    assert.equal(n, 1);
    s.clock.set('2026-10-07T05:52:00+07:00');
  });

  test('lokasi palsu → ditolak dan tetap tercatat untuk audit', async () => {
    const r = await s.attendance.clockFromApp(actors.sari, gps({ geo: { ...KEMANG, accuracyM: 5, isMock: true } }));
    assert.equal(r.outcome, 'rejected');
    assert.ok(r.outcome === 'rejected' && r.reason === 'mock_location');
    const [{ status }] = (await s.db.query<{ status: string }>(`SELECT status FROM attendance_event WHERE employee_id = 'sari' ORDER BY received_at DESC LIMIT 1`)) as [{ status: string }];
    assert.equal(status, 'rejected');
  });

  test('di luar radius tanpa alasan → ditolak dengan jarak; dengan alasan tugas luar → menunggu Kepala Toko', async () => {
    const far = { lat: -6.2700, lng: 106.8137, accuracyM: 10, isMock: false }; // ±1 km
    const rejected = await s.attendance.clockFromApp(actors.sari, gps({ geo: far }));
    assert.ok(rejected.outcome === 'rejected' && rejected.reason === 'outside_geofence');
    assert.match(rejected.detail, /m dari Outlet Kemang/);

    const pending = await s.attendance.clockFromApp(actors.sari, gps({ geo: far, fieldDuty: { reason: 'Antar pesanan ke Hotel Kemang' } }));
    assert.equal(pending.outcome, 'pending_approval');

    const inbox = await s.approvals.list(actors.hendra, 'field_duty');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]!.employee.name, 'Sari Wulandari');
    assert.equal(inbox[0]!.reason, 'Antar pesanan ke Hotel Kemang');

    await assert.rejects(s.approvals.decide(actors.hendra, 'field_duty', inbox[0]!.id, 'reject'), (e: DomainError) => e.code === 'NOTE_REQUIRED');
    const decided = await s.approvals.decide(actors.hendra, 'field_duty', inbox[0]!.id, 'approve');
    assert.equal(decided.status, 'approved');
    assert.equal((await s.approvals.list(actors.hendra, 'field_duty')).length, 0);

    const [day] = await s.db.query<{ clock_in: string | null }>(
      `SELECT to_char(clock_in AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS clock_in FROM attendance_day_v WHERE employee_id = 'sari' AND work_date = '2026-10-07'`,
    );
    assert.equal(day?.clock_in, '05:52', 'tugas luar yang disetujui dihitung hadir');
  });

  test('sinkron offline > 12 jam → menunggu review; ≤ 12 jam → tercatat dengan jam perangkat', async () => {
    const results = await s.attendance.sync(actors.agus, [
      { ...gps(), method: 'app_gps', geo: undefined, direction: 'in', deviceEventTime: '2026-10-06T03:01:00+07:00' },
      { ...gps(), method: 'app_gps', geo: undefined, direction: 'out', deviceEventTime: '2026-10-06T22:00:00+07:00' },
    ]);
    assert.equal(results[0]!.result.outcome, 'pending_approval');
    assert.equal(results[1]!.result.outcome, 'recorded');
    assert.ok(results[1]!.result.outcome === 'recorded' && results[1]!.result.time === '22:00');
  });

  test('Kepala Toko tidak bisa melihat lokasi lain; karyawan tidak bisa absen lewat method kiosk', async () => {
    await assert.rejects(s.attendance.getRecords(actors.hendra, 'gudang'), (e: DomainError) => e.kind === 'forbidden');
    await assert.rejects(s.attendance.clockFromApp(actors.joko, gps({ method: 'kiosk_pin' })), (e: DomainError) => e.kind === 'forbidden');
  });

  test('rekap Kepala Toko: Joko & Sari hadir, sisanya belum absen', async () => {
    const summary = await s.attendance.getSummary(actors.hendra, 'kemang');
    assert.equal(summary.scheduled, 10);
    assert.equal(summary.onTime, 2);
    const records = await s.attendance.getRecords(actors.hendra, 'kemang');
    assert.equal(records.find((r) => r.employee.id === 'joko')?.method, 'app_gps');
  });
});

describe('ATT-02/04 kiosk', () => {
  test('token perangkat salah ditolak; token benar → identitas kiosk', async () => {
    assert.equal(await s.kiosk.authenticate('salah'), null);
    const k = await s.kiosk.authenticate(DEMO_DEVICE_TOKENS['kiosk-kemang-1']);
    assert.deepEqual(k, { kioskId: 'kiosk-kemang-1', locationId: 'kemang', mode: 'card' });
  });

  test('kartu → absen masuk, tap kedua → pulang', async () => {
    const k = (await s.kiosk.authenticate(DEMO_DEVICE_TOKENS['kiosk-kemang-1']))!;
    const who = await s.kiosk.identifyByCard(k, 'CARD-0063');
    assert.equal(who?.name, 'Rina Kusuma');
    const first = await s.kiosk.clockWithCard(k, 'CARD-0063', 'photo://1');
    assert.ok(first.outcome === 'recorded' && first.direction === 'in');
    s.clock.set('2026-10-07T14:02:00+07:00');
    const second = await s.kiosk.clockWithCard(k, 'CARD-0063', 'photo://2');
    assert.ok(second.outcome === 'recorded' && second.direction === 'out');
    s.clock.set('2026-10-07T05:52:00+07:00');
    const recent = await s.kiosk.getRecentClocks(k);
    assert.ok(recent.some((r) => r.name.startsWith('Rina')));
  });

  test('PIN salah 3× → terkunci 15 menit (per karyawan), lalu terbuka kembali', async () => {
    const k = (await s.kiosk.authenticate(DEMO_DEVICE_TOKENS['kiosk-kemang-1']))!;
    const a = await s.kiosk.clockWithPin(k, '0017', '000000', 'p');
    assert.ok(a.outcome === 'rejected' && a.reason === 'wrong_pin' && a.attemptsLeft === 2);
    await s.kiosk.clockWithPin(k, '0017', '000001', 'p');
    const c = await s.kiosk.clockWithPin(k, '0017', '000002', 'p');
    assert.ok(c.outcome === 'rejected' && c.reason === 'locked' && c.lockedUntil === '06:07');
    const stillLocked = await s.kiosk.clockWithPin(k, '0017', '111111', 'p');
    assert.ok(stillLocked.outcome === 'rejected' && stillLocked.reason === 'locked', 'PIN benar pun ditolak saat terkunci');
    s.clock.set('2026-10-07T06:08:00+07:00');
    const ok = await s.kiosk.clockWithPin(k, '0017', '111111', 'p');
    assert.equal(ok.outcome, 'recorded');
    s.clock.set('2026-10-07T05:52:00+07:00');
  });

  test('tebakan PIN paralel tidak bisa melewati batas 3 percobaan', async () => {
    const k = (await s.kiosk.authenticate(DEMO_DEVICE_TOKENS['kiosk-kemang-1']))!;
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => s.kiosk.clockWithPin(k, '0063', String(900000 + i), 'p')));
    assert.equal(results.filter((r) => r.outcome === 'rejected' && r.reason === 'wrong_pin').length, 2, 'paling banyak 2 tebakan dijawab "salah" sebelum kunci');
    assert.equal(results.filter((r) => r.outcome === 'rejected' && r.reason === 'locked').length, 8);
    const correct = await s.kiosk.clockWithPin(k, '0063', '222222', 'p');
    assert.ok(correct.outcome === 'rejected' && correct.reason === 'locked', 'PIN benar pun ditolak saat terkunci');
  });

  test('QR dinamis gudang: token sekarang sah, token 2 jendela lalu kedaluwarsa, token palsu ditolak', async () => {
    const k = (await s.kiosk.authenticate(DEMO_DEVICE_TOKENS['kiosk-gudang-1']))!;
    s.clock.set('2026-10-07T03:00:10+07:00');
    const qr = await s.kiosk.getDynamicQr(k);
    const scan = (token: string, deviceEventTime: string) =>
      s.attendance.clockFromApp(actors.agus, { clientUuid: randomUUID(), direction: 'in', method: 'app_qr', qrToken: token, deviceEventTime, offline: false });

    const fresh = await scan(qr.token, '2026-10-07T03:00:12+07:00');
    assert.ok(fresh.outcome === 'recorded' && fresh.locationName === 'Gudang & Cold Storage');

    s.clock.set('2026-10-07T03:01:30+07:00');
    const stale = await scan(qr.token, '2026-10-07T03:01:30+07:00');
    assert.ok(stale.outcome === 'rejected' && stale.reason === 'qr_expired');

    const forged = qr.token.replace(/\.[^.]+$/, '.AAAAAAAAAAAAAAAA');
    const bad = await scan(forged, '2026-10-07T03:01:30+07:00');
    assert.ok(bad.outcome === 'rejected' && bad.reason === 'qr_invalid');
    s.clock.set('2026-10-07T05:52:00+07:00');
  });
});

describe('ATT-03 koreksi absen', () => {
  test('Kepala Toko mengajukan, hanya HR yang memutuskan; koreksi menang atas event', async () => {
    const { id } = await s.attendance.requestCorrection(actors.hendra, { employeeId: 'budi', workDate: '2026-10-06', clockIn: '06:00', clockOut: '14:00', reason: 'HP rusak, hadir dikonfirmasi CCTV' });
    assert.equal((await s.approvals.list(actors.hendra, 'correction')).length, 0, 'koreksi tidak tampil untuk Kepala Toko');
    const inbox = await s.approvals.list(actors.hr, 'correction');
    assert.equal(inbox.length, 1);
    assert.match(inbox[0]!.details.find((d) => d.label === 'Usulan')!.value, /06\.00/);
    await assert.rejects(s.attendance.decideCorrection(actors.hendra, id, 'approve'), (e: DomainError) => e.kind === 'forbidden');
    await s.approvals.decide(actors.hr, 'correction', id, 'approve');
    const [day] = await s.db.query<{ clock_in: string }>(
      `SELECT to_char(clock_in AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS clock_in FROM attendance_day_v WHERE employee_id = 'budi' AND work_date = '2026-10-06'`,
    );
    assert.equal(day?.clock_in, '06:00');
    const audit = await s.db.query<{ action: string }>(`SELECT action FROM audit_log WHERE entity_id = $1`, [id]);
    assert.deepEqual(audit.map((a) => a.action), ['attendance_correction.approve']);
  });
});
