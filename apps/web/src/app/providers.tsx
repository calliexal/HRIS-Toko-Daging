'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ApiProvider, createHttpClient, createMockClient, createSessionStore, SessionProvider, webStoragePersistence, type HrisClient } from '@dagingpeople/api';
import { LinkProvider, type AppLinkProps } from '@dagingpeople/ui';
import { nextWebPaths, WebPathsProvider } from '@/features/paths';

/** next/link untuk navigasi klien; tautan hash/eksternal tetap anchor biasa. */
const NextAppLink = ({ href, children, ...rest }: AppLinkProps) =>
  href.startsWith('/') ? (
    <Link href={href} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={href} {...rest}>
      {children}
    </a>
  );

/**
 * Sesi di sessionStorage: hilang saat tab ditutup dan tidak terbagi antar-tab (komputer kasir/kantor dipakai bergantian).
 * NEXT_PUBLIC_API_URL diisi → klien HTTP ke API; kosong → data contoh (mock) dengan akun demo.
 */
/**
 * Khusus demo: token perangkat kiosk dari NEXT_PUBLIC_DEMO_KIOSK_TOKENS (JSON {"kiosk-id": "token"}).
 * Variabel NEXT_PUBLIC_* ikut terkirim ke peramban, jadi JANGAN diisi token kiosk produksi; tablet kiosk sungguhan
 * menyimpan tokennya lewat layar setup kiosk (lihat README, pekerjaan lanjutan).
 */
const demoKioskTokens = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(process.env.NEXT_PUBLIC_DEMO_KIOSK_TOKENS ?? '{}');
    return parsed && typeof parsed === 'object' ? Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};
  } catch {
    return {};
  }
};

const createClients = () => {
  const session = createSessionStore({
    persistence: webStoragePersistence(typeof window === 'undefined' ? undefined : window.sessionStorage, 'dp.admin.session'),
  });
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  const client: HrisClient = apiUrl
    ? createHttpClient({
        baseUrl: apiUrl,
        getToken: () => session.token(),
        onUnauthenticated: () => session.end('unauthenticated'),
        kioskToken: (kioskId) => demoKioskTokens()[kioskId],
      })
    : createMockClient();
  return { session, client };
};

export const Providers = ({ children }: { children: ReactNode }) => {
  // Satu instance klien & sesi per tab peramban.
  const [{ session, client }] = useState(createClients);
  return (
    <ApiProvider client={client}>
      <SessionProvider store={session}>
        <LinkProvider component={NextAppLink}>
          <WebPathsProvider paths={nextWebPaths}>{children}</WebPathsProvider>
        </LinkProvider>
      </SessionProvider>
    </ApiProvider>
  );
};
