import type { LoginResult } from '@dagingpeople/contracts';
import type { Actor, Role } from '../../common/actor';
import type { Clock } from '../../common/clock';
import { one, type Db } from '../../common/db';
import { DomainError, locked, validation } from '../../common/errors';
import { signJwt, verifyJwt, verifySecret } from '../../common/security';
import { localClock } from '../../common/time';

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  employee_id: string | null;
  location_ids: string[];
  active: boolean;
  name: string;
  failed_login_count: number;
  locked_until_ms: number | null;
};
type Claims = { sub: string; role: Role; emp: string | null; loc: string[] };

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

/** Pesan sama untuk email salah maupun sandi salah agar tidak membocorkan akun yang terdaftar. */
const invalidLogin = () => new DomainError('unauthenticated', 'INVALID_LOGIN', 'Email atau kata sandi salah. Periksa lagi, atau hubungi HR bila lupa kata sandi.');

/**
 * Login email + kata sandi → JWT HS256 berumur pendek. Role & lingkup lokasi ikut di token,
 * tapi setiap request tetap mengecek ulang akun aktif (nonaktifkan karyawan = akses langsung putus).
 *
 * Batas percobaan: 5x salah → akun terkunci 15 menit (pelengkap rate-limit per IP di gateway).
 * Selama terkunci, sandi benar pun ditolak, supaya penebak tidak bisa memakai respons sebagai oracle.
 */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly jwt: { key: Buffer; ttlSeconds: number },
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password) throw validation('LOGIN_REQUIRED', 'Isi email dan kata sandi.');
    const user = await one(this.db.query<UserRow>(
      `SELECT u.id, u.email, u.password_hash, u.role, u.employee_id, u.location_ids, u.active, u.failed_login_count,
              (extract(epoch FROM u.login_locked_until) * 1000)::bigint AS locked_until_ms,
              coalesce(e.full_name, initcap(split_part(u.email, '@', 1))) AS name
         FROM app_user u LEFT JOIN employee e ON e.id = u.employee_id
        WHERE lower(u.email) = $1`,
      [normalized],
    ));
    const now = this.clock.now();

    if (!user) {
      // Tetap jalankan scrypt saat akun tidak ada supaya waktu respons tidak membedakan.
      await verifySecret(password, DUMMY_HASH);
      throw invalidLogin();
    }
    if (user.locked_until_ms && user.locked_until_ms > now.getTime()) throw this.lockedError(new Date(user.locked_until_ms));

    // Jatah percobaan "dipesan" secara atomik SEBELUM sandi diperiksa. Membaca hitungan lalu menulis ulang
    // (read-modify-write) bisa dibobol dengan request paralel: semua membaca hitungan lama dan tak satu pun memicu kunci.
    const attempt = await one(this.db.query<{ attempt: number }>(
      `UPDATE app_user SET failed_login_count = failed_login_count + 1
        WHERE id = $1 AND (login_locked_until IS NULL OR login_locked_until <= $2::timestamptz)
        RETURNING failed_login_count AS attempt`,
      [user.id, now],
    ));
    if (!attempt) throw this.lockedError(await this.lockedUntil(user.id, now));
    if (attempt.attempt > LOGIN_MAX_FAILURES) throw this.lockedError(await this.lock(user.id, now));

    const ok = await verifySecret(password, user.password_hash);
    if (!ok) {
      if (attempt.attempt >= LOGIN_MAX_FAILURES) throw this.lockedError(await this.lock(user.id, now));
      throw invalidLogin();
    }
    if (!user.active) throw new DomainError('forbidden', 'ACCOUNT_INACTIVE', 'Akun ini sudah tidak aktif. Hubungi HR bila ini keliru.');

    await this.db.execute('UPDATE app_user SET failed_login_count = 0, login_locked_until = NULL, last_login_at = $2::timestamptz WHERE id = $1', [user.id, now]);
    const claims: Claims = { sub: user.id, role: user.role, emp: user.employee_id, loc: user.location_ids };
    return {
      token: signJwt(claims, this.jwt.key, this.jwt.ttlSeconds, now.getTime()),
      expiresInSeconds: this.jwt.ttlSeconds,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, employeeId: user.employee_id, locationIds: user.location_ids },
    };
  }

  /** Hitungan direset saat kunci dipasang, jadi setelah 15 menit pengguna kembali punya 5 percobaan. */
  private async lock(userId: string, now: Date): Promise<Date> {
    const row = await one(this.db.query<{ until_ms: number }>(
      `UPDATE app_user SET failed_login_count = 0,
              login_locked_until = CASE WHEN login_locked_until > $2::timestamptz THEN login_locked_until ELSE $3::timestamptz END
        WHERE id = $1 RETURNING (extract(epoch FROM login_locked_until) * 1000)::bigint AS until_ms`,
      [userId, now, new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000)],
    ));
    return new Date(Number(row!.until_ms));
  }

  private async lockedUntil(userId: string, now: Date): Promise<Date> {
    const row = await one(this.db.query<{ until_ms: number | null }>(
      'SELECT (extract(epoch FROM login_locked_until) * 1000)::bigint AS until_ms FROM app_user WHERE id = $1',
      [userId],
    ));
    return row?.until_ms ? new Date(Number(row.until_ms)) : new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000);
  }

  private lockedError(until: Date) {
    return locked('LOGIN_LOCKED', `Terlalu banyak percobaan masuk. Coba lagi pukul ${localClock(until).replace(':', '.')} WIB, atau hubungi HR untuk reset kata sandi.`, {
      lockedUntil: until.toISOString(),
    });
  }

  /** Dipakai AuthGuard. null = token tidak sah / kedaluwarsa / akun nonaktif. */
  async verify(token: string): Promise<Actor | null> {
    const claims = verifyJwt<Claims>(token, this.jwt.key, this.clock.now().getTime());
    if (!claims) return null;
    const user = await one(this.db.query<{ role: Role; employee_id: string | null; location_ids: string[]; active: boolean }>(
      'SELECT role, employee_id, location_ids, active FROM app_user WHERE id = $1',
      [claims.sub],
    ));
    if (!user?.active) return null;
    // Sumber kebenaran = database (role yang dicabut berlaku seketika, tidak menunggu token habis).
    return { userId: claims.sub, role: user.role, employeeId: user.employee_id, locationIds: user.location_ids };
  }
}

/** Hash scrypt dari string acak; hanya untuk menyamakan waktu verifikasi. */
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
