/**
 * Ekspor file bulk payroll untuk Mandiri Cash Management (MCM).
 *
 * PENTING: susunan kolom di bawah adalah TEMPLATE. Spesifikasi resmi file bulk payroll MCM
 * diberikan oleh Relationship Manager Bank Mandiri dan wajib dicocokkan sebelum go-live
 * (open question PRD 10.4). Ubah hanya `MANDIRI_MCM_COLUMNS` dan `formatRow` bila format berbeda.
 */
export type BankTransferLine = {
  employeeCode: string;
  name: string;
  bankName: string;
  accountNumber: string;
  amount: number;
  remark: string;
};

export const MANDIRI_MCM_COLUMNS = ['No', 'Nomor Rekening', 'Nama Penerima', 'Bank Tujuan', 'Nominal', 'Keterangan', 'Kode Karyawan'] as const;

/**
 * Pemisah kolom dan baris dibuang. Karakter awal = + - @ (dan tab) juga dibuang agar nama yang diketik HR
 * tidak dieksekusi sebagai formula saat Finance membuka CSV ini di Excel (CSV/formula injection).
 */
const clean = (v: string) => v.replace(/[;\r\n"]/g, ' ').trim().replace(/^[=+\-@\t\s]+/, '');

export const buildMandiriMcmFile = (lines: readonly BankTransferLine[], meta: { period: string; payDate: string }) => {
  if (lines.some((l) => !Number.isInteger(l.amount) || l.amount <= 0)) throw new Error('Nominal transfer harus bilangan bulat positif.');
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const rows = lines.map((l, i) =>
    [String(i + 1), clean(l.accountNumber), clean(l.name).slice(0, 40), clean(l.bankName), String(l.amount), clean(l.remark).slice(0, 35), l.employeeCode].join(';'),
  );
  const content = [MANDIRI_MCM_COLUMNS.join(';'), ...rows].join('\r\n') + '\r\n';
  return {
    filename: `payroll-mcm-${meta.period}-bayar-${meta.payDate}.csv`,
    contentType: 'text/csv; charset=utf-8',
    content,
    count: lines.length,
    total,
    nonMandiriCount: lines.filter((l) => !/mandiri/i.test(l.bankName)).length,
  };
};
