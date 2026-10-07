import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createRateLimiter, DEFAULT_RATE_LIMITS } from '../src/http/rate-limit';

describe('rate limit per IP', () => {
  const setup = () => {
    let t = 0;
    const limit = createRateLimiter([{ method: 'POST', pattern: /^\/api\/v1\/auth\/login$/, limit: 3, windowMs: 60_000 }], () => t);
    return { limit, advance: (ms: number) => (t += ms) };
  };

  test('lewat batas → ditolak dengan Retry-After; jendela berikutnya pulih', () => {
    const { limit, advance } = setup();
    for (let i = 0; i < 3; i++) assert.deepEqual(limit('POST', '/api/v1/auth/login', '1.1.1.1'), { allowed: true });
    advance(15_000);
    assert.deepEqual(limit('POST', '/api/v1/auth/login', '1.1.1.1'), { allowed: false, retryAfterSeconds: 45 });
    advance(45_000);
    assert.deepEqual(limit('POST', '/api/v1/auth/login', '1.1.1.1'), { allowed: true });
  });

  test('IP lain dan endpoint lain tidak ikut terkena batas', () => {
    const { limit } = setup();
    for (let i = 0; i < 4; i++) limit('POST', '/api/v1/auth/login', '1.1.1.1');
    assert.deepEqual(limit('POST', '/api/v1/auth/login', '2.2.2.2'), { allowed: true });
    assert.deepEqual(limit('GET', '/api/v1/auth/login', '1.1.1.1'), { allowed: true });
    assert.deepEqual(limit('GET', '/api/v1/locations', '1.1.1.1'), { allowed: true });
  });

  test('aturan bawaan mencakup login dan PIN kiosk', () => {
    const covered = (method: string, path: string) => DEFAULT_RATE_LIMITS.some((r) => r.method === method && r.pattern.test(path));
    assert.ok(covered('POST', '/api/v1/auth/login'));
    assert.ok(covered('POST', '/api/v1/kiosks/kiosk-kemang-1/clock/pin'));
    assert.ok(covered('GET', '/api/v1/kiosks/kiosk-kemang-1/employees/0042'));
    assert.ok(!covered('GET', '/api/v1/me'));
  });
});
