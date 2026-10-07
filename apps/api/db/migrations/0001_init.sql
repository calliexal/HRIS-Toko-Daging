-- DagingPeople HRIS — skema awal (R1).
-- Prinsip:
--   * Uang = BIGINT rupiah. Waktu = TIMESTAMPTZ (UTC di disk); tanggal kerja = DATE menurut zona waktu lokasi.
--   * attendance_event & audit_log append-only (ditegakkan trigger). Keputusan atas event = baris baru di tabel lain.
--   * payroll_item tidak bisa diubah setelah periodenya dikunci; koreksi lewat payroll_adjustment (periode berikutnya).
--   * Status/enum memakai TEXT + CHECK agar migrasi berikutnya cukup mengganti constraint.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- inti
CREATE TABLE legal_entity (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  npwp        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE location (
  id               TEXT PRIMARY KEY,
  legal_entity_id  TEXT NOT NULL REFERENCES legal_entity(id),
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('outlet', 'gudang', 'kantor')),
  lat              NUMERIC(9, 6) NOT NULL,
  lng              NUMERIC(9, 6) NOT NULL,
  radius_m         INTEGER NOT NULL CHECK (radius_m BETWEEN 20 AND 1000),
  timezone         TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  region_code      TEXT NOT NULL,
  jkk_risk         TEXT NOT NULL CHECK (jkk_risk IN ('very_low', 'low', 'medium', 'high', 'very_high')),
  active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE employee (
  id                     TEXT PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE CHECK (code ~ '^DPN-[0-9]{4}-[0-9]{4}$'),
  legal_entity_id        TEXT NOT NULL REFERENCES legal_entity(id),
  location_id            TEXT NOT NULL REFERENCES location(id),
  full_name              TEXT NOT NULL,
  position               TEXT NOT NULL,
  employment_type        TEXT NOT NULL CHECK (employment_type IN ('PKWTT', 'PKWT', 'HARIAN')),
  work_pattern           TEXT NOT NULL DEFAULT '6_DAY' CHECK (work_pattern IN ('6_DAY', '5_DAY')),
  ptkp_status            TEXT CHECK (ptkp_status IN ('TK/0','TK/1','TK/2','TK/3','K/0','K/1','K/2','K/3')),
  join_date              DATE NOT NULL,
  contract_end_date      DATE,
  end_date               DATE,
  -- NIK: terenkripsi (envelope encryption di aplikasi) + blind index HMAC untuk cek unik (HR-01 AC2).
  nik_ciphertext         BYTEA,
  nik_blind_index        BYTEA UNIQUE,
  bank_name              TEXT,
  bank_account_ciphertext BYTEA,
  bank_account_last4     TEXT CHECK (bank_account_last4 ~ '^[0-9]{4}$'),
  -- Kiosk: hash scrypt PIN dan hash kartu ID. Lock per karyawan, bukan per kiosk (ATT-02 AC2).
  kiosk_pin_hash         TEXT,
  pin_failed_count       INTEGER NOT NULL DEFAULT 0,
  pin_locked_until       TIMESTAMPTZ,
  card_token_hash        BYTEA UNIQUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (employment_type <> 'PKWT' OR contract_end_date IS NOT NULL)
);
CREATE INDEX employee_location_idx ON employee (location_id) WHERE end_date IS NULL;

-- Kompensasi berversi: perubahan gaji = baris baru (riwayat utuh untuk audit HR-01 AC4).
CREATE TABLE employee_compensation (
  id                 BIGSERIAL PRIMARY KEY,
  employee_id        TEXT NOT NULL REFERENCES employee(id),
  effective_from     DATE NOT NULL,
  basic_salary       BIGINT CHECK (basic_salary >= 0),
  daily_wage         BIGINT CHECK (daily_wage >= 0),
  fixed_allowances   JSONB NOT NULL DEFAULT '[]'::jsonb,
  bpjs_kesehatan     BOOLEAN NOT NULL DEFAULT TRUE,
  bpjs_ketenagakerjaan BOOLEAN NOT NULL DEFAULT TRUE,
  bpjs_pensiun       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, effective_from),
  CHECK ((basic_salary IS NOT NULL) <> (daily_wage IS NOT NULL))
);

CREATE TABLE app_user (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('employee', 'store_manager', 'hr', 'finance', 'owner', 'super_admin')),
  employee_id    TEXT REFERENCES employee(id),
  -- Lingkup lokasi untuk store_manager (SEC-01 AC1). Kosong = semua lokasi (HR/Owner/Finance).
  location_ids   TEXT[] NOT NULL DEFAULT '{}',
  totp_secret_ciphertext BYTEA,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role <> 'employee' OR employee_id IS NOT NULL),
  CHECK (role <> 'store_manager' OR cardinality(location_ids) > 0)
);

CREATE TABLE holiday (
  date  DATE PRIMARY KEY,
  name  TEXT NOT NULL
);

-- ---------------------------------------------------------------- jadwal
CREATE TABLE shift_template (
  location_id  TEXT NOT NULL REFERENCES location(id),
  code         TEXT NOT NULL CHECK (code IN ('P', 'S', 'SB')),
  name         TEXT NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  min_staff    INTEGER NOT NULL DEFAULT 1 CHECK (min_staff >= 0),
  PRIMARY KEY (location_id, code)
);

CREATE TABLE schedule_week (
  location_id   TEXT NOT NULL REFERENCES location(id),
  week_start    DATE NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at  TIMESTAMPTZ,
  published_by  TEXT,
  PRIMARY KEY (location_id, week_start),
  CHECK (status = 'draft' OR published_at IS NOT NULL)
);

CREATE TABLE schedule_entry (
  employee_id  TEXT NOT NULL REFERENCES employee(id),
  work_date    DATE NOT NULL,
  location_id  TEXT NOT NULL REFERENCES location(id),
  cell         TEXT NOT NULL CHECK (cell IN ('P', 'S', 'SB', 'OFF', 'LEAVE')),
  updated_by   TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, work_date)
);
CREATE INDEX schedule_entry_location_date_idx ON schedule_entry (location_id, work_date);

-- ---------------------------------------------------------------- kiosk
CREATE TABLE kiosk_device (
  id               TEXT PRIMARY KEY,
  location_id      TEXT NOT NULL REFERENCES location(id),
  name             TEXT NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('card', 'dynamic_qr')),
  device_token_hash BYTEA NOT NULL UNIQUE,
  -- Rahasia TOTP untuk QR dinamis (ATT-04), terenkripsi di aplikasi.
  qr_secret_ciphertext BYTEA,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (mode <> 'dynamic_qr' OR qr_secret_ciphertext IS NOT NULL)
);

-- ---------------------------------------------------------------- absensi (event log)
CREATE TABLE attendance_event (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        TEXT NOT NULL REFERENCES employee(id),
  client_uuid        UUID NOT NULL,
  device_id          TEXT,
  direction          TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  method             TEXT NOT NULL CHECK (method IN ('app_gps', 'app_qr', 'kiosk_card', 'kiosk_pin')),
  location_id        TEXT REFERENCES location(id),
  -- Waktu kejadian menurut server (online) atau jam monotonik perangkat (offline, ATT-01 AC3).
  event_time         TIMESTAMPTZ NOT NULL,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  work_date          DATE NOT NULL,
  lat                NUMERIC(9, 6),
  lng                NUMERIC(9, 6),
  accuracy_m         INTEGER,
  distance_m         INTEGER,
  is_mock_location   BOOLEAN NOT NULL DEFAULT FALSE,
  offline            BOOLEAN NOT NULL DEFAULT FALSE,
  field_duty_reason  TEXT,
  photo_object_key   TEXT,
  -- Keputusan saat diterima: recorded = sah; needs_review = offline > 12 jam / tugas luar; rejected = ditolak aturan.
  status             TEXT NOT NULL CHECK (status IN ('recorded', 'needs_review', 'rejected')),
  reject_reason      TEXT CHECK (reject_reason IN ('outside_geofence', 'mock_location', 'qr_expired', 'qr_invalid', 'locked_period')),
  review_kind        TEXT CHECK (review_kind IN ('field_duty', 'offline_delayed')),
  UNIQUE (employee_id, client_uuid),
  CHECK (status <> 'rejected' OR reject_reason IS NOT NULL),
  CHECK (status <> 'needs_review' OR review_kind IS NOT NULL)
);
CREATE INDEX attendance_event_day_idx ON attendance_event (employee_id, work_date);

CREATE TABLE attendance_review (
  event_id     UUID PRIMARY KEY REFERENCES attendance_event(id),
  decision     TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_by   TEXT NOT NULL,
  note         TEXT,
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (decision = 'approved' OR coalesce(btrim(note), '') <> '')
);

-- Koreksi absen (ATT-03 AC2): diajukan Kepala Toko, disetujui HR. Versi asli tetap di attendance_event.
CREATE TABLE attendance_correction (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  work_date       DATE NOT NULL,
  clock_in        TIMESTAMPTZ,
  clock_out       TIMESTAMPTZ,
  reason          TEXT NOT NULL CHECK (btrim(reason) <> ''),
  requested_by    TEXT NOT NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  CHECK (clock_in IS NOT NULL OR clock_out IS NOT NULL),
  CHECK (status <> 'rejected' OR coalesce(btrim(decision_note), '') <> '')
);

-- Proyeksi harian: event sah (recorded, atau needs_review yang disetujui) + koreksi yang disetujui menang.
CREATE VIEW attendance_day_v AS
WITH valid_events AS (
  SELECT e.*
  FROM attendance_event e
  LEFT JOIN attendance_review r ON r.event_id = e.id
  WHERE e.status = 'recorded' OR (e.status = 'needs_review' AND r.decision = 'approved')
),
from_events AS (
  SELECT employee_id, work_date,
         min(event_time) FILTER (WHERE direction = 'in')  AS clock_in,
         max(event_time) FILTER (WHERE direction = 'out') AS clock_out,
         (array_agg(method ORDER BY event_time) FILTER (WHERE direction = 'in'))[1] AS method
  FROM valid_events
  GROUP BY employee_id, work_date
),
latest_correction AS (
  SELECT DISTINCT ON (employee_id, work_date) employee_id, work_date, clock_in, clock_out
  FROM attendance_correction
  WHERE status = 'approved'
  ORDER BY employee_id, work_date, decided_at DESC
)
SELECT coalesce(e.employee_id, c.employee_id) AS employee_id,
       coalesce(e.work_date, c.work_date)     AS work_date,
       coalesce(c.clock_in, e.clock_in)       AS clock_in,
       coalesce(c.clock_out, e.clock_out)     AS clock_out,
       e.method,
       (c.employee_id IS NOT NULL)            AS corrected
FROM from_events e
FULL JOIN latest_correction c ON c.employee_id = e.employee_id AND c.work_date = e.work_date;

-- ---------------------------------------------------------------- cuti
CREATE TABLE leave_request (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      TEXT NOT NULL REFERENCES employee(id),
  type             TEXT NOT NULL CHECK (type IN ('annual', 'permit', 'sick')),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  working_days     INTEGER NOT NULL CHECK (working_days > 0),
  reason           TEXT NOT NULL CHECK (btrim(reason) <> ''),
  attachment_key   TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approver_level   INTEGER NOT NULL DEFAULT 1,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  escalated_at     TIMESTAMPTZ,
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  decision_note    TEXT,
  CHECK (end_date >= start_date),
  CHECK (type <> 'sick' OR working_days <= 1 OR attachment_key IS NOT NULL),
  CHECK (status <> 'rejected' OR coalesce(btrim(decision_note), '') <> '')
);
CREATE INDEX leave_request_pending_idx ON leave_request (status, submitted_at) WHERE status = 'pending';

CREATE TABLE leave_entitlement (
  employee_id  TEXT NOT NULL REFERENCES employee(id),
  year         INTEGER NOT NULL,
  annual_days  INTEGER NOT NULL CHECK (annual_days >= 0),
  PRIMARY KEY (employee_id, year)
);

-- Saldo: jatah − disetujui − pending (ditahan, LV-01 AC1).
CREATE VIEW leave_balance_v AS
SELECT ent.employee_id, ent.year, ent.annual_days AS entitlement,
       coalesce(sum(lr.working_days) FILTER (WHERE lr.status = 'approved'), 0)::int AS used,
       coalesce(sum(lr.working_days) FILTER (WHERE lr.status = 'pending'), 0)::int  AS held,
       (ent.annual_days
         - coalesce(sum(lr.working_days) FILTER (WHERE lr.status IN ('approved', 'pending')), 0))::int AS remaining
FROM leave_entitlement ent
LEFT JOIN leave_request lr
  ON lr.employee_id = ent.employee_id AND lr.type = 'annual' AND extract(year FROM lr.start_date) = ent.year
GROUP BY ent.employee_id, ent.year, ent.annual_days;

-- ---------------------------------------------------------------- inbox persetujuan
CREATE VIEW approval_inbox_v AS
SELECT 'leave'::text AS kind, lr.id::text AS id, lr.employee_id, emp.location_id, lr.submitted_at,
       (lr.escalated_at IS NOT NULL) AS escalated
FROM leave_request lr JOIN employee emp ON emp.id = lr.employee_id
WHERE lr.status = 'pending'
UNION ALL
SELECT 'correction', ac.id::text, ac.employee_id, emp.location_id, ac.requested_at,
       ac.requested_at < now() - interval '48 hours'
FROM attendance_correction ac JOIN employee emp ON emp.id = ac.employee_id
WHERE ac.status = 'pending'
UNION ALL
SELECT CASE e.review_kind WHEN 'field_duty' THEN 'field_duty' ELSE 'offline_review' END,
       e.id::text, e.employee_id, emp.location_id, e.received_at,
       e.received_at < now() - interval '24 hours'
FROM attendance_event e
JOIN employee emp ON emp.id = e.employee_id
LEFT JOIN attendance_review r ON r.event_id = e.id
WHERE e.status = 'needs_review' AND r.event_id IS NULL;

-- ---------------------------------------------------------------- payroll
CREATE TABLE payroll_period (
  id               TEXT PRIMARY KEY,
  legal_entity_id  TEXT NOT NULL REFERENCES legal_entity(id),
  period           TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  pay_date         DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'attendance_locked', 'calculated', 'hr_review', 'owner_approval', 'approved', 'locked', 'exported')),
  attendance_locked_at TIMESTAMPTZ,
  submitted_at     TIMESTAMPTZ,
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ,
  locked_by        TEXT,
  locked_at        TIMESTAMPTZ,
  exported_at      TIMESTAMPTZ,
  UNIQUE (legal_entity_id, period),
  CHECK (end_date >= start_date AND pay_date >= end_date),
  CHECK (status NOT IN ('locked', 'exported') OR (locked_at IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE payroll_item (
  period_id       TEXT NOT NULL REFERENCES payroll_period(id),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  status          TEXT NOT NULL CHECK (status IN ('ok', 'needs_review')),
  input_snapshot  JSONB NOT NULL,
  result          JSONB NOT NULL,
  gross_pay       BIGINT,
  taxable_gross   BIGINT,
  pph21           BIGINT,
  employee_pension BIGINT,
  take_home_pay   BIGINT,
  ruleset_version TEXT NOT NULL,
  engine_version  TEXT,
  input_hash      TEXT NOT NULL,
  output_hash     TEXT,
  calculated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, employee_id),
  CHECK (status = 'needs_review' OR (take_home_pay IS NOT NULL AND output_hash IS NOT NULL))
);

CREATE TABLE payroll_adjustment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     TEXT NOT NULL REFERENCES employee(id),
  source_period   TEXT NOT NULL,
  target_period_id TEXT REFERENCES payroll_period(id),
  label           TEXT NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount <> 0),
  taxable         BOOLEAN NOT NULL,
  reason          TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- YTD untuk PPh 21 tahunan: hanya periode yang sudah dikunci.
CREATE VIEW payroll_ytd_v AS
SELECT pi.employee_id,
       substr(pp.period, 1, 4)::int AS tax_year,
       pp.period,
       sum(pi.taxable_gross) OVER w      AS taxable_gross_ytd,
       sum(pi.pph21) OVER w              AS pph21_ytd,
       sum(pi.employee_pension) OVER w   AS employee_pension_ytd,
       count(*) OVER w                   AS months_employed
FROM payroll_item pi
JOIN payroll_period pp ON pp.id = pi.period_id
WHERE pp.status IN ('locked', 'exported') AND pi.status = 'ok'
WINDOW w AS (PARTITION BY pi.employee_id, substr(pp.period, 1, 4) ORDER BY pp.period);

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  -- Hanya ID dan ringkasan perubahan; tanpa PII mentah (UU PDP).
  diff        JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   TEXT,
  hash        TEXT NOT NULL
);

-- ---------------------------------------------------------------- penjaga integritas
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% bersifat append-only: % tidak diizinkan', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER attendance_event_append_only BEFORE UPDATE OR DELETE ON attendance_event
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Rantai hash audit: hash = sha256(prev_hash || isi baris). Mengubah satu baris lama memutus rantai.
CREATE FUNCTION audit_log_chain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
  SELECT hash INTO NEW.prev_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.hash := encode(digest(coalesce(NEW.prev_hash, '') || '|' || NEW.at::text || '|' || NEW.actor_id || '|' || NEW.action || '|'
                            || NEW.entity || '|' || NEW.entity_id || '|' || NEW.diff::text, 'sha256'), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- Payroll yang sudah dikunci tidak boleh berubah (PAY-01 AC4).
CREATE FUNCTION payroll_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st TEXT;
BEGIN
  SELECT status INTO st FROM payroll_period WHERE id = coalesce(OLD.period_id, NEW.period_id);
  IF st IN ('approved', 'locked', 'exported') THEN
    RAISE EXCEPTION 'Periode payroll % berstatus %: data tidak bisa diubah, gunakan penyesuaian periode berikutnya',
      coalesce(OLD.period_id, NEW.period_id), st USING ERRCODE = 'P0002';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER payroll_item_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_item
  FOR EACH ROW EXECUTE FUNCTION payroll_item_guard();

-- Transisi status periode hanya maju sesuai urutan (kecuali hr_review → calculated untuk hitung ulang).
CREATE FUNCTION payroll_period_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  steps TEXT[] := ARRAY['draft', 'attendance_locked', 'calculated', 'hr_review', 'owner_approval', 'approved', 'locked', 'exported'];
  old_i INT := array_position(steps, OLD.status);
  new_i INT := array_position(steps, NEW.status);
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF new_i = old_i + 1
     OR (OLD.status IN ('calculated', 'hr_review') AND NEW.status = 'calculated')
     OR (OLD.status = 'owner_approval' AND NEW.status = 'hr_review') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Transisi status payroll % → % tidak diizinkan', OLD.status, NEW.status USING ERRCODE = 'P0003';
END $$;
CREATE TRIGGER payroll_period_transition BEFORE UPDATE OF status ON payroll_period
  FOR EACH ROW EXECUTE FUNCTION payroll_period_transition();

CREATE TABLE schema_migration (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO schema_migration (version) VALUES ('0001_init');

COMMIT;
