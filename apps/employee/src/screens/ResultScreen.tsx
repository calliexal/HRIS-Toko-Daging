import { useEffect, useRef } from 'react';
import { clockMethodLabel, formatClock } from '@dagingpeople/api';
import { ButtonLink, EmptyState, Icon, StatusChip, type IconName, type Tone } from '@dagingpeople/ui';
import { RowList, Screen } from '../components/Layout';
import { isClockOutcomeState, type AcceptedClock, type ClockOutcomeState } from '../hooks/useClockSubmit';
import { useLocation } from '../router';
import { directionLabel } from './shared';

type Presentation = { tone: Tone; icon: IconName; title: string; chip: string; note?: string };

const present = (result: AcceptedClock): Presentation => {
  const action = directionLabel(result.direction);
  switch (result.outcome) {
    case 'recorded':
      return result.status === 'late'
        ? { tone: 'warning', icon: 'check', title: `${action} tercatat`, chip: `Terlambat ${result.lateMinutes} mnt` }
        : { tone: 'success', icon: 'check', title: `${action} tercatat`, chip: result.direction === 'in' ? 'Tepat waktu' : 'Tercatat' };
    case 'queued_offline':
      return {
        tone: 'info',
        icon: 'wifi-off',
        title: `${action} tersimpan di HP`,
        chip: 'Tersimpan di HP, dikirim otomatis saat online',
        note: 'Anda tidak perlu absen ulang. Status tepat waktu atau terlambat muncul setelah absen terkirim.',
      };
    case 'pending_approval':
      return {
        tone: 'warning',
        icon: 'clock',
        title: `${action} tugas luar terkirim`,
        chip: 'Menunggu persetujuan Kepala Toko',
        note: 'Anda akan mendapat notifikasi setelah Kepala Toko memutuskan.',
      };
  }
};

const photoLabel: Record<ClockOutcomeState['photo'], string> = {
  sent: 'Terkirim',
  queued: 'Menunggu dikirim',
  simulated: 'Foto simulasi',
};

/** M4: konfirmasi absen. Data datang dari state router, bukan query string. */
export const ResultScreen = () => {
  const { state } = useLocation();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Pindahkan fokus ke judul agar pembaca layar langsung mengumumkan hasil.
    headingRef.current?.focus();
  }, []);

  if (!isClockOutcomeState(state)) {
    return (
      <Screen>
        <EmptyState icon="info" title="Belum ada absen untuk ditampilkan" action={<ButtonLink href="/beranda">Kembali ke Beranda</ButtonLink>}>
          Hasil absen tampil di sini setelah Anda absen dari Beranda.
        </EmptyState>
      </Screen>
    );
  }

  const { result } = state;
  const p = present(result);

  return (
    <Screen
      className="emp-result"
      footer={
        <ButtonLink href="/beranda" size="lg" block>
          Kembali ke Beranda
        </ButtonLink>
      }
    >
      <div className="emp-result__hero" aria-live="polite">
        <span className={`emp-result__badge emp-result__badge--${p.tone}`}>
          <Icon name={p.icon} size={44} strokeWidth={2.5} />
        </span>
        <h1 ref={headingRef} tabIndex={-1} className="emp-result__title">
          {p.title}
        </h1>
        <p className="emp-clock emp-clock--lg">
          <span className="t-clock">{formatClock(result.time)}</span>
          <span className="emp-clock__zone">WIB</span>
        </p>
        <StatusChip tone={p.tone} size="md" icon={p.icon === 'check' ? 'check-circle' : p.icon}>
          {p.chip}
        </StatusChip>
      </div>

      <RowList
        rows={[
          { label: 'Shift', value: <span className="dp-num">{result.shiftLabel}</span> },
          { label: 'Lokasi', value: result.locationName },
          { label: 'Cara absen', value: clockMethodLabel[state.method] },
          { label: 'Foto', value: photoLabel[state.photo] },
        ]}
      />

      {p.note ? <p className="t-small emp-muted emp-center">{p.note}</p> : null}
    </Screen>
  );
};
