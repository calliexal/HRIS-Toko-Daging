import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import '@dagingpeople/tokens/tokens.css';
import '@dagingpeople/ui/styles.css';
import '../styles/admin.css';
import '../styles/kiosk.css';
import { Providers } from './providers';

// Dipasang ke --font-sans pada <body>: tokens.css mendefinisikan --font-sans di :root, dan deklarasi di <body>
// selalu menimpa nilai warisan :root tanpa bergantung pada urutan stylesheet.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
});

// Render per request agar Next bisa memasang nonce CSP (lihat src/middleware.ts) ke skripnya.
// Halaman statis dibuat saat build, tanpa nonce, sehingga skripnya akan diblokir CSP.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'DagingPeople', template: '%s · DagingPeople' },
  description: 'HRIS DagingPeople: kehadiran, jadwal shift, persetujuan, payroll, dan kiosk absensi.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="id">
    <body className={jakarta.variable}>
      <Providers>{children}</Providers>
    </body>
  </html>
);

export default RootLayout;
