'use client';

import { useEffect, useRef, useState } from 'react';
import { approvalKindLabel, type ApprovalRequest } from '@dagingpeople/api';
import { AppLink, Banner, Button, Card, cx, EmptyState, Icon, Skeleton, StatusChip, TextAreaField } from '@dagingpeople/ui';
import { useWebPaths } from '../paths';
import { initials, useDelayedFlag } from '../shared/hooks';
import { PageHeader } from './PageHeader';
import { approveLabel, useApprovalsInbox, useNarrowLayout, type InboxFilter } from './useApprovalsInbox';

const REJECT_NOTE_ERROR = 'Tulis alasan penolakan agar karyawan tahu langkah berikutnya.';

const escalationLabel = (item: ApprovalRequest) => `Lewat ${item.submittedAgo.replace(/ lalu$/, '')} · dieskalasi`;

const FilterChips = ({ chips, value, onChange }: { chips: { value: InboxFilter; label: string; count: number }[]; value: InboxFilter; onChange: (v: InboxFilter) => void }) => (
  <div className="adm-filter-chips" role="group" aria-label="Filter jenis pengajuan">
    {chips.map((c) => (
      <button key={c.value} type="button" className={cx('adm-filter-chip', value === c.value && 'is-active')} aria-pressed={value === c.value} onClick={() => onChange(c.value)}>
        {c.label} <span className="dp-num">{c.count}</span>
      </button>
    ))}
  </div>
);

const InboxItem = ({ item, selected, onSelect, buttonRef }: { item: ApprovalRequest; selected: boolean; onSelect: () => void; buttonRef: (el: HTMLButtonElement | null) => void }) => (
  <li>
    <button ref={buttonRef} type="button" className={cx('adm-inbox-item', selected && 'is-selected')} aria-current={selected ? 'true' : undefined} onClick={onSelect} data-approval-id={item.id}>
      <span className="adm-inbox-item__top">
        <span className="adm-inbox-item__name">{item.employee.name}</span>
        {item.escalated ? (
          <StatusChip tone="warning" icon="alert-triangle">
            {escalationLabel(item)}
          </StatusChip>
        ) : (
          <span className="adm-inbox-item__ago">{item.submittedAgo}</span>
        )}
      </span>
      <span className="adm-inbox-item__summary">{item.summary}</span>
      <span className="adm-inbox-item__kind">{approvalKindLabel[item.kind]}</span>
    </button>
  </li>
);

type DetailProps = {
  item: ApprovalRequest;
  deciding: 'approve' | 'reject' | null;
  showBack: boolean;
  onBack: () => void;
  onDecide: (decision: 'approve' | 'reject', note: string) => Promise<boolean>;
};

const ApprovalDetail = ({ item, deciding, showBack, onBack, onDecide }: DetailProps) => {
  const paths = useWebPaths();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteWrapRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setNote('');
    setNoteError(null);
  }, [item.id]);

  useEffect(() => {
    if (showBack) headingRef.current?.focus();
  }, [showBack, item.id]);

  const reject = async () => {
    if (!note.trim()) {
      setNoteError(REJECT_NOTE_ERROR);
      noteWrapRef.current?.querySelector('textarea')?.focus();
      return;
    }
    await onDecide('reject', note);
  };

  return (
    <article className="adm-detail" aria-labelledby={`detail-${item.id}`}>
      {showBack ? (
        <button type="button" className="adm-back" onClick={onBack}>
          <Icon name="chevron-left" size={20} />
          Kembali ke daftar
        </button>
      ) : null}
      <header className="adm-detail__header">
        <span className="adm-avatar" aria-hidden="true">
          {initials(item.employee.name)}
        </span>
        <div className="adm-detail__who">
          <h2 id={`detail-${item.id}`} ref={headingRef} tabIndex={-1} className="adm-detail__name">
            {item.employee.name}
          </h2>
          <span className="t-small adm-muted">
            {item.employee.position} · {approvalKindLabel[item.kind]}
          </span>
        </div>
        <div className="adm-detail__status">
          <StatusChip tone="warning">Menunggu</StatusChip>
          {item.escalated ? (
            <StatusChip tone="warning" icon="alert-triangle">
              {escalationLabel(item)}
            </StatusChip>
          ) : null}
        </div>
      </header>

      <p className="t-body-strong">{item.summary}</p>

      <dl className="adm-fields">
        {item.details.map((d) => (
          <div key={d.label} className="adm-fields__item">
            <dt>{d.label}</dt>
            <dd className="dp-num">{d.value}</dd>
          </div>
        ))}
      </dl>

      {item.reason ? (
        <div className="adm-fields__item">
          <p className="adm-fields__label">Alasan karyawan</p>
          <p>{item.reason}</p>
        </div>
      ) : null}

      {item.scheduleImpact ? (
        <Banner tone="warning" title="Dampak ke jadwal" action={<AppLink href={paths.schedule}>Buka jadwal</AppLink>}>
          {item.scheduleImpact}
        </Banner>
      ) : null}

      <div ref={noteWrapRef}>
        <TextAreaField
          label="Catatan (wajib jika menolak)"
          hint="Catatan dikirim ke karyawan bersama keputusan Anda."
          value={note}
          error={noteError ?? undefined}
          onChange={(e) => {
            setNote(e.target.value);
            if (noteError && e.target.value.trim()) setNoteError(null);
          }}
        />
      </div>

      <div className="adm-detail__actions">
        <Button variant="secondary" icon="x" onClick={() => void reject()} loading={deciding === 'reject'} disabled={deciding !== null && deciding !== 'reject'}>
          Tolak
        </Button>
        <Button variant="primary" icon="check" onClick={() => void onDecide('approve', note)} loading={deciding === 'approve'} disabled={deciding !== null && deciding !== 'approve'}>
          {approveLabel(item.kind)}
        </Button>
      </div>
    </article>
  );
};

export const ApprovalsScreen = () => {
  const inbox = useApprovalsInbox();
  const narrow = useNarrowLayout();
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const slow = useDelayedFlag(inbox.approvals.loading && !inbox.approvals.data);

  const showDetail = !narrow || mobileView === 'detail';
  const showList = !narrow || mobileView === 'list';

  // Fokus dipindah setelah React merender daftar terbaru.
  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    if (id === '') {
      emptyRef.current?.focus();
      pendingFocus.current = null;
      return;
    }
    const el = itemRefs.current.get(id);
    if (el) {
      el.focus();
      pendingFocus.current = null;
    }
  });

  const select = (id: string) => {
    inbox.setSelectedId(id);
    if (narrow) setMobileView('detail');
  };

  const backToList = () => {
    setMobileView('list');
    pendingFocus.current = inbox.selectedId;
  };

  const handleDecide = async (decision: 'approve' | 'reject', note: string) => {
    if (!inbox.selected) return false;
    const result = await inbox.decide(inbox.selected, decision, note);
    if (result.ok) {
      pendingFocus.current = result.nextId ?? '';
      if (narrow) setMobileView('list');
    }
    return result.ok;
  };

  const loaded = inbox.approvals.data !== undefined;
  const allDone = loaded && inbox.all.length === 0;

  return (
    <div className="adm-page">
      <PageHeader title="Persetujuan" meta={loaded ? <span className="dp-num">{inbox.all.length} pengajuan menunggu keputusan</span> : <Skeleton width={200} height={18} />} />

      <div aria-live="polite" className="adm-live">
        {inbox.notice ? (
          <Banner tone={inbox.notice.tone} role={inbox.notice.tone === 'danger' ? 'alert' : 'status'}>
            {inbox.notice.text}
          </Banner>
        ) : null}
      </div>

      {inbox.approvals.error ? (
        <Banner tone="danger" role="alert" title="Daftar pengajuan belum termuat" action={<Button variant="secondary" size="dense" onClick={() => void inbox.approvals.reload()}>Muat Ulang</Button>}>
          Periksa koneksi internet, lalu muat ulang.
        </Banner>
      ) : null}

      {allDone ? (
        <Card>
          <div ref={emptyRef} tabIndex={-1} className="adm-focus-target">
            <EmptyState icon="check-circle" title="Semua pengajuan sudah diputuskan">
              Tidak ada lagi yang menunggu persetujuan Anda. Pengajuan baru akan muncul di sini.
            </EmptyState>
          </div>
        </Card>
      ) : (
        <div className={cx('adm-inbox', narrow && `adm-inbox--${mobileView}`)}>
          {showList ? (
            <section className="adm-inbox__list dp-card" aria-label="Daftar pengajuan">
              <FilterChips chips={inbox.chips} value={inbox.filter} onChange={inbox.changeFilter} />
              {slow ? (
                <div className="adm-pad adm-stack">
                  <Skeleton height={56} />
                  <Skeleton height={56} />
                </div>
              ) : inbox.visible.length === 0 && loaded ? (
                <EmptyState icon="check-circle" title="Tidak ada pengajuan jenis ini">
                  Pilih filter lain untuk melihat pengajuan yang masih menunggu.
                </EmptyState>
              ) : (
                <ul className="adm-inbox__items">
                  {inbox.visible.map((item) => (
                    <InboxItem
                      key={item.id}
                      item={item}
                      selected={!narrow && item.id === inbox.selectedId}
                      onSelect={() => select(item.id)}
                      buttonRef={(el) => {
                        if (el) itemRefs.current.set(item.id, el);
                        else itemRefs.current.delete(item.id);
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {showDetail ? (
            <section className="adm-inbox__detail dp-card" aria-label="Detail pengajuan">
              {inbox.selected ? (
                <ApprovalDetail item={inbox.selected} deciding={inbox.deciding} showBack={narrow} onBack={backToList} onDecide={handleDecide} />
              ) : loaded ? (
                <EmptyState icon="clipboard" title="Pilih pengajuan">
                  Pilih salah satu pengajuan di daftar untuk melihat detailnya.
                </EmptyState>
              ) : null}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
};
