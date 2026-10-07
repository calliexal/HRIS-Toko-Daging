import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DomainError } from '../src/common/errors';
import { actors, freshDb, type Services } from './support/env';

let s: Services;
before(async () => {
  s = await freshDb();
});
after(async () => s.close());

const WEEK = '2026-10-12'; // Senin minggu depan

describe('SHF-01 jadwal shift', () => {
  test('minggu terbit tampil lengkap: 10 karyawan, Pagi butuh 3 orang', async () => {
    const week = await s.scheduling.getWeek(actors.hendra, 'kemang', WEEK);
    assert.equal(week.status, 'published');
    assert.equal(week.days.length, 7);
    assert.equal(week.rows.length, 11, 'termasuk Kepala Toko tanpa jadwal');
    const pagi = week.coverage.find((c) => c.shift === 'P')!;
    assert.equal(pagi.required, 3);
    assert.equal(pagi.filled[0], 5);
    assert.equal(pagi.filled[6], 0, 'Minggu libur');
  });

  test('ubah sel → minggu kembali draf; kurang orang memunculkan peringatan yang wajib dikonfirmasi saat terbit', async () => {
    // Senin: pindahkan 3 dari 5 orang Pagi ke Libur → Pagi tinggal 2 dari 3.
    for (const id of ['budi', 'rina', 'andi']) await s.scheduling.updateCell(actors.hendra, 'kemang', WEEK, id, 0, 'OFF');
    const week = await s.scheduling.getWeek(actors.hendra, 'kemang', WEEK);
    assert.equal(week.status, 'draft');
    assert.ok(week.warnings.some((w) => /Pagi/.test(w)), week.warnings.join(' | '));
    await assert.rejects(s.scheduling.publish(actors.hendra, 'kemang', WEEK, 0), (e: DomainError) => e.code === 'UNACKNOWLEDGED_WARNINGS');
    const published = await s.scheduling.publish(actors.hendra, 'kemang', WEEK, week.warnings.length);
    assert.equal(published.status, 'published');
  });

  test('shift yang tidak ada di lokasi & lokasi lain ditolak', async () => {
    await assert.rejects(s.scheduling.updateCell(actors.hendra, 'kemang', WEEK, 'joko', 1, 'SB'), (e: DomainError) => e.code === 'SHIFT_NOT_AVAILABLE');
    await assert.rejects(s.scheduling.updateCell(actors.hendra, 'gudang', WEEK, 'agus', 1, 'P'), (e: DomainError) => e.kind === 'forbidden');
    await assert.rejects(s.scheduling.updateCell(actors.hendra, 'kemang', '2026-10-13', 'joko', 1, 'P'), (e: DomainError) => e.kind === 'validation');
  });

  test('karyawan melihat jadwalnya sendiri', async () => {
    const mine = await s.scheduling.myWeek(actors.joko, WEEK);
    assert.equal(mine.days.length, 7);
  });
});

describe('LV-01 cuti & izin', () => {
  let leaveId = '';

  test('saldo awal Joko 9 hari (12 − 3 terpakai); pratinjau Senin–Minggu = 6 hari kerja', async () => {
    assert.deepEqual(await s.leave.balance(actors.joko), { annualRemaining: 9, annualEntitlement: 12 });
    const p = await s.leave.preview(actors.joko, { type: 'annual', startDate: '2026-10-19', endDate: '2026-10-25' });
    assert.equal(p.workingDays, 6, 'Senin–Minggu = 6 hari kerja (pola 6 hari)');
    assert.equal(p.balanceAfter, 3);
    assert.equal(p.approverName, 'Hendra Gunawan (Kepala Toko)');
  });

  test('aturan pengajuan: saldo kurang, sakit > 1 hari tanpa surat, tanggal libur', async () => {
    await assert.rejects(s.leave.submit(actors.joko, { type: 'annual', startDate: '2026-10-19', endDate: '2026-10-31', reason: 'Liburan' }), (e: DomainError) => e.code === 'INSUFFICIENT_BALANCE');
    await assert.rejects(s.leave.submit(actors.joko, { type: 'sick', startDate: '2026-10-19', endDate: '2026-10-20', reason: 'Demam' }), (e: DomainError) => e.code === 'ATTACHMENT_REQUIRED');
    await assert.rejects(s.leave.submit(actors.joko, { type: 'permit', startDate: '2026-10-18', endDate: '2026-10-18', reason: 'Acara' }), (e: DomainError) => e.code === 'NO_WORKING_DAYS');
  });

  test('ajukan 3 hari → saldo ditahan, muncul di inbox Kepala Toko dengan dampak jadwal; tumpang tindih ditolak', async () => {
    const r = await s.leave.submit(actors.joko, { type: 'annual', startDate: '2026-10-12', endDate: '2026-10-14', reason: 'Acara keluarga' });
    leaveId = r.id;
    assert.equal((await s.leave.balance(actors.joko)).annualRemaining, 6);
    await assert.rejects(s.leave.submit(actors.joko, { type: 'permit', startDate: '2026-10-14', endDate: '2026-10-14', reason: 'x' }), (e: DomainError) => e.code === 'LEAVE_OVERLAP');

    const inbox = await s.approvals.list(actors.hendra, 'leave');
    const item = inbox.find((i) => i.id === leaveId)!;
    assert.equal(item.summary, 'Cuti tahunan · Sen 12–Rab 14 Okt');
    assert.equal(item.details.find((d) => d.label === 'Saldo')?.value, '9 → 6 hari');
    assert.match(item.scheduleImpact ?? '', /Shift Pagi 12\/10 akan terisi 1 dari 3 orang/);
    assert.equal((await s.approvals.list(actors.joko as never).catch((e: DomainError) => e.kind)), 'forbidden');
  });

  test('disetujui → sel jadwal menjadi Cuti dan terkunci', async () => {
    await s.approvals.decide(actors.hendra, 'leave', leaveId, 'approve');
    const week = await s.scheduling.getWeek(actors.hendra, 'kemang', WEEK);
    assert.deepEqual(week.rows.find((r) => r.employee.id === 'joko')!.cells.slice(0, 4), ['LEAVE', 'LEAVE', 'LEAVE', 'P']);
    await assert.rejects(s.scheduling.updateCell(actors.hendra, 'kemang', WEEK, 'joko', 0, 'P'), (e: DomainError) => e.code === 'CELL_ON_LEAVE');
    await assert.rejects(s.approvals.decide(actors.hendra, 'leave', leaveId, 'approve'), (e: DomainError) => e.kind === 'not_found');
  });

  test('putuskan lewat id saja (kontrak HrisClient) → snapshot dengan status baru', async () => {
    const r = await s.leave.submit(actors.sari, { type: 'permit', startDate: '2026-10-22', endDate: '2026-10-22', reason: 'Antar anak vaksin' });
    const decided = await s.approvals.decideById(actors.hendra, r.id, 'approve');
    assert.equal(decided.status, 'approved');
    assert.equal(decided.kind, 'leave');
    assert.equal(decided.employee.name, 'Sari Wulandari');
    await assert.rejects(s.approvals.decideById(actors.hendra, r.id, 'approve'), (e: DomainError) => e.code === 'APPROVAL_NOT_FOUND');
  });

  test('cuti melewati Minggu tidak mengisi sel Libur', async () => {
    const r = await s.leave.submit(actors.sari, { type: 'annual', startDate: '2026-10-17', endDate: '2026-10-19', reason: 'Mudik' });
    await s.approvals.decide(actors.hendra, 'leave', r.id, 'approve');
    const rows = await s.db.query<{ work_date: string; cell: string }>(`SELECT work_date, cell FROM schedule_entry WHERE employee_id = 'sari' AND work_date BETWEEN '2026-10-17' AND '2026-10-19' ORDER BY 1`);
    assert.deepEqual(rows.map((x) => x.cell), ['LEAVE', 'OFF', 'LEAVE']);
  });

  test('tolak wajib catatan; Kepala Toko tidak bisa menyetujui pengajuannya sendiri', async () => {
    const r = await s.leave.submit(actors.hendra, { type: 'permit', startDate: '2026-10-20', endDate: '2026-10-20', reason: 'Urus SIM' });
    assert.equal((await s.approvals.list(actors.hendra, 'leave')).some((i) => i.id === r.id), false, 'pengajuan sendiri tidak tampil');
    await assert.rejects(s.leave.decide(actors.hendra, r.id, 'approve'), (e: DomainError) => e.kind === 'forbidden');
    await assert.rejects(s.leave.decide(actors.hr, r.id, 'reject'), (e: DomainError) => e.code === 'NOTE_REQUIRED');
    assert.equal((await s.leave.decide(actors.hr, r.id, 'reject', 'Bentrok stok opname')).status, 'rejected');
  });

  test('eskalasi: ≥ 48 jam tanpa keputusan → HR (level 2), Kepala Toko tidak bisa lagi memutuskan', async () => {
    const r = await s.leave.submit(actors.sari, { type: 'permit', startDate: '2026-10-21', endDate: '2026-10-21', reason: 'Kontrol gigi' });
    s.clock.advance(25 * 3600_000);
    assert.deepEqual(await s.leave.runEscalation(), { remind: [r.id], escalated: [] });
    s.clock.advance(24 * 3600_000);
    assert.deepEqual((await s.leave.runEscalation()).escalated, [r.id]);
    const inbox = await s.approvals.list(actors.hr, 'leave');
    assert.equal(inbox.find((i) => i.id === r.id)?.escalated, true);
    await assert.rejects(s.leave.decide(actors.hendra, r.id, 'approve'), (e: DomainError) => e.kind === 'forbidden');
    assert.equal((await s.leave.decide(actors.hr, r.id, 'approve')).status, 'approved');
    s.clock.set('2026-10-07T05:52:00+07:00');
  });
});
