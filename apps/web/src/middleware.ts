import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy dengan nonce per request.
 *
 * Token sesi admin ada di sessionStorage, jadi satu celah XSS cukup untuk mencurinya. CSP membatasi kerusakannya:
 * hanya skrip ber-nonce dari Next yang boleh jalan, dan fetch/gambar hanya ke origin sendiri + API, sehingga
 * skrip sisipan tidak bisa mengirim token ke server penyerang.
 *
 * Next.js membaca nonce dari header CSP request dan memasangnya ke skrip framework saat render dinamis
 * (karena itu root layout memakai `dynamic = 'force-dynamic'`).
 */
const apiOrigin = (): string => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? '').origin;
  } catch {
    return '';
  }
};

const buildCsp = (nonce: string, dev: boolean): string =>
  [
    `default-src 'self'`,
    // 'strict-dynamic': skrip yang dimuat oleh skrip ber-nonce (chunk Next) ikut dipercaya. unsafe-eval hanya untuk HMR dev.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    // React & next/font menyisipkan atribut style; style tidak bisa mengeksekusi kode.
    `style-src 'self' 'unsafe-inline'`,
    // data:/blob: untuk gambar QR kiosk gudang dan pratinjau kamera.
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${apiOrigin()}`.trim(),
    `media-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    dev ? '' : 'upgrade-insecure-requests',
  ]
    .filter(Boolean)
    .join('; ');

export const middleware = (request: NextRequest) => {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
};

export const config = {
  matcher: [
    {
      // Aset statis tidak butuh CSP; prefetch dilewati agar nonce tidak dibuat untuk respons yang dibuang.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
