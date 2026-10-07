import { canUseEmployeeApp, DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_LABEL, useApi, useLoginForm } from '@dagingpeople/api';
import { DemoBadge, LoginForm } from '@dagingpeople/ui';

/** Akun demo yang punya data karyawan (bisa memakai aplikasi HP). */
const DEMO_EMPLOYEE_ACCOUNTS = DEMO_ACCOUNTS.filter((a) => a.role === 'employee' || a.role === 'store_manager');

/**
 * M0 · Masuk. Satu kolom, kontrol 56px (dipakai sambil berdiri/bersarung tangan),
 * keyboard email & isi otomatis pengelola sandi (autocomplete username/current-password).
 */
export const LoginScreen = () => {
  const api = useApi();
  const form = useLoginForm({
    canAccess: canUseEmployeeApp,
    deniedMessage: (user) => ({
      tone: 'info',
      title: 'Akun ini untuk web admin',
      message: `Akun ${ROLE_LABEL[user.role]} tidak terhubung ke data karyawan. Buka DagingPeople di komputer (web admin) untuk masuk.`,
    }),
  });

  return (
    <div className="emp-login">
      <header className="emp-login__header">
        <p className="emp-login__brand">DagingPeople</p>
        <h1 className="t-h1">Masuk</h1>
        <p className="emp-muted">Absen, lihat jadwal, ajukan cuti, dan buka slip gaji.</p>
      </header>

      <LoginForm
        form={form}
        size="lg"
        footer={
          <>
            Lupa kata sandi atau ganti HP? <strong>Hubungi HR</strong> untuk reset.
          </>
        }
      />

      {api.isMock ? (
        <section className="emp-login__demo" aria-labelledby="emp-login-demo">
          <div className="emp-login__demo-head">
            <h2 id="emp-login-demo" className="t-body-strong">
              Akun contoh
            </h2>
            <DemoBadge show />
          </div>
          <p className="t-small emp-muted">
            Kata sandi semua akun: <span className="dp-num">{DEMO_PASSWORD}</span>
          </p>
          <ul className="emp-login__demo-list">
            {DEMO_EMPLOYEE_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="emp-login__demo-item"
                  onClick={() => {
                    form.setEmail(a.email);
                    form.setPassword(DEMO_PASSWORD);
                  }}
                >
                  <span className="t-body-strong">{a.name}</span>
                  <span className="t-small emp-muted">
                    {ROLE_LABEL[a.role]} · {a.email}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
