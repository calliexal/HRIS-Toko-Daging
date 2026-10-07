import type { BasisPoints, RateBracket, Rupiah } from './types';

/** amount × tarif, dibulatkan ke bawah ke rupiah (dipakai untuk pajak). */
export const applyBpFloor = (amount: Rupiah, rateBp: BasisPoints): Rupiah => Math.floor((amount * rateBp) / 10_000);

/** amount × tarif, dibulatkan ke rupiah terdekat (dipakai untuk iuran BPJS). */
export const applyBpRound = (amount: Rupiah, rateBp: BasisPoints): Rupiah => Math.round((amount * rateBp) / 10_000);

/** Tarif tunggal untuk sebuah nilai (TER): bracket pertama yang batas atasnya ≥ nilai. */
export const lookupRate = (brackets: readonly RateBracket[], amount: Rupiah): BasisPoints => {
  const hit = brackets.find((b) => b.upTo === null || amount <= b.upTo);
  if (!hit) throw new Error('Tabel tarif tidak menutup semua nilai.');
  return hit.rateBp;
};

/** Pajak progresif (Pasal 17): tiap lapisan dikenai tarifnya; hasil dibulatkan ke bawah. */
export const progressiveTax = (taxable: Rupiah, brackets: readonly RateBracket[]): Rupiah => {
  if (taxable <= 0) return 0;
  let lower = 0;
  let scaled = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Number.POSITIVE_INFINITY;
    const slice = Math.min(taxable, upper) - lower;
    if (slice > 0) scaled += slice * b.rateBp;
    if (taxable <= upper) break;
    lower = upper;
  }
  return Math.floor(scaled / 10_000);
};

export const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Pembulatan ke bawah ke ribuan penuh (PKP). */
export const floorThousand = (amount: Rupiah): Rupiah => Math.floor(amount / 1000) * 1000;

/** 5729876 → "5.729.876" tanpa bergantung pada ICU/locale runtime (output harus deterministik). */
export const groupThousands = (n: number): string => {
  const [int, frac] = Math.abs(n).toString().split('.');
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
};
