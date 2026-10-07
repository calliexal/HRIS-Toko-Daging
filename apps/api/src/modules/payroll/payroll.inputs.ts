import type { EmployeePayrollInput, MoneyLine, OvertimeEntry, YearToDate } from '@dagingpeople/payroll-engine';
import type { Db } from '../../common/db';

/** Menyusun input Payroll Engine dari database untuk satu periode. Hanya membaca; tidak ada logika pajak di sini. */

export type PeriodRow = { id: string; legal_entity_id: string; period: string; start_date: string; end_date: string; pay_date: string; status: string };

type EmployeeRow = {
  id: string;
  employment_type: 'PKWTT' | 'PKWT' | 'HARIAN';
  ptkp_status: EmployeePayrollInput['ptkpStatus'];
  work_pattern: '6_DAY' | '5_DAY';
  join_date: string;
  end_date: string | null;
  jkk_risk: EmployeePayrollInput['jkkRisk'];
  region_code: string;
  basic_salary: number | null;
  daily_wage: number | null;
  fixed_allowances: MoneyLine[] | null;
  bpjs_kesehatan: boolean | null;
  bpjs_ketenagakerjaan: boolean | null;
  bpjs_pensiun: boolean | null;
};

type DayFacts = { employee_id: string; scheduled: number; present: number; unpaid: number; employed_scheduled: number };

const WORK = `('P', 'S', 'SB')`;

export const buildPayrollInputs = async (db: Db, p: PeriodRow, today: string): Promise<EmployeePayrollInput[]> => {
  const [employees, days, overtime, adjustments, ytd] = await Promise.all([
    db.query<EmployeeRow>(
      `SELECT e.id, e.employment_type, e.ptkp_status, e.work_pattern, e.join_date, e.end_date, l.jkk_risk, l.region_code,
              c.basic_salary, c.daily_wage, c.fixed_allowances, c.bpjs_kesehatan, c.bpjs_ketenagakerjaan, c.bpjs_pensiun
         FROM employee e
         JOIN location l ON l.id = e.location_id
         LEFT JOIN LATERAL (
           SELECT * FROM employee_compensation ec WHERE ec.employee_id = e.id AND ec.effective_from <= $3::date
           ORDER BY ec.effective_from DESC LIMIT 1
         ) c ON TRUE
        WHERE e.legal_entity_id = $1 AND e.join_date <= $3::date AND (e.end_date IS NULL OR e.end_date >= $2::date)
        ORDER BY e.id`,
      [p.legal_entity_id, p.start_date, p.end_date],
    ),
    db.query<DayFacts>(
      // Hari terjadwal termasuk cuti (dibayar). Mangkir = shift terjadwal yang sudah lewat tanpa absen masuk.
      `SELECT se.employee_id,
              count(*) FILTER (WHERE se.cell IN ${WORK} OR se.cell = 'LEAVE')::int AS scheduled,
              count(d.clock_in)::int AS present,
              count(*) FILTER (WHERE se.cell IN ${WORK} AND d.clock_in IS NULL AND se.work_date < $3::date)::int AS unpaid,
              count(*) FILTER (WHERE (se.cell IN ${WORK} OR se.cell = 'LEAVE') AND se.work_date >= e.join_date
                                 AND (e.end_date IS NULL OR se.work_date <= e.end_date))::int AS employed_scheduled
         FROM schedule_entry se
         JOIN employee e ON e.id = se.employee_id
         LEFT JOIN attendance_day_v d ON d.employee_id = se.employee_id AND d.work_date = se.work_date
        WHERE e.legal_entity_id = $4 AND se.work_date BETWEEN $1::date AND $2::date
        GROUP BY se.employee_id`,
      [p.start_date, p.end_date, today, p.legal_entity_id],
    ),
    db.query<{ employee_id: string; work_date: string; hours: number; day_type: 'workday' | 'rest_day'; shortest_workday: boolean }>(
      `SELECT o.employee_id, o.work_date, o.hours, o.day_type, o.shortest_workday
         FROM overtime_order o JOIN employee e ON e.id = o.employee_id
        WHERE e.legal_entity_id = $3 AND o.status = 'approved' AND o.work_date BETWEEN $1::date AND $2::date
        ORDER BY o.work_date`,
      [p.start_date, p.end_date, p.legal_entity_id],
    ),
    db.query<{ employee_id: string; label: string; amount: number; taxable: boolean; source_period: string }>(
      `SELECT a.employee_id, a.label, a.amount, a.taxable, a.source_period
         FROM payroll_adjustment a JOIN employee e ON e.id = a.employee_id
        WHERE e.legal_entity_id = $1 AND (a.target_period_id IS NULL OR a.target_period_id = $2) AND a.source_period < $3
        ORDER BY a.created_at`,
      [p.legal_entity_id, p.id, p.period],
    ),
    // YTD = impor sebelum go-live + periode terkunci di tahun pajak yang sama (sebelum periode ini).
    db.query<{ employee_id: string; taxable_gross: number; pph21: number; pension: number; months: number }>(
      `WITH locked AS (
         SELECT pi.employee_id, sum(pi.taxable_gross) AS taxable_gross, sum(pi.pph21) AS pph21, sum(pi.employee_pension) AS pension, count(*) AS months
           FROM payroll_item pi JOIN payroll_period pp ON pp.id = pi.period_id
          WHERE pp.legal_entity_id = $1 AND pp.status IN ('locked', 'exported') AND pi.status = 'ok'
            AND substr(pp.period, 1, 4) = substr($2, 1, 4) AND pp.period < $2
          GROUP BY pi.employee_id
       )
       SELECT coalesce(l.employee_id, i.employee_id) AS employee_id,
              (coalesce(l.taxable_gross, 0) + coalesce(i.taxable_gross, 0))::bigint AS taxable_gross,
              (coalesce(l.pph21, 0) + coalesce(i.pph21_withheld, 0))::bigint AS pph21,
              (coalesce(l.pension, 0) + coalesce(i.employee_pension, 0))::bigint AS pension,
              (coalesce(l.months, 0) + coalesce(i.months_employed, 0))::int AS months
         FROM locked l
         FULL JOIN (SELECT * FROM payroll_ytd_import WHERE tax_year = substr($2, 1, 4)::int AND through_period < $2) i ON i.employee_id = l.employee_id`,
      [p.legal_entity_id, p.period],
    ),
  ]);

  const factsBy = new Map(days.map((d) => [d.employee_id, d]));
  const ytdBy = new Map(ytd.map((y) => [y.employee_id, y]));
  const year = Number(p.period.slice(0, 4));
  const month = Number(p.period.slice(5, 7));

  return employees.map((e): EmployeePayrollInput => {
    const f = factsBy.get(e.id) ?? { scheduled: 0, present: 0, unpaid: 0, employed_scheduled: 0 };
    const partial = e.join_date > p.start_date || (e.end_date !== null && e.end_date < p.end_date);
    const leaving = e.end_date !== null && e.end_date <= p.end_date;
    const y = ytdBy.get(e.id);
    const yearToDate: YearToDate | undefined = y
      ? { taxableGross: y.taxable_gross, pph21Withheld: y.pph21, employeePensionContributions: y.pension, monthsEmployed: y.months }
      : undefined;
    const ot: OvertimeEntry[] = overtime
      .filter((o) => o.employee_id === e.id)
      .map((o) => ({ date: o.work_date, hours: Number(o.hours), dayType: o.day_type, shortestWorkday: o.shortest_workday || undefined }));
    return {
      employeeId: e.id,
      employmentType: e.employment_type,
      ptkpStatus: e.ptkp_status,
      workPattern: e.work_pattern,
      jkkRisk: e.jkk_risk,
      regionCode: e.region_code,
      period: { year, month, start: p.start_date, end: p.end_date, payDate: p.pay_date },
      monthly: e.basic_salary !== null ? { basicSalary: e.basic_salary, fixedAllowances: e.fixed_allowances ?? [] } : undefined,
      daily: e.daily_wage !== null ? { dailyWage: e.daily_wage } : undefined,
      attendance: {
        scheduledWorkDays: f.scheduled,
        daysPresent: f.present,
        unpaidAbsenceDays: e.employment_type === 'HARIAN' ? 0 : f.unpaid,
        employedWorkDays: partial ? f.employed_scheduled : undefined,
      },
      overtime: ot,
      bpjsEnrollment: { kesehatan: e.bpjs_kesehatan ?? false, ketenagakerjaan: e.bpjs_ketenagakerjaan ?? false, pensiun: e.bpjs_pensiun ?? false },
      adjustments: adjustments.filter((a) => a.employee_id === e.id).map((a) => ({ label: a.label, amount: a.amount, taxable: a.taxable, sourcePeriod: a.source_period })),
      otherDeductions: [],
      // Desember atau bulan terakhir bekerja = hitung ulang tahunan (Pasal 17).
      taxMonthKind: month === 12 || leaving ? 'final' : 'regular',
      yearToDate,
    };
  });
};
