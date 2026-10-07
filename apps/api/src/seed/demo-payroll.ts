import type { Actor } from '../common/actor';
import { systemClock } from '../common/clock';
import { loadConfig } from '../common/config';
import { one } from '../common/db';
import { createPgDb } from '../common/pg-db';
import { buildServices } from '../app/container';

/**
 * `npm run seed:payroll` — data demo payroll September 2026 (26 Agu – 25 Sep), dijalankan SETELAH `npm run seed`.
 *
 * Skenarionya sama dengan uji payroll (test/payroll.test.ts): semua shift terjadwal hadir, Budi mangkir 9 Sep,
 * Joko lembur 6x yang disetujui + 1 yang belum disetujui (tidak dibayar). Periode dikunci absensinya lalu dihitung,
 * berhenti di tahap "Review HR" agar alur Kirim → Setujui (Owner) → Kunci bisa diperagakan.
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Seed demo tidak boleh dijalankan di produksi.');
  process.exit(1);
}

const PERIOD = '2026-09';
const FROM = '2026-08-26';
const TO = '2026-09-25';
const HR: Actor = { userId: 'u-hr', role: 'hr', employeeId: null, locationIds: [] };
const OVERTIME_DATES = ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17'];

const cfg = loadConfig();
const { db, close } = createPgDb(cfg.databaseUrl);
try {
  const existing = await one(db.query<{ status: string }>('SELECT status FROM payroll_period WHERE legal_entity_id = $1 AND period = $2', [cfg.legalEntityId, PERIOD]));
  if (existing) {
    console.log(`Payroll ${PERIOD} sudah ada (status ${existing.status}); tidak diubah.`);
  } else {
    await db.transaction(async (tx) => {
      await tx.execute(`UPDATE schedule_entry SET cell = 'OFF' WHERE employee_id = 'joko' AND work_date = '2026-09-19'`);
      // Absen masuk 5 menit sebelum shift dan pulang tepat waktu untuk setiap shift terjadwal, kecuali Budi 9 Sep.
      for (const [direction, at] of [['in', `st.start_time - interval '5 minutes'`], ['out', 'st.end_time']] as const) {
        await tx.execute(
          `INSERT INTO attendance_event (employee_id, client_uuid, direction, method, location_id, event_time, work_date, status)
           SELECT se.employee_id, gen_random_uuid(), $1, 'app_gps', se.location_id, ((se.work_date + ${at}) AT TIME ZONE 'Asia/Jakarta'), se.work_date, 'recorded'
             FROM schedule_entry se JOIN shift_template st ON st.location_id = se.location_id AND st.code = se.cell
            WHERE se.work_date BETWEEN $2::date AND $3::date
              AND NOT (se.employee_id = 'budi' AND se.work_date = '2026-09-09')`,
          [direction, FROM, TO],
        );
      }
      for (const date of OVERTIME_DATES) {
        await tx.execute(
          `INSERT INTO overtime_order (employee_id, work_date, hours, day_type, reason, status, requested_by, decided_by)
           VALUES ('joko', $1::date, 1, 'workday', 'Bongkar kiriman sapi', 'approved', 'u-hendra', 'u-hr')`,
          [date],
        );
      }
      await tx.execute(
        `INSERT INTO overtime_order (employee_id, work_date, hours, day_type, reason, requested_by) VALUES ('joko', '2026-09-22', 2, 'workday', 'Stok opname', 'u-hendra')`,
      );
    });

    const services = buildServices(db, systemClock, cfg);
    const id = await services.payroll.ensurePeriod(HR, cfg.legalEntityId, PERIOD);
    await services.payroll.lockAttendance(HR, id);
    const run = await services.payroll.calculate(HR, id);
    const joko = run.rows.find((r) => r.employee.id === 'joko');
    console.log(`Payroll ${PERIOD} dihitung: ${run.rows.length} karyawan, menunggu Review HR. THP Joko: Rp${joko?.takeHome.toLocaleString('id-ID') ?? '-'}.`);
  }
} finally {
  await close();
}
