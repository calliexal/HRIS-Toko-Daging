import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Primitif keamanan berbasis node:crypto (tanpa dependensi native).
 * Di produksi, kunci data (DATA_KEY) dibungkus KMS (envelope encryption) — lihat README.
 */

// ---------------------------------------------------------------- hash PIN & password (scrypt)
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 } as const;

export const hashSecret = (secret: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
};

const scryptAsync = (secret: string, salt: Buffer, keylen: number, N: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(secret, salt, keylen, { N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => (err ? reject(err) : resolve(key))),
  );

/**
 * Asinkron (thread pool libuv): scrypt butuh puluhan milidetik, versi sync akan membekukan seluruh server
 * selama itu sehingga banjir request login bisa melumpuhkan API untuk semua pengguna.
 */
export const verifySecret = async (secret: string, stored: string): Promise<boolean> => {
  const [scheme, n, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(secret, Buffer.from(saltB64, 'base64'), expected.length, Number(n));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// ---------------------------------------------------------------- blind index & token hash
/** HMAC deterministik untuk cek keunikan/pencarian data terenkripsi (NIK) tanpa menyimpan nilai aslinya. */
export const blindIndex = (value: string, key: Buffer): Buffer => createHmac('sha256', key).update(value.trim()).digest();

/** Hash token kartu ID / token perangkat kiosk (yang disimpan hanya hash-nya). */
export const tokenHash = (token: string, key: Buffer): Buffer => createHmac('sha256', key).update(`token:${token}`).digest();

// ---------------------------------------------------------------- enkripsi data (AES-256-GCM)
export const encrypt = (plaintext: string, key: Buffer): Buffer => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
};

export const decrypt = (payload: Buffer, key: Buffer): string => {
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
};

// ---------------------------------------------------------------- JWT HS256 (akses pengguna)
const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

export const signJwt = (payload: Record<string, unknown>, key: Buffer, ttlSeconds: number, nowMs: number): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const iat = Math.floor(nowMs / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat, exp: iat + ttlSeconds }));
  const sig = createHmac('sha256', key).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

export const verifyJwt = <T extends Record<string, unknown>>(token: string, key: Buffer, nowMs: number): T | null => {
  const [header, body, sig] = token.split('.');
  if (!header || !body || !sig) return null;
  const expected = createHmac('sha256', key).update(`${header}.${body}`).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let parsed: T & { exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp?: number };
  } catch {
    // Tanda tangan sah tetapi isi rusak hanya mungkin bila kunci bocor; tetap tolak sebagai token tidak sah, bukan 500.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.exp !== 'number' || parsed.exp * 1000 <= nowMs) return null;
  return parsed;
};
