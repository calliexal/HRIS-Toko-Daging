import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * QR dinamis kiosk gudang (ATT-04): token = DPQR.<kioskId>.<jendela 30 detik>.<HMAC>.
 * Kiosk bisa membangkitkan token saat offline dari rahasianya sendiri (gaya TOTP);
 * server memverifikasi terhadap waktu scan. Token sah untuk jendela sekarang dan sebelumnya (≤ 60 detik).
 */
export const QR_PERIOD_SECONDS = 30;

const mac = (secret: Buffer, kioskId: string, window: number) =>
  createHmac('sha256', secret).update(`${kioskId}.${window}`).digest('base64url').slice(0, 16);

export const qrWindow = (atMs: number) => Math.floor(atMs / 1000 / QR_PERIOD_SECONDS);

export const generateQrToken = (kioskId: string, secret: Buffer, atMs: number) => {
  const window = qrWindow(atMs);
  return { token: `DPQR.${kioskId}.${window}.${mac(secret, kioskId, window)}`, expiresAt: (window + 1) * QR_PERIOD_SECONDS * 1000, periodSeconds: QR_PERIOD_SECONDS };
};

export type ParsedQr = { kioskId: string; window: number; signature: string };

export const parseQrToken = (token: string): ParsedQr | null => {
  const match = /^DPQR\.([A-Za-z0-9_-]+)\.(\d+)\.([A-Za-z0-9_-]{16})$/.exec(token.trim());
  if (!match) return null;
  return { kioskId: match[1]!, window: Number(match[2]), signature: match[3]! };
};

export type QrCheck = 'valid' | 'expired' | 'invalid';

export const verifyQrToken = (parsed: ParsedQr, secret: Buffer, scannedAtMs: number): QrCheck => {
  const expected = Buffer.from(mac(secret, parsed.kioskId, parsed.window));
  const actual = Buffer.from(parsed.signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return 'invalid';
  const age = qrWindow(scannedAtMs) - parsed.window;
  if (age < 0 || age > 1) return 'expired';
  return 'valid';
};

/** ATT-02 AC2: 3x PIN salah → akun (bukan kiosk) terkunci 15 menit. */
export const PIN_MAX_FAILURES = 3;
export const PIN_LOCK_MINUTES = 15;

export type PinState = { failedCount: number; lockedUntil: Date | null };

export const pinAfterFailure = (state: PinState, now: Date): PinState => {
  const failedCount = state.failedCount + 1;
  return failedCount >= PIN_MAX_FAILURES
    ? { failedCount: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000) }
    : { failedCount, lockedUntil: null };
};

export const isPinLocked = (state: PinState, now: Date) => state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
