'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { formatClock, type ScheduleCell, type ShiftTemplate } from '@dagingpeople/api';
import { cx, Icon } from '@dagingpeople/ui';

export type ShiftOption = { value: ScheduleCell; label: string; time?: string };

export const shiftOptions = (templates: ShiftTemplate[]): ShiftOption[] => [
  ...templates.map((t) => ({ value: t.code, label: t.name, time: `${formatClock(t.start)}–${formatClock(t.end)}` })),
  { value: 'OFF', label: 'Libur' },
];

export type ShiftCellMenuProps = {
  value: ScheduleCell;
  options: ShiftOption[];
  /** Nama aksesibel, mis. "Joko Prasetyo, Sen 12 Okt". */
  context: string;
  pending?: boolean;
  onChange: (next: ScheduleCell) => void;
};

/**
 * Sel jadwal yang bisa diedit: tombol membuka menu kecil (menuitemradio).
 * Keyboard: Enter/Spasi/Panah bawah membuka, Panah atas/bawah berpindah, Enter memilih, Esc menutup.
 */
export const ShiftCellMenu = ({ value, options, context, pending, onChange }: ShiftCellMenuProps) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; minWidth: number }>({ top: 0, left: 0, minWidth: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const current = options.find((o) => o.value === value);
  const isOff = value === 'OFF';

  const openMenu = () => {
    const index = Math.max(0, options.findIndex((o) => o.value === value));
    setActiveIndex(index);
    // Posisi fixed agar menu tidak terpotong oleh kotak tabel yang bisa digulir.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const menuHeight = options.length * 44 + 16;
      const below = rect.bottom + 4 + menuHeight <= window.innerHeight;
      const minWidth = Math.max(rect.width, 176);
      setPosition({
        top: below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - menuHeight),
        left: Math.min(rect.left, window.innerWidth - minWidth - 8),
        minWidth,
      });
    }
    setOpen(true);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const handleScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleResize = () => setOpen(false);
    document.addEventListener('pointerdown', handlePointer);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  const choose = (next: ScheduleCell) => {
    close(true);
    if (next !== value) onChange(next);
  };

  const handleTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (pending) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu();
    }
  };

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i >= last ? 0 : i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? last : i - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(last);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="adm-cell-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={cx('adm-cell', isOff ? 'adm-cell--off' : 'adm-cell--shift', open && 'is-open')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${context}: ${current ? `${current.label}${current.time ? ` ${current.time}` : ''}` : 'kosong'}. Ganti shift`}
        aria-busy={pending || undefined}
        // aria-disabled (bukan disabled) agar fokus tetap di sel selama menyimpan.
        aria-disabled={pending || undefined}
        onClick={() => {
          if (pending) return;
          if (open) close(false);
          else openMenu();
        }}
        onKeyDown={handleTriggerKey}
      >
        {pending ? (
          <span className="dp-btn__spinner" aria-hidden="true" />
        ) : (
          <>
            <span className="adm-cell__label">{current?.label ?? '—'}</span>
            {current?.time ? <span className="adm-cell__time dp-num">{current.time}</span> : null}
          </>
        )}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Pilih shift, ${context}`}
          className="adm-menu"
          style={{ top: position.top, left: position.left, minWidth: position.minWidth }}
          onKeyDown={handleMenuKey}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              tabIndex={i === activeIndex ? 0 : -1}
              className={cx('adm-menu__item', o.value === value && 'is-selected')}
              onClick={() => choose(o.value)}
            >
              <span className="adm-menu__check" aria-hidden="true">
                {o.value === value ? <Icon name="check" size={16} /> : null}
              </span>
              <span className="adm-menu__label">{o.label}</span>
              {o.time ? <span className="adm-menu__time dp-num">{o.time}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
