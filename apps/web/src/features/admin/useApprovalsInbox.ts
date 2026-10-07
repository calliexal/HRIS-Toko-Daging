'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { approvalKindLabel, useApi, useResource, type ApprovalKind, type ApprovalRequest } from '@dagingpeople/api';
import { errorMessage, useTransientMessage } from '../shared/hooks';
import { useApprovalBadge } from './AdminShell';

export type InboxFilter = 'all' | ApprovalKind;

export type DecisionNotice = { tone: 'success' | 'danger'; text: string };

const KIND_ORDER: readonly ApprovalKind[] = ['leave', 'correction', 'field_duty', 'offline_review'];

const approveObject: Record<ApprovalKind, string> = {
  leave: 'Cuti',
  correction: 'Koreksi',
  field_duty: 'Tugas Luar',
  offline_review: 'Absen Offline',
};

export const approveLabel = (kind: ApprovalKind): string => `Setujui ${approveObject[kind]}`;

/**
 * State inbox persetujuan. Daftar diambil sekali (semua jenis) lalu difilter di klien
 * agar jumlah per chip selalu sinkron dengan isi daftar.
 */
export const useApprovalsInbox = () => {
  const api = useApi();
  const badge = useApprovalBadge();
  const approvals = useResource(() => api.admin.listApprovals(), [api]);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [notice, setNotice] = useTransientMessage<DecisionNotice>(null);

  const all = useMemo(() => approvals.data ?? [], [approvals.data]);
  const visible = useMemo(() => (filter === 'all' ? all : all.filter((a) => a.kind === filter)), [all, filter]);

  const chips = useMemo(
    () => [
      { value: 'all' as const, label: 'Semua', count: all.length },
      ...KIND_ORDER.map((kind) => ({ value: kind, label: approvalKindLabel[kind], count: all.filter((a) => a.kind === kind).length })),
    ],
    [all],
  );

  // Pilih item pertama otomatis; jika item terpilih hilang dari filter, pindah ke yang pertama.
  useEffect(() => {
    if (visible.length === 0) {
      if (selectedId !== null) setSelectedId(null);
    } else if (!visible.some((a) => a.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [visible, selectedId]);

  const { setCount } = badge;
  useEffect(() => {
    if (approvals.data) setCount(approvals.data.length);
  }, [approvals.data, setCount]);

  const selected = visible.find((a) => a.id === selectedId) ?? null;

  const decide = useCallback(
    async (item: ApprovalRequest, decision: 'approve' | 'reject', note: string): Promise<{ ok: boolean; nextId: string | null }> => {
      setDeciding(decision);
      try {
        await api.admin.decideApproval(item.id, decision, note.trim() || undefined);
        const index = visible.findIndex((a) => a.id === item.id);
        const remaining = visible.filter((a) => a.id !== item.id);
        const next = remaining[Math.min(index, remaining.length - 1)] ?? null;
        approvals.setData(all.filter((a) => a.id !== item.id));
        setSelectedId(next?.id ?? null);
        setNotice({
          tone: 'success',
          text:
            decision === 'approve'
              ? `${approvalKindLabel[item.kind]} ${item.employee.name} disetujui. Karyawan mendapat notifikasi.`
              : `${approvalKindLabel[item.kind]} ${item.employee.name} ditolak. Catatan Anda dikirim ke karyawan.`,
        });
        return { ok: true, nextId: next?.id ?? null };
      } catch (e) {
        setNotice({ tone: 'danger', text: errorMessage(e, 'Keputusan belum tersimpan. Periksa koneksi lalu coba lagi.') });
        return { ok: false, nextId: item.id };
      } finally {
        setDeciding(null);
      }
    },
    [api, all, visible, approvals, setNotice],
  );

  const changeFilter = (next: InboxFilter) => {
    setFilter(next);
    setNotice(null);
  };

  return { approvals, all, visible, chips, filter, changeFilter, selected, selectedId, setSelectedId, decide, deciding, notice };
};

/** true bila lebar layar < 900px (inbox jadi dua layar: daftar → detail). */
export const useNarrowLayout = (query = '(max-width: 899px)'): boolean => {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setNarrow(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return narrow;
};
