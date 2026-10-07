import { ZodError } from 'zod';
import { DbError } from '../common/db';
import { DomainError, HTTP_STATUS } from '../common/errors';

export type ErrorBody = { code: string; message: string; details?: Record<string, unknown> };

/**
 * Memetakan error ke respons HTTP. Error tak terduga → 500 dengan pesan umum (detail hanya di log server,
 * tidak pernah SQL/stack ke klien).
 */
export const toHttpError = (e: unknown): { status: number; body: ErrorBody; unexpected: boolean } => {
  if (e instanceof DomainError) return { status: HTTP_STATUS[e.kind], body: { code: e.code, message: e.message, details: e.details }, unexpected: false };
  if (e instanceof ZodError) {
    const fields = Object.fromEntries(e.issues.map((i) => [i.path.join('.') || '_', i.message]));
    return { status: 422, body: { code: 'INVALID_REQUEST', message: 'Data yang dikirim belum lengkap atau formatnya salah.', details: { fields } }, unexpected: false };
  }
  if (e instanceof DbError && e.sqlState === 'P0002') return { status: 423, body: { code: 'PAYROLL_FROZEN', message: 'Payroll periode ini sudah disetujui/dikunci dan tidak bisa diubah.' }, unexpected: false };
  if (e instanceof DbError && e.sqlState === 'P0003') return { status: 409, body: { code: 'INVALID_TRANSITION', message: 'Langkah ini belum bisa dilakukan. Selesaikan langkah sebelumnya dulu.' }, unexpected: false };
  if (e instanceof DbError && e.sqlState === '23505') return { status: 409, body: { code: 'DUPLICATE', message: 'Data yang sama sudah ada.' }, unexpected: false };
  return { status: 500, body: { code: 'INTERNAL', message: 'Terjadi kesalahan di server. Coba lagi beberapa saat; bila berulang, hubungi HR/IT.' }, unexpected: true };
};
