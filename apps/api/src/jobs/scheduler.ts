import PgBoss from 'pg-boss';
import type { AppServices } from '../app/container';

/**
 * Job terjadwal di atas pg-boss (antrean di Postgres yang sama; ADR: tanpa Redis).
 *  - leave-escalation (tiap jam): pengingat ≥ 24 jam, eskalasi ke HR ≥ 48 jam (LV-01 AC3).
 *  - deactivate-leavers (harian 00.10 WIB): nonaktifkan akun karyawan yang hari terakhirnya sudah lewat.
 * Notifikasi (push/WA) belum disambungkan: hasil job dicatat ke log sebagai titik integrasi.
 */
export const startJobs = async (databaseUrl: string, svc: AppServices) => {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
  boss.on('error', (e: Error) => console.error('[pg-boss]', e));
  await boss.start();

  await boss.createQueue('leave-escalation');
  await boss.schedule('leave-escalation', '5 * * * *', {}, { tz: 'Asia/Jakarta' });
  await boss.work('leave-escalation', async () => {
    const r = await svc.leave.runEscalation();
    if (r.remind.length || r.escalated.length) console.info('[leave-escalation]', { remind: r.remind.length, escalated: r.escalated.length });
  });

  await boss.createQueue('deactivate-leavers');
  await boss.schedule('deactivate-leavers', '10 0 * * *', {}, { tz: 'Asia/Jakarta' });
  await boss.work('deactivate-leavers', async () => {
    const n = await svc.coreHr.deactivateLeavers();
    if (n > 0) console.info('[deactivate-leavers]', n);
  });

  return { stop: () => boss.stop({ graceful: true }) };
};
