-- Uji integritas skema. Jalankan: psql -v ON_ERROR_STOP=1 -f schema.test.sql (di database yang sudah dimigrasi).
-- Semua perubahan di-ROLLBACK di akhir.
\set QUIET on
\pset tuples_only on
\pset format unaligned
BEGIN;

CREATE FUNCTION pg_temp.expect_error(stmt TEXT, expected_state TEXT, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN
      RAISE EXCEPTION 'GAGAL [%]: SQLSTATE % (diharapkan %): %', label, SQLSTATE, expected_state, SQLERRM;
    END IF;
    RAISE NOTICE 'ok  %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'GAGAL [%]: perintah seharusnya ditolak', label;
END $$;

CREATE FUNCTION pg_temp.expect(cond BOOLEAN, label TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'GAGAL [%]', label; END IF;
  RAISE NOTICE 'ok  %', label;
END $$;

-- Data minimal
INSERT INTO legal_entity VALUES ('dpn', 'PT Daging Prima Nusantara', NULL, now());
INSERT INTO location (id, legal_entity_id, name, type, lat, lng, radius_m, region_code, jkk_risk)
VALUES ('kemang', 'dpn', 'Outlet Kemang', 'outlet', -6.260700, 106.813700, 100, 'DKI_JAKARTA', 'low');
INSERT INTO employee (id, code, legal_entity_id, location_id, full_name, position, employment_type, ptkp_status, join_date)
VALUES ('joko', 'DPN-2024-0042', 'dpn', 'kemang', 'Joko Prasetyo', 'Butcher', 'PKWTT', 'TK/0', '2024-03-01'),
       ('budi', 'DPN-2022-0008', 'dpn', 'kemang', 'Budi Santoso', 'Butcher', 'PKWTT', 'K/1', '2022-01-10');

-- ---------------- data inti
SELECT pg_temp.expect_error($$INSERT INTO employee (id, code, legal_entity_id, location_id, full_name, position, employment_type, join_date)
  VALUES ('x', 'DPN-2024-0042', 'dpn', 'kemang', 'X', 'Kasir', 'PKWTT', '2026-01-01')$$, '23505', 'kode karyawan unik');
SELECT pg_temp.expect_error($$INSERT INTO employee (id, code, legal_entity_id, location_id, full_name, position, employment_type, join_date)
  VALUES ('x', 'DPN-26-1', 'dpn', 'kemang', 'X', 'Kasir', 'PKWTT', '2026-01-01')$$, '23514', 'format kode DPN-YYYY-NNNN');
SELECT pg_temp.expect_error($$INSERT INTO employee (id, code, legal_entity_id, location_id, full_name, position, employment_type, join_date)
  VALUES ('x', 'DPN-2026-0999', 'dpn', 'kemang', 'X', 'Kasir', 'PKWT', '2026-01-01')$$, '23514', 'PKWT wajib punya tanggal akhir kontrak');
SELECT pg_temp.expect_error($$INSERT INTO employee_compensation (employee_id, effective_from, basic_salary, daily_wage, created_by)
  VALUES ('joko', '2026-01-01', 5500000, 200000, 'hr')$$, '23514', 'kompensasi bulanan XOR harian');
SELECT pg_temp.expect_error($$INSERT INTO app_user (id, email, password_hash, role) VALUES ('u', 'km@x.id', 'h', 'store_manager')$$,
  '23514', 'Kepala Toko wajib punya lingkup lokasi');

-- ---------------- absensi
INSERT INTO attendance_event (employee_id, client_uuid, direction, method, location_id, event_time, work_date, status)
VALUES ('joko', '11111111-1111-1111-1111-111111111111', 'in', 'app_gps', 'kemang', '2026-10-07 05:58+07', '2026-10-07', 'recorded');

SELECT pg_temp.expect_error($$UPDATE attendance_event SET event_time = now()$$, 'P0001', 'attendance_event tidak bisa diubah');
SELECT pg_temp.expect_error($$DELETE FROM attendance_event$$, 'P0001', 'attendance_event tidak bisa dihapus');

-- Sync offline idempoten: event yang sama dikirim dua kali tidak tercatat dobel.
INSERT INTO attendance_event (employee_id, client_uuid, direction, method, location_id, event_time, work_date, status)
VALUES ('joko', '11111111-1111-1111-1111-111111111111', 'in', 'app_gps', 'kemang', '2026-10-07 05:58+07', '2026-10-07', 'recorded')
ON CONFLICT (employee_id, client_uuid) DO NOTHING;
SELECT pg_temp.expect((SELECT count(*) FROM attendance_event) = 1, 'sync offline idempoten (client_uuid)');

SELECT pg_temp.expect_error($$INSERT INTO attendance_event (employee_id, client_uuid, direction, method, event_time, work_date, status)
  VALUES ('joko', gen_random_uuid(), 'in', 'app_gps', now(), '2026-10-07', 'rejected')$$, '23514', 'event ditolak wajib punya alasan');

-- Tugas luar menunggu persetujuan → masuk inbox, belum dihitung di proyeksi harian.
INSERT INTO attendance_event (id, employee_id, client_uuid, direction, method, location_id, event_time, work_date, status, review_kind, field_duty_reason, distance_m)
VALUES ('22222222-2222-2222-2222-222222222222', 'budi', gen_random_uuid(), 'in', 'app_gps', 'kemang', '2026-10-07 06:12+07', '2026-10-07', 'needs_review', 'field_duty', 'Antar pesanan', 230);
SELECT pg_temp.expect((SELECT count(*) FROM approval_inbox_v WHERE kind = 'field_duty') = 1, 'tugas luar masuk inbox');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM attendance_day_v WHERE employee_id = 'budi'), 'event menunggu tidak masuk proyeksi');

SELECT pg_temp.expect_error($$INSERT INTO attendance_review (event_id, decision, decided_by) VALUES ('22222222-2222-2222-2222-222222222222', 'rejected', 'hr')$$,
  '23514', 'menolak wajib dengan catatan');
INSERT INTO attendance_review (event_id, decision, decided_by) VALUES ('22222222-2222-2222-2222-222222222222', 'approved', 'kepala-toko');
SELECT pg_temp.expect((SELECT clock_in FROM attendance_day_v WHERE employee_id = 'budi') = '2026-10-07 06:12+07', 'event disetujui masuk proyeksi');
SELECT pg_temp.expect((SELECT count(*) FROM approval_inbox_v WHERE kind = 'field_duty') = 0, 'event diputuskan keluar dari inbox');

-- Koreksi yang disetujui menimpa jam pulang tanpa mengubah event asli.
INSERT INTO attendance_correction (employee_id, work_date, clock_out, reason, requested_by, status, decided_by, decided_at)
VALUES ('joko', '2026-10-07', '2026-10-07 14:03+07', 'Lupa absen pulang', 'kepala-toko', 'approved', 'hr', now());
SELECT pg_temp.expect(
  (SELECT clock_in = '2026-10-07 05:58+07' AND clock_out = '2026-10-07 14:03+07' AND corrected FROM attendance_day_v WHERE employee_id = 'joko'),
  'proyeksi harian menggabungkan event + koreksi');

-- ---------------- jadwal
SELECT pg_temp.expect_error($$INSERT INTO schedule_week (location_id, week_start) VALUES ('kemang', '2026-10-13')$$, '23514', 'minggu jadwal harus mulai Senin');
SELECT pg_temp.expect_error($$INSERT INTO schedule_entry (employee_id, work_date, location_id, cell, updated_by) VALUES ('joko', '2026-10-12', 'kemang', 'X', 'km')$$,
  '23514', 'isi sel jadwal dibatasi');
SELECT pg_temp.expect_error($$INSERT INTO schedule_week (location_id, week_start, status) VALUES ('kemang', '2026-10-12', 'published')$$,
  '23514', 'jadwal terbit wajib punya waktu terbit');

-- ---------------- cuti
INSERT INTO leave_entitlement VALUES ('joko', 2026, 12);
INSERT INTO leave_request (employee_id, type, start_date, end_date, working_days, reason, status)
VALUES ('joko', 'annual', '2026-07-01', '2026-07-01', 1, 'Urusan keluarga', 'approved'),
       ('joko', 'annual', '2026-10-15', '2026-10-16', 2, 'Acara keluarga', 'pending');
SELECT pg_temp.expect((SELECT (used, held, remaining) = (1, 2, 9) FROM leave_balance_v WHERE employee_id = 'joko' AND year = 2026),
  'saldo cuti: jatah − disetujui − ditahan');
SELECT pg_temp.expect_error($$INSERT INTO leave_request (employee_id, type, start_date, end_date, working_days, reason)
  VALUES ('joko', 'sick', '2026-10-10', '2026-10-12', 2, 'Demam')$$, '23514', 'sakit > 1 hari wajib lampiran');
SELECT pg_temp.expect_error($$UPDATE leave_request SET status = 'rejected' WHERE status = 'pending'$$, '23514', 'menolak cuti wajib catatan');

-- ---------------- payroll
INSERT INTO payroll_period (id, legal_entity_id, period, start_date, end_date, pay_date)
VALUES ('dpn-2026-09', 'dpn', '2026-09', '2026-08-26', '2026-09-25', '2026-09-28');
INSERT INTO payroll_item (period_id, employee_id, status, input_snapshot, result, gross_pay, taxable_gross, pph21, employee_pension, take_home_pay, ruleset_version, engine_version, input_hash, output_hash)
VALUES ('dpn-2026-09', 'joko', 'ok', '{}', '{}', 6101734, 6382454, 63824, 174000, 5805910, '2026.03', '1.0.0', 'h-in', 'h-out');

SELECT pg_temp.expect_error($$UPDATE payroll_period SET status = 'locked' WHERE id = 'dpn-2026-09'$$, 'P0003', 'status payroll tidak bisa melompat');
UPDATE payroll_period SET status = 'attendance_locked', attendance_locked_at = now() WHERE id = 'dpn-2026-09';
UPDATE payroll_period SET status = 'calculated' WHERE id = 'dpn-2026-09';
UPDATE payroll_period SET status = 'hr_review' WHERE id = 'dpn-2026-09';
UPDATE payroll_period SET status = 'calculated' WHERE id = 'dpn-2026-09';
UPDATE payroll_period SET status = 'hr_review' WHERE id = 'dpn-2026-09';
UPDATE payroll_period SET status = 'owner_approval', submitted_at = now() WHERE id = 'dpn-2026-09';
SELECT pg_temp.expect_error($$UPDATE payroll_period SET status = 'locked' WHERE id = 'dpn-2026-09'$$, 'P0003', 'kunci periode butuh persetujuan Owner dulu');
UPDATE payroll_period SET status = 'approved', approved_by = 'owner', approved_at = now() WHERE id = 'dpn-2026-09';
SELECT pg_temp.expect_error($$UPDATE payroll_item SET take_home_pay = 1 WHERE period_id = 'dpn-2026-09'$$, 'P0002', 'item payroll beku setelah disetujui');
SELECT pg_temp.expect_error($$UPDATE payroll_period SET status = 'locked' WHERE id = 'dpn-2026-09'$$, '23514', 'periode terkunci wajib punya locked_at');
UPDATE payroll_period SET status = 'locked', locked_by = 'hr', locked_at = now() WHERE id = 'dpn-2026-09';
SELECT pg_temp.expect_error($$DELETE FROM payroll_item WHERE period_id = 'dpn-2026-09'$$, 'P0002', 'item payroll tidak bisa dihapus setelah dikunci');
SELECT pg_temp.expect((SELECT (taxable_gross_ytd, pph21_ytd, months_employed) = (6382454, 63824, 1) FROM payroll_ytd_v WHERE employee_id = 'joko'),
  'YTD pajak hanya dari periode terkunci');

-- ---------------- audit
INSERT INTO audit_log (actor_id, action, entity, entity_id, diff) VALUES ('hr', 'compensation.update', 'employee', 'joko', '{"basic_salary":"changed"}');
INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES ('hr', 'payroll.lock', 'payroll_period', 'dpn-2026-09');
SELECT pg_temp.expect((SELECT prev_hash FROM audit_log ORDER BY id DESC LIMIT 1) = (SELECT hash FROM audit_log ORDER BY id LIMIT 1), 'audit log berantai hash');
SELECT pg_temp.expect_error($$UPDATE audit_log SET actor_id = 'x'$$, 'P0001', 'audit log tidak bisa diubah');
SELECT pg_temp.expect_error($$DELETE FROM audit_log$$, 'P0001', 'audit log tidak bisa dihapus');

ROLLBACK;
\echo 'Semua uji skema lolos.'
