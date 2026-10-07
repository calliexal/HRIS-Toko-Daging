-- Batas percobaan login per akun (temuan terbuka #6): 5x salah → terkunci 15 menit.
-- Pelengkap rate-limit per IP di gateway; kunci per akun menahan tebak sandi yang tersebar dari banyak IP.
BEGIN;

ALTER TABLE app_user
  ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  ADD COLUMN login_locked_until TIMESTAMPTZ,
  ADD COLUMN last_login_at TIMESTAMPTZ;

INSERT INTO schema_migration (version) VALUES ('0004_login_lockout');

COMMIT;
