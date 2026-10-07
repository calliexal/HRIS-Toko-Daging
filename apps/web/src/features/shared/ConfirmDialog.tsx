'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, type ButtonVariant } from '@dagingpeople/ui';

export type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  confirmDisabled?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Selektor CSS (di dalam dialog) untuk elemen yang difokuskan saat terbuka. Default: tombol batal (pilihan paling aman). */
  initialFocusSelector?: string;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog konfirmasi modal berbasis <dialog>.showModal():
 * latar menjadi inert, Tab berputar di dalam dialog, Esc menutup, fokus kembali ke pemicu.
 */
export const ConfirmDialog = ({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Batal',
  confirmVariant = 'primary',
  confirmDisabled,
  loading,
  onConfirm,
  onCancel,
  initialFocusSelector,
}: ConfirmDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      (dialog.querySelector<HTMLElement>(initialFocusSelector ?? '[data-dialog-cancel]') ?? dialog.querySelector<HTMLElement>('[data-dialog-cancel]'))?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) target.focus();
    }
  }, [open, initialFocusSelector]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Esc memicu `cancel`; state tetap dipegang React agar tidak ada dua sumber kebenaran.
    const handleCancel = (event: Event) => {
      event.preventDefault();
      if (!loadingRef.current) onCancelRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="adm-dialog" aria-labelledby={titleId} aria-describedby={children ? bodyId : undefined}>
      {open ? (
        <div className="adm-dialog__panel">
          <h2 id={titleId} className="adm-dialog__title">
            {title}
          </h2>
          {children ? (
            <div id={bodyId} className="adm-dialog__body">
              {children}
            </div>
          ) : null}
          <div className="adm-dialog__actions">
            <Button variant="secondary" onClick={onCancel} disabled={loading} data-dialog-cancel="">
              {cancelLabel}
            </Button>
            <Button variant={confirmVariant} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
};
