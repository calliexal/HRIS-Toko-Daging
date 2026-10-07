import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import type { Role } from '../common/actor';
import { writeAudit } from '../common/audit';
import { loadConfig } from '../common/config';
import { one, type Db } from '../common/db';
import { createPgDb } from '../common/pg-db';
import { encrypt, hashSecret, tokenHash } from '../common/security';

/**
 * `npm run admin -- <perintah> [opsi]` — penyiapan akun dan perangkat kiosk di produksi.
 *
 * Seed demo ditolak di produksi, dan API belum punya endpoint untuk membuat akun atau mendaftarkan kiosk,
 * jadi inilah satu-satunya jalan resmi untuk akun HR pertama. Sandi dan token perangkat dibangkitkan acak
 * dan ditampilkan SEKALI; database hanya menyimpan hash-nya.
 */
const USAGE = `Pemakaian: npm run admin -w @dagingpeople/api-server -- <perintah> [opsi]

  user:create          --email <email> --role <hr|finance|owner|store_manager|employee|super_admin>
                       [--employee <id karyawan>] [--locations <id,id>]
  user:reset-password  --email <email>          (juga membuka kunci login)
  user:deactivate      --email <email>
  kiosk:create         --id <kiosk-id> --location <id lokasi> --name "<nama>" --mode <card|dynamic_qr>
  kiosk:rotate-token   --id <kiosk-id>          (token lama langsung tidak berlaku)
  kiosk:deactivate     --id <kiosk-id>`;

const ROLES: readonly Role[] = ['employee', 'store_manager', 'hr', 'finance', 'owner', 'super_admin'];
const CLI_ACTOR = 'cli';

type Options = Partial<Record<'email' | 'role' | 'employee' | 'locations' | 'id' | 'location' | 'name' | 'mode', string>>;

class UsageError extends Error {}

const required = (opts: Options, key: keyof Options): string => {
  const value = opts[key]?.trim();
  if (!value) throw new UsageError(`Opsi --${key} wajib diisi.`);
  return value;
};

/** 18 byte acak → 24 karakter base64url: cukup kuat, dan aman diketik tanpa karakter yang membingungkan shell. */
const randomSecret = () => randomBytes(18).toString('base64url');

const printSecretOnce = (label: string, value: string) => {
  console.log(`\n${label}: ${value}`);
  console.log('Simpan sekarang di password manager. Nilai ini tidak tersimpan di mana pun dan tidak bisa ditampilkan lagi.\n');
};

const createUser = async (db: Db, opts: Options) => {
  const email = required(opts, 'email').toLowerCase();
  const role = required(opts, 'role') as Role;
  if (!ROLES.includes(role)) throw new UsageError(`Role tidak dikenal: ${role}. Pilihan: ${ROLES.join(', ')}.`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UsageError('Format email tidak valid.');
  const employeeId = opts.employee?.trim() || null;
  const locationIds = (opts.locations ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (role === 'employee' && !employeeId) throw new UsageError('Role employee wajib --employee <id karyawan>.');
  if (role === 'store_manager' && locationIds.length === 0) throw new UsageError('Role store_manager wajib --locations <id lokasi>.');
  if (employeeId && !(await one(db.query('SELECT 1 FROM employee WHERE id = $1 AND end_date IS NULL', [employeeId])))) {
    throw new UsageError(`Karyawan ${employeeId} tidak ditemukan atau sudah keluar.`);
  }
  for (const loc of locationIds) {
    if (!(await one(db.query('SELECT 1 FROM location WHERE id = $1 AND active', [loc])))) throw new UsageError(`Lokasi ${loc} tidak ditemukan.`);
  }

  const password = randomSecret();
  const id = `u-${randomBytes(6).toString('hex')}`;
  await db.transaction(async (tx) => {
    await tx.execute('INSERT INTO app_user (id, email, password_hash, role, employee_id, location_ids) VALUES ($1, $2, $3, $4, $5, $6)', [
      id, email, hashSecret(password), role, employeeId, locationIds,
    ]);
    await writeAudit(tx, { actorId: CLI_ACTOR, action: 'user.create', entity: 'app_user', entityId: id, diff: { role, locations: locationIds.length } });
  });
  console.log(`Akun ${email} (${role}) dibuat dengan id ${id}.`);
  printSecretOnce('Sandi awal', password);
};

const resetPassword = async (db: Db, opts: Options) => {
  const email = required(opts, 'email').toLowerCase();
  const password = randomSecret();
  const row = await one(db.query<{ id: string }>(
    'UPDATE app_user SET password_hash = $2, failed_login_count = 0, login_locked_until = NULL WHERE lower(email) = $1 RETURNING id',
    [email, hashSecret(password)],
  ));
  if (!row) throw new UsageError(`Akun ${email} tidak ditemukan.`);
  await writeAudit(db, { actorId: CLI_ACTOR, action: 'user.reset_password', entity: 'app_user', entityId: row.id });
  console.log(`Sandi ${email} direset dan kunci login dibuka.`);
  printSecretOnce('Sandi baru', password);
};

const deactivateUser = async (db: Db, opts: Options) => {
  const email = required(opts, 'email').toLowerCase();
  const row = await one(db.query<{ id: string }>('UPDATE app_user SET active = FALSE WHERE lower(email) = $1 RETURNING id', [email]));
  if (!row) throw new UsageError(`Akun ${email} tidak ditemukan.`);
  await writeAudit(db, { actorId: CLI_ACTOR, action: 'user.deactivate', entity: 'app_user', entityId: row.id });
  console.log(`Akun ${email} dinonaktifkan. Sesi yang masih terbuka langsung ditolak di request berikutnya.`);
};

const createKiosk = async (db: Db, keys: { dataKey: Buffer; indexKey: Buffer }, opts: Options) => {
  const id = required(opts, 'id');
  const locationId = required(opts, 'location');
  const name = required(opts, 'name');
  const mode = required(opts, 'mode');
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) throw new UsageError('--id hanya huruf, angka, - dan _ (3–40 karakter), mis. kiosk-kemang-1.');
  if (mode !== 'card' && mode !== 'dynamic_qr') throw new UsageError('--mode harus card atau dynamic_qr.');
  if (!(await one(db.query('SELECT 1 FROM location WHERE id = $1 AND active', [locationId])))) throw new UsageError(`Lokasi ${locationId} tidak ditemukan.`);

  const token = randomBytes(32).toString('base64url');
  const qrSecret = mode === 'dynamic_qr' ? encrypt(randomBytes(32).toString('base64'), keys.dataKey).toString('hex') : null;
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO kiosk_device (id, location_id, name, mode, device_token_hash, qr_secret_ciphertext) VALUES ($1, $2, $3, $4, decode($5, 'hex'), decode($6, 'hex'))`,
      [id, locationId, name, mode, tokenHash(token, keys.indexKey).toString('hex'), qrSecret],
    );
    await writeAudit(tx, { actorId: CLI_ACTOR, action: 'kiosk.create', entity: 'kiosk_device', entityId: id, diff: { locationId, mode } });
  });
  console.log(`Kiosk ${id} (${mode}) terdaftar di lokasi ${locationId}.`);
  printSecretOnce('Token perangkat (X-Kiosk-Token)', token);
};

const rotateKioskToken = async (db: Db, keys: { indexKey: Buffer }, opts: Options) => {
  const id = required(opts, 'id');
  const token = randomBytes(32).toString('base64url');
  const row = await one(db.query<{ id: string }>(`UPDATE kiosk_device SET device_token_hash = decode($2, 'hex') WHERE id = $1 RETURNING id`, [id, tokenHash(token, keys.indexKey).toString('hex')]));
  if (!row) throw new UsageError(`Kiosk ${id} tidak ditemukan.`);
  await writeAudit(db, { actorId: CLI_ACTOR, action: 'kiosk.rotate_token', entity: 'kiosk_device', entityId: id });
  console.log(`Token kiosk ${id} diganti. Token lama sudah tidak berlaku.`);
  printSecretOnce('Token perangkat baru (X-Kiosk-Token)', token);
};

const deactivateKiosk = async (db: Db, opts: Options) => {
  const id = required(opts, 'id');
  const row = await one(db.query<{ id: string }>('UPDATE kiosk_device SET active = FALSE WHERE id = $1 RETURNING id', [id]));
  if (!row) throw new UsageError(`Kiosk ${id} tidak ditemukan.`);
  await writeAudit(db, { actorId: CLI_ACTOR, action: 'kiosk.deactivate', entity: 'kiosk_device', entityId: id });
  console.log(`Kiosk ${id} dinonaktifkan (mis. tablet hilang). Daftarkan perangkat pengganti dengan kiosk:create.`);
};

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(['email', 'role', 'employee', 'locations', 'id', 'location', 'name', 'mode'].map((k) => [k, { type: 'string' as const }])),
  });
  const command = positionals[0];
  if (!command) {
    console.log(USAGE);
    return;
  }
  const cfg = loadConfig();
  const { db, close } = createPgDb(cfg.databaseUrl);
  try {
    const opts = values as Options;
    switch (command) {
      case 'user:create':
        return await createUser(db, opts);
      case 'user:reset-password':
        return await resetPassword(db, opts);
      case 'user:deactivate':
        return await deactivateUser(db, opts);
      case 'kiosk:create':
        return await createKiosk(db, cfg, opts);
      case 'kiosk:rotate-token':
        return await rotateKioskToken(db, cfg, opts);
      case 'kiosk:deactivate':
        return await deactivateKiosk(db, opts);
      default:
        throw new UsageError(`Perintah tidak dikenal: ${command}`);
    }
  } finally {
    await close();
  }
};

main().catch((e: unknown) => {
  if (e instanceof UsageError) {
    console.error(`${e.message}\n\n${USAGE}`);
  } else {
    console.error(e instanceof Error ? e.message : e);
  }
  process.exit(1);
});
