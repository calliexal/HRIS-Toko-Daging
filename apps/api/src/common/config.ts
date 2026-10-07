/**
 * Konfigurasi dari environment. Kunci 32 byte (base64). Di produksi DATA_KEY dibungkus KMS
 * dan di-unwrap saat start; jangan pernah di-commit.
 */
export type AppConfig = {
  databaseUrl: string;
  dataKey: Buffer;
  indexKey: Buffer;
  jwtKey: Buffer;
  jwtTtlSeconds: number;
  port: number;
  /** Badan hukum payroll v1. */
  legalEntityId: string;
  corsOrigins: string[];
  /** Matikan di replika tambahan agar job pg-boss hanya jalan di satu instance (pg-boss aman ganda, tapi hemat koneksi). */
  runJobs: boolean;
  /** NODE_ENV=production: mengaktifkan HSTS dan pemeriksaan konfigurasi ketat saat start. */
  production: boolean;
  /** Jumlah proxy di depan API (Railway/Render/Fly = 1). 0 = jangan percaya X-Forwarded-For. */
  trustProxy: number;
};

const key = (name: string, env: NodeJS.ProcessEnv): Buffer => {
  const raw = env[name];
  if (!raw) throw new Error(`Environment ${name} wajib diisi (32 byte base64).`);
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error(`${name} harus 32 byte (base64), sekarang ${buf.length} byte.`);
  return buf;
};

/**
 * Salah konfigurasi di produksi lebih baik gagal saat start daripada diam-diam berjalan tidak aman:
 * database default lokal, atau origin http polos yang membuka CORS ke halaman tanpa TLS.
 */
const assertProductionSafe = (cfg: AppConfig, env: NodeJS.ProcessEnv): AppConfig => {
  if (!cfg.production) return cfg;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi di produksi.');
  const insecure = cfg.corsOrigins.filter((o) => o.startsWith('http://') || o === '*');
  if (insecure.length > 0) throw new Error(`CORS_ORIGINS produksi hanya boleh https:// (atau capacitor://). Hapus: ${insecure.join(', ')}`);
  if (new Set([cfg.dataKey.toString('hex'), cfg.indexKey.toString('hex'), cfg.jwtKey.toString('hex')]).size < 3) {
    throw new Error('DATA_KEY, INDEX_KEY, dan JWT_KEY harus tiga kunci berbeda.');
  }
  return cfg;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => assertProductionSafe({
  databaseUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/dagingpeople',
  dataKey: key('DATA_KEY', env),
  indexKey: key('INDEX_KEY', env),
  jwtKey: key('JWT_KEY', env),
  jwtTtlSeconds: Number(env.JWT_TTL_SECONDS ?? 12 * 3600),
  port: Number(env.PORT ?? 4000),
  legalEntityId: env.LEGAL_ENTITY_ID ?? 'dpn',
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173,capacitor://localhost').split(',').map((s) => s.trim()).filter(Boolean),
  runJobs: env.RUN_JOBS !== 'false',
  production: env.NODE_ENV === 'production',
  trustProxy: Math.max(0, Math.trunc(Number(env.TRUST_PROXY ?? 0)) || 0),
}, env);
