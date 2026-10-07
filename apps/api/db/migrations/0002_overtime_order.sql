-- Perintah lembur (PRD bagian 7): lembur hanya dibayar bila ada perintah yang disetujui.
BEGIN;

CREATE TABLE overtime_order (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   TEXT NOT NULL REFERENCES employee(id),
  work_date     DATE NOT NULL,
  hours         NUMERIC(4, 2) NOT NULL CHECK (hours > 0 AND hours <= 12),
  day_type      TEXT NOT NULL CHECK (day_type IN ('workday', 'rest_day')),
  shortest_workday BOOLEAN NOT NULL DEFAULT FALSE,
  reason        TEXT NOT NULL CHECK (btrim(reason) <> ''),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by  TEXT NOT NULL,
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX overtime_order_employee_date_idx ON overtime_order (employee_id, work_date) WHERE status = 'approved';

INSERT INTO schema_migration (version) VALUES ('0002_overtime_order');

COMMIT;
