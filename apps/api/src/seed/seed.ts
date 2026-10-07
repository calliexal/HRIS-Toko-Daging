import { randomBytes } from 'node:crypto';
import type { Db } from '../common/db';
import { blindIndex, encrypt, hashSecret, tokenHash } from '../common/security';
import { addDays, mondayOf, weekday } from '../common/time';

/**
 * Data contoh yang sama dengan klien mock frontend (PT Daging Prima Nusantara, Outlet Kemang + Gudang).
 * Dipakai untuk demo lokal dan sebagai basis uji service. JANGAN dijalankan di produksi.
 */

export const DEMO_PASSWORD = 'Demo#2026';
export const DEMO_DEVICE_TOKENS = { 'kiosk-kemang-1': 'dev-token-kiosk-kemang-1', 'kiosk-gudang-1': 'dev-token-kiosk-gudang-1' } as const;

type Emp = {
  id: string;
  code: string;
  name: string;
  position: string;
  location: 'kemang' | 'gudang' | 'kantor';
  type: 'PKWTT' | 'PKWT' | 'HARIAN';
  ptkp: string | null;
  basic?: number;
  allowance?: number;
  daily?: number;
  bank?: [string, string];
  shift?: 'P' | 'S' | 'SB';
  pin?: string;
  card?: string;
};

export const DEMO_EMPLOYEES: readonly Emp[] = [
  { id: 'hendra', code: 'DPN-2021-0003', name: 'Hendra Gunawan', position: 'Kepala Toko', location: 'kemang', type: 'PKWTT', ptkp: 'K/2', basic: 8_500_000, allowance: 1_000_000, bank: ['Mandiri', '1270009876543'] },
  { id: 'budi', code: 'DPN-2022-0008', name: 'Budi Santoso', position: 'Butcher', location: 'kemang', type: 'PKWTT', ptkp: 'K/1', basic: 5_900_000, allowance: 300_000, bank: ['Mandiri', '1270001112223'], shift: 'P' },
  { id: 'sari', code: 'DPN-2023-0017', name: 'Sari Wulandari', position: 'Kasir', location: 'kemang', type: 'PKWTT', ptkp: 'TK/0', basic: 5_750_000, allowance: 200_000, bank: ['BCA', '5730012345'], shift: 'S', pin: '111111', card: 'CARD-0017' },
  { id: 'lina', code: 'DPN-2023-0029', name: 'Lina Marlina', position: 'Kasir', location: 'kemang', type: 'PKWTT', ptkp: 'K/0', basic: 5_750_000, allowance: 200_000, bank: ['Mandiri', '1270004445556'], shift: 'S' },
  { id: 'joko', code: 'DPN-2024-0042', name: 'Joko Prasetyo', position: 'Butcher', location: 'kemang', type: 'PKWTT', ptkp: 'TK/0', basic: 5_500_000, allowance: 300_000, bank: ['Mandiri', '1270007788990'], shift: 'P', pin: '123456', card: 'CARD-0042' },
  { id: 'dewi', code: 'DPN-2024-0051', name: 'Dewi Lestari', position: 'Kasir', location: 'kemang', type: 'PKWTT', ptkp: 'TK/1', basic: 5_750_000, allowance: 200_000, bank: ['Mandiri', '1270002223334'], shift: 'S' },
  { id: 'dedi', code: 'DPN-2024-0055', name: 'Dedi Kurniawan', position: 'Juru Sembelih', location: 'gudang', type: 'PKWTT', ptkp: 'K/3', basic: 6_200_000, allowance: 400_000, bank: ['Mandiri', '1270003334445'], shift: 'SB' },
  { id: 'rina', code: 'DPN-2025-0063', name: 'Rina Kusuma', position: 'Pramuniaga', location: 'kemang', type: 'PKWTT', ptkp: 'TK/0', basic: 5_730_000, allowance: 0, bank: ['Mandiri', '1270005556667'], shift: 'P', pin: '222222', card: 'CARD-0063' },
  { id: 'andi', code: 'DPN-2025-0071', name: 'Andi Wijaya', position: 'Butcher', location: 'kemang', type: 'PKWT', ptkp: 'TK/0', basic: 5_730_000, allowance: 0, bank: ['Mandiri', '1270006667778'], shift: 'P' },
  { id: 'fajar', code: 'DPN-2025-0080', name: 'Fajar Nugroho', position: 'Butcher', location: 'kemang', type: 'PKWT', ptkp: null, basic: 5_730_000, allowance: 0, bank: ['Mandiri', '1270007778889'], shift: 'S' },
  { id: 'agus', code: 'DPN-2025-0090', name: 'Agus Setiawan', position: 'Staf Gudang', location: 'gudang', type: 'PKWT', ptkp: 'K/0', basic: 5_730_000, allowance: 150_000, bank: ['Mandiri', '1270008889990'], shift: 'SB', card: 'CARD-0090' },
  { id: 'tono', code: 'DPN-2026-0102', name: 'Tono Saputra', position: 'Pramuniaga', location: 'kemang', type: 'HARIAN', ptkp: 'TK/0', daily: 200_000, bank: ['Mandiri', '1270009990001'], shift: 'P' },
  { id: 'yusuf', code: 'DPN-2026-0110', name: 'Yusuf Hakim', position: 'Butcher', location: 'kemang', type: 'HARIAN', ptkp: 'TK/0', daily: 210_000, bank: ['Mandiri', '1270000001112'], shift: 'S' },
  { id: 'wahyu', code: 'DPN-2026-0121', name: 'Wahyu Hidayat', position: 'Staf Gudang', location: 'gudang', type: 'HARIAN', ptkp: 'TK/0', daily: 180_000, bank: ['Mandiri', '1270001113335'], shift: 'SB' },
];

const JOIN: Record<string, string> = { '2021': '2021-03-01', '2022': '2022-02-14', '2023': '2023-06-05', '2024': '2024-01-15', '2025': '2025-04-07', '2026': '2026-07-01' };

export type SeedOptions = {
  /** Jadwal terbit untuk rentang tanggal ini (Senin–Sabtu sesuai shift karyawan, Minggu libur). */
  scheduleFrom?: string;
  scheduleTo?: string;
};

export const seedDemo = async (db: Db, keys: { dataKey: Buffer; indexKey: Buffer }, options: SeedOptions = {}) => {
  const pwd = hashSecret(DEMO_PASSWORD);
  await db.transaction(async (tx) => {
    await tx.execute(`INSERT INTO legal_entity (id, name, npwp) VALUES ('dpn', 'PT Daging Prima Nusantara', '01.234.567.8-012.000')`);
    await tx.execute(
      `INSERT INTO location (id, legal_entity_id, name, type, lat, lng, radius_m, region_code, jkk_risk) VALUES
         ('kemang', 'dpn', 'Outlet Kemang', 'outlet', -6.260700, 106.813700, 100, 'DKI_JAKARTA', 'low'),
         ('gudang', 'dpn', 'Gudang & Cold Storage', 'gudang', -6.183000, 106.942000, 150, 'DKI_JAKARTA', 'medium'),
         ('kantor', 'dpn', 'Kantor Pusat', 'kantor', -6.225000, 106.809000, 80, 'DKI_JAKARTA', 'very_low')`,
    );
    await tx.execute(
      `INSERT INTO shift_template (location_id, code, name, start_time, end_time, min_staff) VALUES
         ('kemang', 'P', 'Pagi', '06:00', '14:00', 3), ('kemang', 'S', 'Siang', '13:00', '21:00', 2),
         ('gudang', 'SB', 'Subuh', '03:00', '11:00', 2), ('gudang', 'P', 'Pagi', '06:00', '14:00', 1)`,
    );
    await tx.execute(`INSERT INTO holiday (date, name) VALUES ('2026-12-25', 'Hari Raya Natal'), ('2027-01-01', 'Tahun Baru Masehi'), ('2026-08-17', 'Hari Kemerdekaan RI')`);

    for (const [i, e] of DEMO_EMPLOYEES.entries()) {
      const nik = `3174${String(100_000_000_000 + i * 7_919)}`;
      const join = JOIN[e.code.slice(4, 8)]!;
      await tx.execute(
        `INSERT INTO employee (id, code, legal_entity_id, location_id, full_name, position, employment_type, ptkp_status, join_date, contract_end_date,
                               nik_ciphertext, nik_blind_index, bank_name, bank_account_ciphertext, bank_account_last4, kiosk_pin_hash, card_token_hash)
         VALUES ($1, $2, 'dpn', $3, $4, $5, $6, $7, $8::date, $9::date, decode($10, 'hex'), decode($11, 'hex'), $12, decode($13, 'hex'), $14, $15, decode($16, 'hex'))`,
        [
          e.id, e.code, e.location, e.name, e.position, e.type, e.ptkp, join, e.type === 'PKWT' ? '2027-06-30' : null,
          encrypt(nik, keys.dataKey).toString('hex'), blindIndex(nik, keys.indexKey).toString('hex'),
          e.bank?.[0] ?? null, e.bank ? encrypt(e.bank[1], keys.dataKey).toString('hex') : null, e.bank ? e.bank[1].slice(-4) : null,
          e.pin ? hashSecret(e.pin) : null, e.card ? tokenHash(e.card, keys.indexKey).toString('hex') : null,
        ],
      );
      await tx.execute(
        `INSERT INTO employee_compensation (employee_id, effective_from, basic_salary, daily_wage, fixed_allowances, bpjs_kesehatan, bpjs_pensiun, created_by)
         VALUES ($1, $2::date, $3, $4, $5::jsonb, $6, $7, 'seed')`,
        [
          e.id, join, e.basic ?? null, e.daily ?? null,
          JSON.stringify(e.allowance ? [{ code: 'ALW_POSITION', label: 'Tunjangan tetap', amount: e.allowance }] : []),
          // Harian lepas: BPJS Ketenagakerjaan saja (JKK, JKM, JHT); Kesehatan & JP menunggu keputusan kebijakan.
          e.type !== 'HARIAN', e.type !== 'HARIAN',
        ],
      );
      await tx.execute('INSERT INTO leave_entitlement (employee_id, year, annual_days) VALUES ($1, 2026, 12), ($1, 2027, 12)', [e.id]);
    }

    await tx.execute(
      `INSERT INTO app_user (id, email, password_hash, role, employee_id, location_ids) VALUES
         ('u-hr', 'hr@dagingprima.co.id', $1, 'hr', NULL, '{}'),
         ('u-owner', 'owner@dagingprima.co.id', $1, 'owner', NULL, '{}'),
         ('u-finance', 'finance@dagingprima.co.id', $1, 'finance', NULL, '{}'),
         ('u-hendra', 'hendra@dagingprima.co.id', $1, 'store_manager', 'hendra', '{kemang}'),
         ('u-joko', 'joko@dagingprima.co.id', $1, 'employee', 'joko', '{}'),
         ('u-sari', 'sari@dagingprima.co.id', $1, 'employee', 'sari', '{}'),
         ('u-agus', 'agus@dagingprima.co.id', $1, 'employee', 'agus', '{}')`,
      [pwd],
    );

    const qrSecret = randomBytes(32).toString('base64');
    await tx.execute(
      `INSERT INTO kiosk_device (id, location_id, name, mode, device_token_hash, qr_secret_ciphertext) VALUES
         ('kiosk-kemang-1', 'kemang', 'Kiosk Kasir Kemang', 'card', decode($1, 'hex'), NULL),
         ('kiosk-gudang-1', 'gudang', 'Kiosk Pintu Gudang', 'dynamic_qr', decode($2, 'hex'), decode($3, 'hex'))`,
      [
        tokenHash(DEMO_DEVICE_TOKENS['kiosk-kemang-1'], keys.indexKey).toString('hex'),
        tokenHash(DEMO_DEVICE_TOKENS['kiosk-gudang-1'], keys.indexKey).toString('hex'),
        encrypt(qrSecret, keys.dataKey).toString('hex'),
      ],
    );

    // Cuti tahunan Joko yang sudah disetujui (saldo 12 − 3 = 9, sama dengan mock).
    await tx.execute(
      `INSERT INTO leave_request (employee_id, type, start_date, end_date, working_days, reason, status, decided_by, decided_at)
       VALUES ('joko', 'annual', '2026-03-02', '2026-03-04', 3, 'Pulang kampung', 'approved', 'u-hendra', '2026-02-20T10:00:00+07')`,
    );

    if (options.scheduleFrom && options.scheduleTo) await seedSchedule(tx, options.scheduleFrom, options.scheduleTo);
  });
};

/** Jadwal sederhana: tiap karyawan shift tetap Senin–Sabtu, Minggu libur; minggu yang tercakup langsung terbit. */
export const seedSchedule = async (db: Db, from: string, to: string) => {
  const values: string[] = [];
  const params: unknown[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const e of DEMO_EMPLOYEES) {
      if (!e.shift) continue;
      params.push(e.id, d, e.location, weekday(d) === 0 ? 'OFF' : e.shift);
      const n = params.length;
      values.push(`($${n - 3}, $${n - 2}::date, $${n - 1}, $${n}, 'seed')`);
    }
  }
  for (let i = 0; i < values.length; i += 400) {
    const chunk = values.slice(i, i + 400);
    const offset = i * 4;
    const sql = chunk.map((v) => v.replace(/\$(\d+)/g, (_, k: string) => `$${Number(k) - offset}`)).join(', ');
    await db.execute(
      `INSERT INTO schedule_entry (employee_id, work_date, location_id, cell, updated_by) VALUES ${sql}
       ON CONFLICT (employee_id, work_date) DO UPDATE SET cell = EXCLUDED.cell`,
      params.slice(offset, offset + chunk.length * 4),
    );
  }
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
    await db.execute(
      `INSERT INTO schedule_week (location_id, week_start, status, published_at, published_by)
       SELECT id, $1::date, 'published', now(), 'seed' FROM location WHERE id IN ('kemang', 'gudang')
       ON CONFLICT (location_id, week_start) DO UPDATE SET status = 'published', published_at = now()`,
      [w],
    );
  }
};
