/**
 * Error domain. Pesan untuk pengguna akhir ditulis dalam bahasa Indonesia sederhana,
 * tidak menyalahkan, dan selalu memberi jalan keluar. Lapisan HTTP memetakan `kind` ke status.
 */
export type ErrorKind = 'validation' | 'not_found' | 'forbidden' | 'conflict' | 'unauthenticated' | 'locked';

export class DomainError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const validation = (code: string, message: string, details?: Record<string, unknown>) => new DomainError('validation', code, message, details);
export const notFound = (code: string, message: string) => new DomainError('not_found', code, message);
export const forbidden = (message = 'Anda tidak punya akses ke data ini.') => new DomainError('forbidden', 'FORBIDDEN', message);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) => new DomainError('conflict', code, message, details);
export const locked = (code: string, message: string, details?: Record<string, unknown>) => new DomainError('locked', code, message, details);

export const HTTP_STATUS: Record<ErrorKind, number> = {
  validation: 422,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  unauthenticated: 401,
  locked: 423,
};
