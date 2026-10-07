import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedDemo } from '../../src/seed/seed';
import { psqlCommand as psql, TEMPLATE_DB, TEST_KEYS } from './env';
import { PsqlDb } from './psql-db';

/** Membangun ulang template uji: semua migrasi + seed demo. Dijalankan sekali sebelum `tsx --test`. */
const migrations = join(import.meta.dirname, '../../db/migrations');
psql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`]);
psql(['-d', 'postgres', '-c', `CREATE DATABASE ${TEMPLATE_DB}`]);
for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) psql(['-d', TEMPLATE_DB, '-f', join(migrations, f)]);

const db = new PsqlDb(TEMPLATE_DB);
await seedDemo(db, TEST_KEYS, { scheduleFrom: '2026-08-24', scheduleTo: '2026-10-18' });
await db.close();
console.log(`Template ${TEMPLATE_DB} siap.`);
