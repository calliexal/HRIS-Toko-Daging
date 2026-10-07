import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DomainError } from '../src/common/errors';
import { decrypt } from '../src/common/security';
import { DEMO_PASSWORD } from '../src/seed/seed';
import { actors, freshDb, TEST_KEYS, type Services } from './support/env';

let s: Services;
before(async () => {
  s = await freshDb();
});
after(async () => s.close());

describe('SEC-01 login & sesi', () => {
  test('login benar → JWT; token diverifikasi ke aktor dengan lingkup lokasi dari database', async () => {
    const { token, user } = await s.auth.login('Hendra@DagingPrima.co.id', DEMO_PASSWORD);
    assert.deepEqual(user, { id: 'u-hendra', name: 'Hendra Gunawan', email: 'hendra@dagingprima.co.id', role: 'store_manager', employeeId: 'hendra', locationIds: ['kemang'] });
    assert.equal((await s.auth.login('hr@dagingprima.co.id', DEMO_PASSWORD)).user.name, 'Hr', 'akun pusat tanpa data karyawan memakai nama dari email');
    assert.deepEqual(await s.auth.verify(token), { userId: 'u-hendra', role: 'store_manager', employeeId: 'hendra', locationIds: ['kemang'] });
  });

  test('email tidak dikenal dan sandi salah mendapat pesan yang sama', async () => {
    const a = await s.auth.login('tidakada@dagingprima.co.id', 'x').catch((e: DomainError) => e);
    const b = await s.auth.login('joko@dagingprima.co.id', 'salah').catch((e: DomainError) => e);
    assert.ok(a instanceof DomainError && b instanceof DomainError);
    assert.equal(a.message, b.message);
    assert.equal(a.kind, 'unauthenticated');
  });

  test('5x sandi salah → terkunci 15 menit; sandi benar pun ditolak selama terkunci; lalu pulih', async () => {
    for (let i = 1; i <= 4; i++) {
      await assert.rejects(s.auth.login('sari@dagingprima.co.id', `salah-${i}`), (e: DomainError) => e.code === 'INVALID_LOGIN');
    }
    await assert.rejects(s.auth.login('sari@dagingprima.co.id', 'salah-5'), (e: DomainError) => e.code === 'LOGIN_LOCKED' && e.kind === 'locked' && /06\.07 WIB/.test(e.message));
    await assert.rejects(s.auth.login('sari@dagingprima.co.id', DEMO_PASSWORD), (e: DomainError) => e.code === 'LOGIN_LOCKED');
    s.clock.set('2026-10-07T06:08:00+07:00');
    assert.equal((await s.auth.login('sari@dagingprima.co.id', DEMO_PASSWORD)).user.role, 'employee');
    const [row] = await s.db.query<{ failed_login_count: number; locked: boolean }>(`SELECT failed_login_count, login_locked_until IS NOT NULL AS locked FROM app_user WHERE id = 'u-sari'`);
    assert.deepEqual(row, { failed_login_count: 0, locked: false });
    s.clock.set('2026-10-07T05:52:00+07:00');
  });

  test('tebakan paralel tidak bisa melewati batas 5 percobaan (jatah dipesan atomik sebelum cek sandi)', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => s.auth.login('agus@dagingprima.co.id', `paralel-${i}`).catch((e: DomainError) => e.code)),
    );
    assert.equal(results.filter((c) => c === 'INVALID_LOGIN').length, 4, 'paling banyak 4 tebakan dijawab "salah" sebelum kunci terpasang');
    assert.equal(results.filter((c) => c === 'LOGIN_LOCKED').length, 8);
    await assert.rejects(s.auth.login('agus@dagingprima.co.id', DEMO_PASSWORD), (e: DomainError) => e.code === 'LOGIN_LOCKED');
    await s.db.execute(`UPDATE app_user SET failed_login_count = 0, login_locked_until = NULL WHERE id = 'u-agus'`);
  });

  test('akun nonaktif dengan sandi benar mendapat pesan jelas; input kosong → 422', async () => {
    await s.db.execute(`UPDATE app_user SET active = FALSE WHERE id = 'u-agus'`);
    await assert.rejects(s.auth.login('agus@dagingprima.co.id', DEMO_PASSWORD), (e: DomainError) => e.code === 'ACCOUNT_INACTIVE');
    await s.db.execute(`UPDATE app_user SET active = TRUE WHERE id = 'u-agus'`);
    await assert.rejects(s.auth.login('  ', ''), (e: DomainError) => e.kind === 'validation');
  });

  test('token kedaluwarsa, diubah, atau akun dinonaktifkan → ditolak', async () => {
    const { token } = await s.auth.login('joko@dagingprima.co.id', DEMO_PASSWORD);
    const [h, body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), role: 'hr' })).toString('base64url');
    assert.equal(await s.auth.verify(`${h}.${forged}.${sig}`), null);
    await s.db.execute(`UPDATE app_user SET active = FALSE WHERE id = 'u-joko'`);
    assert.equal(await s.auth.verify(token), null);
    await s.db.execute(`UPDATE app_user SET active = TRUE WHERE id = 'u-joko'`);
    s.clock.advance(3601_000);
    assert.equal(await s.auth.verify(token), null);
    s.clock.set('2026-10-07T05:52:00+07:00');
  });
});

describe('HR-01 data karyawan', () => {
  test('profil saya & lokasi sesuai peran', async () => {
    const me = await s.coreHr.getMe(actors.joko);
    assert.equal(me.greetingName, 'Joko');
    assert.equal(me.location.name, 'Outlet Kemang');
    assert.deepEqual((await s.coreHr.listLocations(actors.hendra)).map((l) => l.id), ['kemang']);
    assert.equal((await s.coreHr.listLocations(actors.hr)).length, 3);
    await assert.rejects(s.coreHr.listLocations(actors.joko), (e: DomainError) => e.kind === 'forbidden');
  });

  let newId = '';
  test('tambah karyawan: nomor DPN berurutan, NIK & rekening terenkripsi, NIK ganda ditolak', async () => {
    const input = {
      fullName: 'Putri Ayu', nik: '3174 0123 4567 8901', locationId: 'kemang', position: 'Kasir', employmentType: 'PKWT' as const,
      ptkpStatus: 'TK/0' as const, joinDate: '2026-11-02', contractEndDate: '2027-11-01', bank: { name: 'Mandiri', accountNumber: '1270012345678' },
    };
    const created = await s.coreHr.createEmployee(actors.hr, input);
    newId = created.id;
    assert.equal(created.code, 'DPN-2026-0122');
    const [row] = await s.db.query<{ nik: string; acc: string; last4: string }>(
      `SELECT encode(nik_ciphertext, 'hex') AS nik, encode(bank_account_ciphertext, 'hex') AS acc, bank_account_last4 AS last4 FROM employee WHERE id = $1`,
      [created.id],
    );
    assert.ok(!row!.nik.includes(Buffer.from('3174012345678901').toString('hex')), 'NIK tidak tersimpan polos');
    assert.equal(decrypt(Buffer.from(row!.nik, 'hex'), TEST_KEYS.dataKey), '3174012345678901');
    assert.equal(row!.last4, '5678');
    await assert.rejects(s.coreHr.createEmployee(actors.hr, { ...input, fullName: 'Orang Lain' }), (e: DomainError) => e.code === 'DUPLICATE_NIK');
    await assert.rejects(s.coreHr.createEmployee(actors.hendra, input), (e: DomainError) => e.kind === 'forbidden');
    await assert.rejects(s.coreHr.createEmployee(actors.hr, { ...input, nik: '123' }), (e: DomainError) => e.code === 'INVALID_NIK');
    await assert.rejects(s.coreHr.createEmployee(actors.hr, { ...input, nik: '3174012345678902', contractEndDate: null }), (e: DomainError) => e.code === 'CONTRACT_END_REQUIRED');
  });

  test('upah berversi + audit tanpa nominal; jenis upah harus sesuai status kerja', async () => {
    await s.coreHr.setCompensation(actors.hr, newId, { effectiveFrom: '2026-11-02', basicSalary: 5_730_000, fixedAllowances: [{ code: 'ALW_POSITION', label: 'Tunjangan tetap', amount: 200_000 }], bpjs: { kesehatan: true, ketenagakerjaan: true, pensiun: true } });
    await s.coreHr.setCompensation(actors.hr, newId, { effectiveFrom: '2027-01-01', basicSalary: 6_000_000, bpjs: { kesehatan: true, ketenagakerjaan: true, pensiun: true } });
    const versions = await s.db.query<{ effective_from: string; basic_salary: number }>(`SELECT effective_from, basic_salary FROM employee_compensation WHERE employee_id = $1 ORDER BY 1`, [newId]);
    assert.deepEqual(versions, [{ effective_from: '2026-11-02', basic_salary: 5_730_000 }, { effective_from: '2027-01-01', basic_salary: 6_000_000 }]);
    const [audit] = await s.db.query<{ diff: Record<string, unknown> }>(`SELECT diff FROM audit_log WHERE action = 'compensation.set' ORDER BY id LIMIT 1`);
    assert.ok(!JSON.stringify(audit!.diff).includes('5730000'), 'nominal gaji tidak masuk audit');
    await assert.rejects(s.coreHr.setCompensation(actors.hr, 'wahyu', { effectiveFrom: '2027-01-01', basicSalary: 5_000_000, bpjs: { kesehatan: false, ketenagakerjaan: true, pensiun: false } }), (e: DomainError) => e.code === 'WAGE_KIND');
    await assert.rejects(s.coreHr.setCompensation(actors.hr, newId, { effectiveFrom: '2027-01-01', basicSalary: 1.5, bpjs: { kesehatan: true, ketenagakerjaan: true, pensiun: true } }), (e: DomainError) => e.code === 'INVALID_AMOUNT');
  });

  test('PIN kiosk: lemah ditolak; reset membuka kunci; kartu tidak boleh dipakai dua orang', async () => {
    await assert.rejects(s.coreHr.setKioskPin(actors.hr, newId, '123456'), (e: DomainError) => e.code === 'WEAK_PIN');
    await assert.rejects(s.coreHr.setKioskPin(actors.hr, newId, '1234'), (e: DomainError) => e.code === 'INVALID_PIN');
    await s.db.execute(`UPDATE employee SET pin_failed_count = 3, pin_locked_until = now() + interval '1 hour' WHERE id = $1`, [newId]);
    await s.coreHr.setKioskPin(actors.hr, newId, '408163');
    const [row] = await s.db.query<{ pin_failed_count: number; locked: boolean }>(`SELECT pin_failed_count, pin_locked_until IS NOT NULL AS locked FROM employee WHERE id = $1`, [newId]);
    assert.deepEqual(row, { pin_failed_count: 0, locked: false });
    await assert.rejects(s.coreHr.setCard(actors.hr, newId, 'CARD-0042'), (e: DomainError) => e.code === 'CARD_IN_USE');
    await s.coreHr.setCard(actors.hr, newId, 'CARD-0122');
  });

  test('offboarding: akhir kerja di masa depan → akun masih aktif sampai job harian menonaktifkan', async () => {
    await s.coreHr.endEmployment(actors.hr, 'sari', '2026-10-31');
    assert.equal(await s.coreHr.deactivateLeavers(), 0);
    s.clock.set('2026-11-01T00:10:00+07:00');
    assert.equal(await s.coreHr.deactivateLeavers(), 1);
    const [u] = await s.db.query<{ active: boolean }>(`SELECT active FROM app_user WHERE id = 'u-sari'`);
    assert.equal(u!.active, false);
    s.clock.set('2026-10-07T05:52:00+07:00');
  });

  test('rantai hash audit utuh setelah serangkaian aksi', async () => {
    const [{ broken }] = (await s.db.query<{ broken: number }>(
      `SELECT count(*)::int AS broken FROM (SELECT hash, lead(prev_hash) OVER (ORDER BY id) AS next_prev FROM audit_log) x WHERE next_prev IS NOT NULL AND next_prev <> hash`,
    )) as [{ broken: number }];
    assert.equal(broken, 0);
  });
});
