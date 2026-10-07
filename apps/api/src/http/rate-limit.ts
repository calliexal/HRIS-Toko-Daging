/**
 * Batas request per IP (fixed window, di memori). Melengkapi kunci per akun/karyawan: kunci akun menahan tebakan
 * ke satu akun, batas ini menahan satu IP yang menebak banyak akun sekaligus atau membanjiri scrypt.
 *
 * Disimpan di memori proses, jadi berlaku per instance. Bila API dijalankan lebih dari satu replika,
 * pasang juga rate limit di gateway/load balancer (Cloudflare, Railway, Render) agar batasnya global.
 */
export type RateLimitRule = { method: string; pattern: RegExp; limit: number; windowMs: number };

type Bucket = { count: number; resetAt: number };

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export const createRateLimiter = (rules: readonly RateLimitRule[], now: () => number = Date.now) => {
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();

  // Buang bucket kedaluwarsa sesekali agar memori tidak tumbuh tanpa batas oleh IP yang tidak kembali.
  const sweep = (t: number) => {
    if (t - lastSweep < 60_000) return;
    lastSweep = t;
    for (const [key, b] of buckets) if (b.resetAt <= t) buckets.delete(key);
  };

  return (method: string, path: string, ip: string): RateLimitDecision => {
    const index = rules.findIndex((r) => r.method === method && r.pattern.test(path));
    if (index === -1) return { allowed: true };
    const rule = rules[index]!;
    const t = now();
    sweep(t);
    const key = `${index}|${ip}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      buckets.set(key, { count: 1, resetAt: t + rule.windowMs });
      return { allowed: true };
    }
    bucket.count += 1;
    if (bucket.count <= rule.limit) return { allowed: true };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)) };
  };
};

/**
 * Login: sesi berlaku 12 jam, jadi 20/menit per IP tetap longgar untuk satu kantor/outlet di balik satu NAT.
 * PIN kiosk: satu tablet dipakai seluruh outlet saat pergantian shift, jadi batasnya lebih tinggi.
 */
export const DEFAULT_RATE_LIMITS: readonly RateLimitRule[] = [
  { method: 'POST', pattern: /^\/api\/v1\/auth\/login\/?$/, limit: 20, windowMs: 60_000 },
  { method: 'POST', pattern: /^\/api\/v1\/kiosks\/[^/]+\/clock\/pin\/?$/, limit: 60, windowMs: 60_000 },
  { method: 'GET', pattern: /^\/api\/v1\/kiosks\/[^/]+\/employees\/[^/]+\/?$/, limit: 60, windowMs: 60_000 },
];
