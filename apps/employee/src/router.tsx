import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppLinkProps } from '@dagingpeople/ui';

/**
 * Router hash kecil tanpa dependensi. Hash dipilih karena Capacitor memuat aplikasi dari file lokal
 * (tidak ada server yang bisa menulis ulang URL). State navigasi (mis. hasil absen) disimpan di
 * `history.state`, jadi tidak muncul di URL dan tetap ada saat tombol Kembali/Maju dipakai.
 */

export const ROUTES = ['/beranda', '/absen', '/absen-gudang', '/hasil', '/jadwal', '/cuti', '/slip', '/profil'] as const;
export type RoutePath = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: RoutePath = '/beranda';

export type RouteLocation = {
  path: RoutePath;
  query: URLSearchParams;
  /** Data yang dikirim lewat navigate(..., { state }). `undefined` bila halaman dibuka langsung. */
  state: unknown;
  /** Berubah di setiap navigasi; dipakai sebagai key layar agar state layar di-reset. */
  key: number;
};

export type NavigateOptions = { state?: unknown; replace?: boolean };

type RouterValue = { location: RouteLocation; navigate: (to: string, options?: NavigateOptions) => void };

const isRoute = (path: string): path is RoutePath => (ROUTES as readonly string[]).includes(path);

const readLocation = (key: number): RouteLocation => {
  const raw = window.location.hash.replace(/^#/, '') || DEFAULT_ROUTE;
  const [pathPart = '', search = ''] = raw.split('?');
  const path = isRoute(pathPart) ? pathPart : DEFAULT_ROUTE;
  const state: unknown = (window.history.state as { routeState?: unknown } | null)?.routeState;
  return { path, query: new URLSearchParams(search), state, key };
};

const RouterContext = createContext<RouterValue | null>(null);

export const RouterProvider = ({ children }: { children: ReactNode }) => {
  const [location, setLocation] = useState<RouteLocation>(() => readLocation(0));

  useEffect(() => {
    // Rute tidak dikenal → ganti ke beranda tanpa menambah riwayat.
    const raw = window.location.hash.replace(/^#/, '').split('?')[0] ?? '';
    if (!isRoute(raw)) window.history.replaceState(window.history.state, '', `#${DEFAULT_ROUTE}`);
    const sync = () => setLocation((prev) => readLocation(prev.key + 1));
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const href = to.startsWith('#') ? to : `#${to}`;
    const entry = { routeState: options.state };
    if (options.replace) window.history.replaceState(entry, '', href);
    else window.history.pushState(entry, '', href);
    setLocation((prev) => readLocation(prev.key + 1));
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
};

const useRouter = (): RouterValue => {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter harus dipakai di dalam <RouterProvider>.');
  return value;
};

export const useLocation = (): RouteLocation => useRouter().location;
export const useNavigate = (): RouterValue['navigate'] => useRouter().navigate;

/** '/jadwal' → '#/jadwal'. Tautan eksternal (http, mailto, tel) dibiarkan apa adanya. */
export const toHref = (href: string): string => (href.startsWith('/') ? `#${href}` : href);

/**
 * Komponen link untuk <LinkProvider>. Memakai anchor asli (bisa dibuka dengan keyboard, dibaca
 * pembaca layar) dan membiarkan peramban menangani perubahan hash.
 */
export const HashLink = ({ href, children, ...rest }: AppLinkProps) => (
  <a href={toHref(href)} {...rest}>
    {children}
  </a>
);
