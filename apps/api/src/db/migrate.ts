import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Menjalankan migrasi SQL yang belum diterapkan (urut nama file). Tiap file punya BEGIN/COMMIT sendiri
 * dan mencatat versinya di schema_migration. Aman dijalankan berulang.
 */
const dir = join(import.meta.dirname, '../../db/migrations');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
// Container menjalankan migrasi setiap kali start; kunci ini mencegah dua instance (mis. saat rolling deploy)
// menerapkan file yang sama bersamaan. Kunci dilepas otomatis saat koneksi ditutup.
await client.query(`SELECT pg_advisory_lock(hashtext('dagingpeople_migrate'))`);
try {
  const exists = (await client.query(`SELECT to_regclass('schema_migration') IS NOT NULL AS ok`)).rows[0].ok as boolean;
  const applied = new Set<string>(exists ? (await client.query('SELECT version FROM schema_migration')).rows.map((r: { version: string }) => r.version) : []);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    console.info(`→ ${file}`);
    await client.query(readFileSync(join(dir, file), 'utf8'));
  }
  console.info('Migrasi selesai.');
} finally {
  await client.end();
}
