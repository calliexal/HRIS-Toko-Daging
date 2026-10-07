import type { Location, Me } from '@dagingpeople/contracts';
import { requireEmployee, requireRole, type Actor } from '../../common/actor';
import { writeAudit } from '../../common/audit';
import type { Clock } from '../../common/clock';
import { DbError, one, type Db } from '../../common/db';
import { conflict, notFound, validation } from '../../common/errors';
import { blindIndex, encrypt, hashSecret, tokenHash } from '../../common/security';
import { localDate } from '../../common/time';
import { toEmployee } from '../attendance/attendance.service';

export type EmployeeInput = {
  fullName: string;
  nik: string;
  locationId: string;
  position: string;
  employmentType: 'PKWTT' | 'PKWT' | 'HARIAN';
  workPattern?: '6_DAY' | '5_DAY';
  ptkpStatus?: 'TK/0' | 'TK/1' | 'TK/2' | 'TK/3' | 'K/0' | 'K/1' | 'K/2' | 'K/3' | null;
  joinDate: string;
  contractEndDate?: string | null;
  bank?: { name: string; accountNumber: string } | null;
};

export type CompensationInput = {
  effectiveFrom: string;
  basicSalary?: number | null;
  dailyWage?: number | null;
  fixedAllowances?: { code: string; label: string; amount: number }[];
  bpjs: { kesehatan: boolean; ketenagakerjaan: boolean; pensiun: boolean };
};

type LocationRow = { id: string; name: string; type: Location['type']; radius_m: number };
const toLocation = (r: LocationRow): Location => ({ id: r.id, name: r.name, type: r.type, radiusM: r.radius_m });

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isRupiah = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Data karyawan & organisasi (HR-01). NIK dan nomor rekening disimpan terenkripsi; keunikan NIK lewat blind index. */
export class CoreHrService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly keys: { dataKey: Buffer; indexKey: Buffer },
  ) {}

  async getMe(actor: Actor): Promise<Me> {
    const employeeId = requireEmployee(actor);
    const row = await one(this.db.query<{ id: string; code: string; full_name: string; position: string; location_id: string; employment_type: Me['employmentType'] } & { l_id: string; l_name: string; l_type: Location['type']; l_radius: number }>(
      `SELECT e.id, e.code, e.full_name, e.position, e.location_id, e.employment_type,
              l.id AS l_id, l.name AS l_name, l.type AS l_type, l.radius_m AS l_radius
         FROM employee e JOIN location l ON l.id = e.location_id WHERE e.id = $1`,
      [employeeId],
    ));
    if (!row) throw notFound('EMPLOYEE_NOT_FOUND', 'Data karyawan tidak ditemukan. Hubungi HR.');
    return {
      ...toEmployee(row),
      location: toLocation({ id: row.l_id, name: row.l_name, type: row.l_type, radius_m: row.l_radius }),
      greetingName: row.full_name.split(' ')[0]!,
    };
  }

  /** Kepala Toko hanya melihat lokasinya (SEC-01). */
  async listLocations(actor: Actor): Promise<Location[]> {
    requireRole(actor, 'store_manager', 'hr', 'finance', 'owner', 'super_admin');
    const rows = await this.db.query<LocationRow>(
      `SELECT id, name, type, radius_m FROM location WHERE active AND ($1::text[] = '{}' OR id = ANY($1::text[])) ORDER BY type, name`,
      [actor.role === 'store_manager' ? [...actor.locationIds] : []],
    );
    return rows.map(toLocation);
  }

  /** HR-01: nomor karyawan DPN-<tahun masuk>-<urut global 4 digit>. NIK unik (AC2). */
  async createEmployee(actor: Actor, input: EmployeeInput): Promise<{ id: string; code: string }> {
    requireRole(actor, 'hr');
    const nik = input.nik.replace(/\s/g, '');
    if (!/^\d{16}$/.test(nik)) throw validation('INVALID_NIK', 'NIK harus 16 digit angka sesuai KTP.');
    if (!input.fullName.trim()) throw validation('NAME_REQUIRED', 'Nama lengkap wajib diisi.');
    if (!isDate(input.joinDate)) throw validation('INVALID_DATE', 'Tanggal masuk tidak valid.');
    if (input.employmentType === 'PKWT' && !input.contractEndDate) throw validation('CONTRACT_END_REQUIRED', 'Karyawan kontrak (PKWT) wajib punya tanggal akhir kontrak.');
    if (input.contractEndDate && input.contractEndDate < input.joinDate) throw validation('INVALID_CONTRACT_END', 'Akhir kontrak tidak boleh sebelum tanggal masuk.');
    if (input.bank && !/^\d{6,20}$/.test(input.bank.accountNumber)) throw validation('INVALID_ACCOUNT', 'Nomor rekening hanya angka (6–20 digit).');

    const location = await one(this.db.query<{ legal_entity_id: string }>('SELECT legal_entity_id FROM location WHERE id = $1 AND active', [input.locationId]));
    if (!location) throw validation('INVALID_LOCATION', 'Lokasi kerja tidak ditemukan.');

    try {
      return await this.db.transaction(async (tx) => {
        // Kunci transaksi agar dua HR yang menyimpan bersamaan tidak mendapat nomor sama.
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext('employee_code'))`);
        const next = await one(tx.query<{ seq: number }>(`SELECT (coalesce(max(substr(code, 10)::int), 0) + 1)::int AS seq FROM employee`));
        const code = `DPN-${input.joinDate.slice(0, 4)}-${String(next!.seq).padStart(4, '0')}`;
        const id = `emp-${code.slice(4).replace('-', '')}`;
        await tx.execute(
          `INSERT INTO employee (id, code, legal_entity_id, location_id, full_name, position, employment_type, work_pattern, ptkp_status, join_date, contract_end_date,
                                 nik_ciphertext, nik_blind_index, bank_name, bank_account_ciphertext, bank_account_last4)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, decode($12, 'hex'), decode($13, 'hex'), $14, decode($15, 'hex'), $16)`,
          [
            id, code, location.legal_entity_id, input.locationId, input.fullName.trim(), input.position.trim(), input.employmentType, input.workPattern ?? '6_DAY',
            input.ptkpStatus ?? null, input.joinDate, input.contractEndDate ?? null,
            encrypt(nik, this.keys.dataKey).toString('hex'), blindIndex(nik, this.keys.indexKey).toString('hex'),
            input.bank?.name ?? null, input.bank ? encrypt(input.bank.accountNumber, this.keys.dataKey).toString('hex') : null, input.bank ? input.bank.accountNumber.slice(-4) : null,
          ],
        );
        await writeAudit(tx, { actorId: actor.userId, action: 'employee.create', entity: 'employee', entityId: id, diff: { code, locationId: input.locationId, employmentType: input.employmentType } });
        return { id, code };
      });
    } catch (e) {
      if (e instanceof DbError && e.sqlState === '23505' && /nik_blind_index/.test(e.message)) {
        throw conflict('DUPLICATE_NIK', 'NIK ini sudah terdaftar untuk karyawan lain. Cek data karyawan yang ada.');
      }
      throw e;
    }
  }

  /** Perubahan upah = versi baru berlaku mulai tanggal tertentu, tidak menimpa versi lama (audit + perhitungan ulang historis). */
  async setCompensation(actor: Actor, employeeId: string, input: CompensationInput): Promise<void> {
    requireRole(actor, 'hr');
    if (!isDate(input.effectiveFrom)) throw validation('INVALID_DATE', 'Tanggal berlaku tidak valid.');
    const monthly = input.basicSalary != null;
    if (monthly === (input.dailyWage != null)) throw validation('WAGE_KIND', 'Isi salah satu: gaji pokok bulanan atau upah harian.');
    if (monthly && !isRupiah(input.basicSalary)) throw validation('INVALID_AMOUNT', 'Gaji pokok harus rupiah bulat.');
    if (!monthly && !isRupiah(input.dailyWage)) throw validation('INVALID_AMOUNT', 'Upah harian harus rupiah bulat.');
    for (const a of input.fixedAllowances ?? []) if (!isRupiah(a.amount) || !a.label.trim()) throw validation('INVALID_ALLOWANCE', 'Tunjangan wajib punya nama dan nominal rupiah bulat.');

    const emp = await one(this.db.query<{ employment_type: string }>('SELECT employment_type FROM employee WHERE id = $1', [employeeId]));
    if (!emp) throw notFound('EMPLOYEE_NOT_FOUND', 'Karyawan tidak ditemukan.');
    if ((emp.employment_type === 'HARIAN') === monthly) throw validation('WAGE_KIND', emp.employment_type === 'HARIAN' ? 'Karyawan harian memakai upah harian.' : 'Karyawan bulanan memakai gaji pokok bulanan.');

    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO employee_compensation (employee_id, effective_from, basic_salary, daily_wage, fixed_allowances, bpjs_kesehatan, bpjs_ketenagakerjaan, bpjs_pensiun, created_by)
         VALUES ($1, $2::date, $3, $4, $5::jsonb, $6, $7, $8, $9)
         ON CONFLICT (employee_id, effective_from) DO UPDATE SET basic_salary = EXCLUDED.basic_salary, daily_wage = EXCLUDED.daily_wage,
           fixed_allowances = EXCLUDED.fixed_allowances, bpjs_kesehatan = EXCLUDED.bpjs_kesehatan, bpjs_ketenagakerjaan = EXCLUDED.bpjs_ketenagakerjaan,
           bpjs_pensiun = EXCLUDED.bpjs_pensiun, created_by = EXCLUDED.created_by, created_at = now()`,
        [employeeId, input.effectiveFrom, input.basicSalary ?? null, input.dailyWage ?? null, JSON.stringify(input.fixedAllowances ?? []), input.bpjs.kesehatan, input.bpjs.ketenagakerjaan, input.bpjs.pensiun, actor.userId],
      );
      // Audit tanpa nominal: cukup jejak siapa, kapan, field apa.
      await writeAudit(tx, { actorId: actor.userId, action: 'compensation.set', entity: 'employee', entityId: employeeId, diff: { effectiveFrom: input.effectiveFrom, kind: monthly ? 'monthly' : 'daily', allowances: (input.fixedAllowances ?? []).length } });
    });
  }

  /** PIN kiosk 6 digit; reset juga membuka kunci PIN. */
  async setKioskPin(actor: Actor, employeeId: string, pin: string): Promise<void> {
    requireRole(actor, 'hr');
    if (!/^\d{6}$/.test(pin)) throw validation('INVALID_PIN', 'PIN harus 6 digit angka.');
    if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw validation('WEAK_PIN', 'PIN terlalu mudah ditebak. Hindari angka berurutan atau sama semua.');
    const rows = await this.db.query<{ id: string }>(
      'UPDATE employee SET kiosk_pin_hash = $2, pin_failed_count = 0, pin_locked_until = NULL WHERE id = $1 RETURNING id',
      [employeeId, hashSecret(pin)],
    );
    if (rows.length === 0) throw notFound('EMPLOYEE_NOT_FOUND', 'Karyawan tidak ditemukan.');
    await writeAudit(this.db, { actorId: actor.userId, action: 'employee.set_pin', entity: 'employee', entityId: employeeId });
  }

  async setCard(actor: Actor, employeeId: string, cardToken: string): Promise<void> {
    requireRole(actor, 'hr');
    if (cardToken.trim().length < 6) throw validation('INVALID_CARD', 'Kode kartu tidak terbaca. Pindai ulang kartunya.');
    try {
      const rows = await this.db.query<{ id: string }>(
        `UPDATE employee SET card_token_hash = decode($2, 'hex') WHERE id = $1 RETURNING id`,
        [employeeId, tokenHash(cardToken.trim(), this.keys.indexKey).toString('hex')],
      );
      if (rows.length === 0) throw notFound('EMPLOYEE_NOT_FOUND', 'Karyawan tidak ditemukan.');
    } catch (e) {
      if (e instanceof DbError && e.sqlState === '23505') throw conflict('CARD_IN_USE', 'Kartu ini sudah dipakai karyawan lain.');
      throw e;
    }
    await writeAudit(this.db, { actorId: actor.userId, action: 'employee.set_card', entity: 'employee', entityId: employeeId });
  }

  /** Offboarding: tanggal akhir kerja; payroll bulan itu otomatis hitung ulang PPh 21 tahunan. */
  async endEmployment(actor: Actor, employeeId: string, endDate: string): Promise<void> {
    requireRole(actor, 'hr');
    if (!isDate(endDate)) throw validation('INVALID_DATE', 'Tanggal akhir kerja tidak valid.');
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<{ id: string }>('UPDATE employee SET end_date = $2::date WHERE id = $1 AND join_date <= $2::date RETURNING id', [employeeId, endDate]);
      if (rows.length === 0) throw validation('INVALID_DATE', 'Karyawan tidak ditemukan atau tanggal akhir sebelum tanggal masuk.');
      // Akun dinonaktifkan bila hari terakhir sudah lewat; bila di masa depan, job harian yang menonaktifkan.
      if (endDate < localDate(this.clock.now())) await tx.execute('UPDATE app_user SET active = FALSE WHERE employee_id = $1', [employeeId]);
      await writeAudit(tx, { actorId: actor.userId, action: 'employee.end', entity: 'employee', entityId: employeeId, diff: { endDate } });
    });
  }

  /** Job harian: akun karyawan yang hari terakhir kerjanya sudah lewat dinonaktifkan. Mengembalikan jumlah akun. */
  async deactivateLeavers(): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE app_user u SET active = FALSE FROM employee e
        WHERE e.id = u.employee_id AND u.active AND e.end_date < $1::date RETURNING u.id`,
      [localDate(this.clock.now())],
    );
    for (const r of rows) await writeAudit(this.db, { actorId: 'system', action: 'user.deactivate', entity: 'app_user', entityId: r.id });
    return rows.length;
  }
}
