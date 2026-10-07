'use client';

import { canUseAdminWeb, DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_LABEL, useApi, useLoginForm, type SessionUser } from '@dagingpeople/api';
import { DemoBadge, LoginForm } from '@dagingpeople/ui';

const DEMO_ADMIN_ACCOUNTS = DEMO_ACCOUNTS.filter((a) => a.role !== 'employee');

export type AdminLoginScreenProps = {
  /** Dipanggil setelah sesi tersimpan; halaman mengarahkan ke tujuan semula. */
  onSignedIn: (user: SessionUser) => void;
};

/**
 * W0 · Masuk web admin (Kepala Toko, HR, Finance, Owner). Framework-agnostic: Next.js dan demo statis
 * hanya menyuntikkan aksi setelah login.
 */
export const AdminLoginScreen = ({ onSignedIn }: AdminLoginScreenProps) => {
  const api = useApi();
  const form = useLoginForm({
    canAccess: canUseAdminWeb,
    deniedMessage: () => ({
      tone: 'info',
      title: 'Akun karyawan memakai aplikasi HP',
      message: 'Absen, jadwal, cuti, dan slip gaji ada di aplikasi DagingPeople di HP Anda. Web admin hanya untuk Kepala Toko, HR, Finance, dan Owner.',
    }),
    onSuccess: onSignedIn,
  });

  return (
    <main className="adm-login" id="adm-main">
      <div className="adm-login__panel">
        <header className="adm-login__header">
          <p className="adm-login__brand">DagingPeople</p>
          <h1 className="t-h1">Masuk ke web admin</h1>
          <p className="adm-login__lead">Untuk Kepala Toko, HR, Finance, dan Owner.</p>
        </header>
        <LoginForm
          form={form}
          footer={
            <>
              Lupa kata sandi? Hubungi HR untuk reset. Sesi berakhir otomatis setelah 12 jam atau saat tab ditutup.
            </>
          }
        />
      </div>

      {api.isMock ? (
        <section className="adm-login__demo" aria-labelledby="adm-login-demo">
          <div className="adm-login__demo-head">
            <h2 id="adm-login-demo" className="t-body-strong">
              Akun contoh
            </h2>
            <DemoBadge show />
          </div>
          <p className="t-small adm-login__muted">
            Pilih untuk mengisi form. Kata sandi: <span className="dp-num">{DEMO_PASSWORD}</span>
          </p>
          <ul className="adm-login__demo-list">
            {DEMO_ADMIN_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="adm-login__demo-item"
                  onClick={() => {
                    form.setEmail(a.email);
                    form.setPassword(DEMO_PASSWORD);
                    form.passwordRef.current?.focus();
                  }}
                >
                  <span className="t-body-strong">{ROLE_LABEL[a.role]}</span>
                  <span className="t-small adm-login__muted">{a.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
};

/** Hanya izinkan tujuan internal (cegah open redirect lewat ?next=https://...). */
export const safeNextPath = (next: string | null | undefined, fallback: string): string =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') && !next.startsWith('/masuk') ? next : fallback;
