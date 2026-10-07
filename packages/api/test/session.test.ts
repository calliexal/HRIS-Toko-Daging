import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionStore, type SessionPersistence } from '../src/session';
import type { LoginResult } from '../src/types';

const result: LoginResult = {
  token: 'jwt',
  expiresInSeconds: 3600,
  user: { id: 'u-joko', name: 'Joko', email: 'joko@dagingprima.co.id', role: 'employee', employeeId: 'joko', locationIds: [] },
};
const memory = (initial: string | null = null): SessionPersistence & { value: string | null } => {
  const p = {
    value: initial,
    read: async () => p.value,
    write: async (v: string | null) => {
      p.value = v;
    },
  };
  return p;
};

test('login menyimpan sesi; hydrate memulihkan sesi yang masih berlaku', async () => {
  let now = 1_000_000;
  const p = memory();
  const a = createSessionStore({ persistence: p, now: () => now });
  await a.hydrate();
  a.start(result);
  assert.equal(a.token(), 'jwt');
  await new Promise((r) => setTimeout(r, 0));
  const b = createSessionStore({ persistence: p, now: () => now });
  assert.equal(b.getSnapshot().ready, false, 'belum siap sebelum hydrate (tanpa kilasan layar login)');
  await b.hydrate();
  assert.equal(b.getSnapshot().session?.user.id, 'u-joko');
  now += 3600_000;
  assert.equal(b.token(), null, 'token kedaluwarsa tidak dipakai');
  assert.equal(b.getSnapshot().endReason, 'expired');
});

test('data rusak / kedaluwarsa di penyimpanan dibuang', async () => {
  const p = memory('{"token":1}');
  const s = createSessionStore({ persistence: p });
  await s.hydrate();
  assert.equal(s.getSnapshot().session, null);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(p.value, null);
});

test('401 saat belum login tidak menimpa alasan; keluar menghapus penyimpanan', async () => {
  const p = memory();
  const s = createSessionStore({ persistence: p });
  await s.hydrate();
  s.end('unauthenticated');
  assert.equal(s.getSnapshot().endReason, null);
  s.start(result);
  let notified = 0;
  s.subscribe(() => notified++);
  s.end('logout');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([s.getSnapshot().session, s.getSnapshot().endReason, p.value, notified], [null, 'logout', null, 1]);
});

test('penyimpanan gagal tidak menggagalkan login', async () => {
  const s = createSessionStore({ persistence: { read: async () => { throw new Error('x'); }, write: async () => { throw new Error('x'); } } });
  await s.hydrate();
  s.start(result);
  assert.equal(s.token(), 'jwt');
});
