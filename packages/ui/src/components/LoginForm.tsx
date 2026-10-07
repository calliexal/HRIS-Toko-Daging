import { useId, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx } from '../cx';
import { Button } from './Button';
import { Icon } from './Icon';
import { Banner } from './Surfaces';

/** Bentuk state form (dipenuhi oleh `useLoginForm` dari @dagingpeople/api). UI tetap bebas dari logika API. */
export type LoginFormView = {
  email: string;
  password: string;
  showPassword: boolean;
  capsLock: boolean;
  submitting: boolean;
  errors: Partial<Record<'email' | 'password', string>>;
  notice: { tone: 'danger' | 'warning' | 'info'; title: string; message: string } | null;
  emailRef: RefObject<HTMLInputElement | null>;
  passwordRef: RefObject<HTMLInputElement | null>;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  toggleShowPassword: () => void;
  blur: (field: 'email' | 'password') => void;
  keyUp: (e: KeyboardEvent<HTMLInputElement>) => void;
  submit: (e?: FormEvent) => Promise<void>;
};

export type LoginFormProps = {
  form: LoginFormView;
  /** Ukuran kontrol: `lg` (56px) untuk aplikasi HP yang dipakai sambil berdiri, `md` untuk web admin. */
  size?: 'md' | 'lg';
  /** Teks bantuan di bawah tombol, mis. cara reset sandi. */
  footer?: ReactNode;
};

/**
 * Form login: email + kata sandi (bisa ditampilkan), peringatan Caps Lock, pesan server di atas form.
 * `noValidate` karena validasi ditangani sendiri (pesan bahasa Indonesia, blur-first).
 */
export const LoginForm = ({ form, size = 'md', footer }: LoginFormProps) => {
  const id = useId();
  const emailId = `${id}-email`;
  const passwordId = `${id}-password`;
  const pwHint = form.capsLock && !form.errors.password ? `${passwordId}-caps` : undefined;

  return (
    <form className={cx('dp-login', `dp-login--${size}`)} onSubmit={form.submit} noValidate aria-busy={form.submitting || undefined}>
      {form.notice ? (
        <Banner tone={form.notice.tone} title={form.notice.title} role="alert">
          {form.notice.message}
        </Banner>
      ) : null}

      <div className={cx('dp-field', form.errors.email && 'dp-field--error')}>
        <label htmlFor={emailId} className="dp-field__label">
          Email kerja
        </label>
        <input
          ref={form.emailRef}
          id={emailId}
          className="dp-input"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="nama@dagingprima.co.id"
          value={form.email}
          onChange={(e) => form.setEmail(e.target.value)}
          onBlur={() => form.blur('email')}
          aria-invalid={form.errors.email ? true : undefined}
          aria-describedby={form.errors.email ? `${emailId}-error` : undefined}
          required
        />
        {form.errors.email ? (
          <p id={`${emailId}-error`} className="dp-field__error">
            {form.errors.email}
          </p>
        ) : null}
      </div>

      <div className={cx('dp-field', form.errors.password && 'dp-field--error')}>
        <label htmlFor={passwordId} className="dp-field__label">
          Kata sandi
        </label>
        <div className="dp-login__password">
          <input
            ref={form.passwordRef}
            id={passwordId}
            className="dp-input"
            type={form.showPassword ? 'text' : 'password'}
            name="password"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={form.password}
            onChange={(e) => form.setPassword(e.target.value)}
            onBlur={() => form.blur('password')}
            onKeyUp={form.keyUp}
            aria-invalid={form.errors.password ? true : undefined}
            aria-describedby={form.errors.password ? `${passwordId}-error` : pwHint}
            required
          />
          <button
            type="button"
            className="dp-login__reveal"
            onClick={form.toggleShowPassword}
            aria-label={form.showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
            aria-pressed={form.showPassword}
            aria-controls={passwordId}
            title={form.showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
          >
            <Icon name={form.showPassword ? 'eye-off' : 'eye'} size={20} />
          </button>
        </div>
        {form.errors.password ? (
          <p id={`${passwordId}-error`} className="dp-field__error">
            {form.errors.password}
          </p>
        ) : form.capsLock ? (
          <p id={`${passwordId}-caps`} className="dp-field__hint dp-login__caps">
            <Icon name="alert-triangle" size={16} /> Caps Lock menyala
          </p>
        ) : null}
      </div>

      <Button type="submit" size={size} block loading={form.submitting} icon="log-in">
        {form.submitting ? 'Memeriksa…' : 'Masuk'}
      </Button>

      {footer ? <div className="dp-login__footer">{footer}</div> : null}
    </form>
  );
};
