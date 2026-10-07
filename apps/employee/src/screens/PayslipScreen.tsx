import { useEffect, useState } from 'react';
import { formatRange, formatRupiah, useApi, useResource, type MoneyLine, type Payslip } from '@dagingpeople/api';
import { Banner, Button, Skeleton, SelectField } from '@dagingpeople/ui';
import { PageHeader, RowList, Screen } from '../components/Layout';

const usePayslip = () => {
  const api = useApi();
  const periods = useResource(() => api.employee.listPayslipPeriods(), [api]);
  const [period, setPeriod] = useState<string>();
  useEffect(() => {
    if (!period && periods.data?.[0]) setPeriod(periods.data[0].period);
  }, [period, periods.data]);
  const slip = useResource<Payslip | undefined>(() => (period ? api.employee.getPayslip(period) : Promise.resolve(undefined)), [api, period]);
  return { periods, period, setPeriod, slip };
};

const Lines = ({ title, lines, negative }: { title: string; lines: MoneyLine[]; negative?: boolean }) => (
  <section className="emp-section" aria-label={title}>
    <h2 className="t-h3">{title}</h2>
    <RowList numeric className="emp-rows--compact" rows={lines.map((l) => ({ key: l.label, label: l.label, value: formatRupiah(negative ? -l.amount : l.amount) }))} />
  </section>
);

/** M7 (PAY-02): slip gaji milik sendiri. */
export const PayslipScreen = () => {
  const { periods, period, setPeriod, slip } = usePayslip();
  const [pdfNotice, setPdfNotice] = useState<string>();
  const [reportOpen, setReportOpen] = useState(false);
  const data = slip.data;

  const openPdf = (s: Payslip) => {
    setPdfNotice(undefined);
    // Di produksi pdfUrl = signed URL berumur pendek dari server. Klien mock memberi tautan '#...'.
    if (s.pdfUrl.startsWith('#')) {
      setPdfNotice('PDF contoh tidak tersedia di mode uji coba. Di aplikasi asli, PDF terbuka di sini.');
      return;
    }
    window.open(s.pdfUrl, '_blank', 'noopener');
  };

  return (
    <Screen>
      <PageHeader title="Slip Gaji">
        {periods.data && period ? (
          <SelectField
            label="Periode"
            hideLabel
            value={period}
            options={periods.data.map((p) => ({ value: p.period, label: p.label }))}
            onChange={(e) => setPeriod(e.target.value)}
          />
        ) : (
          <Skeleton height={48} />
        )}
      </PageHeader>

      {slip.error ? (
        <Banner tone="warning" title="Slip belum tersedia" action={<Button variant="secondary" onClick={() => void slip.reload()}>Muat Ulang</Button>}>
          {slip.error.message} Slip terbit setelah gaji dibayar tanggal 28.
        </Banner>
      ) : !data ? (
        <div className="emp-stack-3" aria-busy="true">
          <Skeleton height={112} />
          <Skeleton height={140} />
          <Skeleton height={180} />
        </div>
      ) : (
        <>
          <section className="emp-takehome" aria-label="Gaji diterima">
            <span className="t-label emp-muted">Diterima (take-home pay)</span>
            <span className="t-amount-lg emp-takehome__amount">{formatRupiah(data.takeHome)}</span>
            <span className="t-caption emp-muted dp-num">
              Ke rekening {data.bankAccountMasked} · {formatRange(data.periodStart, data.periodEnd)}
            </span>
          </section>

          <Lines title="Pendapatan" lines={data.earnings} />
          <Lines title="Potongan" lines={data.deductions} negative />

          <div className="emp-actions-row">
            <Button variant="secondary" icon="download" onClick={() => openPdf(data)}>
              Unduh PDF
            </Button>
            <Button variant="ghost" aria-expanded={reportOpen} onClick={() => setReportOpen((o) => !o)}>
              Laporkan ke HR
            </Button>
          </div>
          {pdfNotice ? (
            <Banner tone="info" role="alert">
              {pdfNotice}
            </Banner>
          ) : null}
          {reportOpen ? (
            // TODO(PAY-02): ganti dengan form laporan setelah endpoint tersedia di HrisClient.
            <Banner tone="info" title="Laporkan slip ke HR">
              Sebutkan periode {data.periodLabel} dan baris yang menurut Anda tidak sesuai kepada Kepala Toko atau HR. Formulir laporan langsung dari aplikasi
              menyusul.
            </Banner>
          ) : (
            <p className="t-caption emp-muted">PDF dilindungi kata sandi.</p>
          )}
        </>
      )}
    </Screen>
  );
};
