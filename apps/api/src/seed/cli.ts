import { loadConfig } from '../common/config';
import { createPgDb } from '../common/pg-db';
import { addDays, localDate, mondayOf } from '../common/time';
import { seedDemo } from './seed';

/** `npm run seed` — data demo untuk lingkungan lokal/staging. Ditolak bila NODE_ENV=production. */
if (process.env.NODE_ENV === 'production') {
  console.error('Seed demo tidak boleh dijalankan di produksi.');
  process.exit(1);
}
const cfg = loadConfig();
const { db, close } = createPgDb(cfg.databaseUrl);
const monday = mondayOf(localDate(new Date()));
await seedDemo(db, { dataKey: cfg.dataKey, indexKey: cfg.indexKey }, { scheduleFrom: addDays(monday, -42), scheduleTo: addDays(monday, 13) });
await close();
console.info('Seed demo selesai. Login: hr@dagingprima.co.id / Demo#2026');
