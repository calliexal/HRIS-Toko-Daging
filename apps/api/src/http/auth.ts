import type { Actor, KioskActor } from '../common/actor';
import { DomainError, forbidden } from '../common/errors';
import type { AppServices } from '../app/container';

export type AuthMode = 'public' | 'user' | 'kiosk';
type Headers = Record<string, string | string[] | undefined>;

const header = (h: Headers, name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Autentikasi per endpoint (dipakai AuthGuard NestJS dan server uji).
 *  - user : Bearer JWT → Actor (role & lingkup lokasi dibaca ulang dari DB).
 *  - kiosk: X-Kiosk-Token → KioskActor; `:kioskId` di path wajib milik token itu.
 */
export const resolveAuth = async (
  mode: AuthMode,
  headers: Headers,
  params: Record<string, string>,
  svc: Pick<AppServices, 'auth' | 'kiosk'>,
): Promise<{ actor: Actor | null; kiosk: KioskActor | null }> => {
  if (mode === 'public') return { actor: null, kiosk: null };
  if (mode === 'kiosk') {
    const token = header(headers, 'x-kiosk-token');
    const kiosk = token ? await svc.kiosk.authenticate(token) : null;
    if (!kiosk) throw new DomainError('unauthenticated', 'KIOSK_UNAUTHENTICATED', 'Perangkat kiosk belum terdaftar atau dinonaktifkan. Hubungi HR.');
    if (params.kioskId && params.kioskId !== kiosk.kioskId) throw forbidden('Token perangkat bukan milik kiosk ini.');
    return { actor: null, kiosk };
  }
  const auth = header(headers, 'authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const actor = token ? await svc.auth.verify(token) : null;
  if (!actor) throw new DomainError('unauthenticated', 'UNAUTHENTICATED', 'Sesi berakhir. Silakan masuk lagi.');
  return { actor, kiosk: null };
};
