import type { NextConfig } from 'next';

/** Header keamanan untuk semua respons. CSP dipasang terpisah di middleware karena butuh nonce per request. */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Kamera hanya untuk kiosk (pindai kartu/QR) di origin sendiri; fitur sensitif lain dimatikan.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/**
 * Tanpa NEXT_PUBLIC_API_URL web memakai klien mock: data contoh dan akun demo (sandi Demo#2026) yang bisa dimasuki
 * siapa saja. Deploy produksi Vercel yang lupa mengisinya harus gagal build, bukan diam-diam tayang sebagai demo.
 * ALLOW_MOCK_API=true hanya untuk sengaja men-deploy demo publik.
 */
if (process.env.VERCEL_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL?.trim() && process.env.ALLOW_MOCK_API !== 'true') {
  throw new Error('NEXT_PUBLIC_API_URL wajib diisi untuk deploy produksi (mis. https://api.dagingprima.co.id). Isi di Vercel → Settings → Environment Variables.');
}
if (process.env.VERCEL_ENV === 'production' && process.env.NEXT_PUBLIC_API_URL?.trim().startsWith('http://')) {
  throw new Error('NEXT_PUBLIC_API_URL produksi harus https://. Token login tidak boleh lewat koneksi tanpa enkripsi.');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Paket workspace berisi TypeScript/CSS mentah (tanpa langkah build), jadi Next perlu mentranspilasinya.
  transpilePackages: ['@dagingpeople/ui', '@dagingpeople/api', '@dagingpeople/tokens'],
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default nextConfig;
