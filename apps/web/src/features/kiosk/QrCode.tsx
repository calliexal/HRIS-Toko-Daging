'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export type QrCodeProps = {
  value: string;
  /** Teks alternatif; token jangan dibacakan (tidak berguna bagi pembaca layar). */
  label: string;
  className?: string;
};

/**
 * Warna QR harus string warna literal untuk generator SVG. Nilai diambil dari token CSS saat runtime
 * (`--ink` & `--surface`) sehingga tidak ada hex di kode aplikasi.
 */
const readTokenColor = (name: string, fallbackVar: string): string => {
  if (typeof window === 'undefined') return fallbackVar;
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return fallbackVar;
  return `#${match
    .slice(0, 3)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`;
};

export const QrCode = ({ value, label, className }: QrCodeProps) => {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const dark = readTokenColor('--ink', '');
    const light = readTokenColor('--surface', '');
    QRCode.toString(value, {
      type: 'svg',
      margin: 0,
      errorCorrectionLevel: 'M',
      ...(dark && light ? { color: { dark, light } } : {}),
    })
      .then((svg) => {
        if (active) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
      })
      .catch(() => {
        if (active) setSrc(null);
      });
    return () => {
      active = false;
    };
  }, [value]);

  return src ? <img src={src} alt={label} className={className} draggable={false} /> : <div className={className} role="img" aria-label={label} />;
};
