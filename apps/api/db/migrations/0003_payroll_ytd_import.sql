-- Data penghasilan & PPh 21 sebelum sistem live (mis. Jan–Mar 2027 dari Excel), untuk hitung ulang tahunan (Tech Lead #17).
BEGIN;

CREATE TABLE payroll_ytd_import (
  employee_id        TEXT NOT NULL REFERENCES employee(id),
  tax_year           INTEGER NOT NULL,
  through_period     TEXT NOT NULL CHECK (through_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  taxable_gross      BIGINT NOT NULL CHECK (taxable_gross >= 0),
  pph21_withheld     BIGINT NOT NULL CHECK (pph21_withheld >= 0),
  employee_pension   BIGINT NOT NULL CHECK (employee_pension >= 0),
  months_employed    INTEGER NOT NULL CHECK (months_employed BETWEEN 0 AND 12),
  source             TEXT NOT NULL,
  imported_by        TEXT NOT NULL,
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, tax_year),
  CHECK (substr(through_period, 1, 4)::int = tax_year)
);

INSERT INTO schema_migration (version) VALUES ('0003_payroll_ytd_import');

COMMIT;
