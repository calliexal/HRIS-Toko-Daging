import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ApiError } from './http-client';
import { useApi } from './react';
import type { SessionSnapshot, SessionStore } from './session';
import type { SessionUser } from './types';

const SessionContext = createContext<SessionStore | null>(null);

/**
 * Snapshot untuk SSR & hydration: server tidak bisa membaca sessionStorage, jadi render pertama di klien harus
 * sama (belum siap) agar tidak terjadi hydration mismatch. Sesudah itu React memakai getSnapshot yang asli.
 */
const SERVER_SNAPSHOT: SessionSnapshot = { ready: false, session: null, endReason: null };
const getServerSnapshot = () => SERVER_SNAPSHOT;

/** Membagikan SessionStore ke layar dan membaca sesi tersimpan saat aplikasi dibuka. */
export const SessionProvider = ({ store, children }: { store: SessionStore; children: ReactNode }) => {
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
};

const useSessionStore = (): SessionStore => {
  const store = useContext(SessionContext);
  if (!store) throw new Error('useSession harus dipakai di dalam <SessionProvider>.');
  return store;
};

export const useSession = (): SessionSnapshot & { user: SessionUser | null; logout: () => void } => {
  const store = useSessionStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
  const logout = useCallback(() => store.end('logout'), [store]);
  return { ...snapshot, user: snapshot.session?.user ?? null, logout };
};

// ---------------------------------------------------------------- form login
type Field = 'email' | 'password';

export type LoginNotice = { tone: 'danger' | 'warning' | 'info'; title: string; message: string };

export type LoginFormState = {
  email: string;
  password: string;
  showPassword: boolean;
  capsLock: boolean;
  submitting: boolean;
  errors: Partial<Record<Field, string>>;
  /** Hasil dari server (sandi salah, terkunci, offline) atau pemberitahuan sesi berakhir. */
  notice: LoginNotice | null;
  emailRef: RefObject<HTMLInputElement | null>;
  passwordRef: RefObject<HTMLInputElement | null>;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  toggleShowPassword: () => void;
  blur: (field: Field) => void;
  keyUp: (e: KeyboardEvent<HTMLInputElement>) => void;
  submit: (e?: FormEvent) => Promise<void>;
};

export type UseLoginFormOptions = {
  /** Peran yang boleh masuk ke aplikasi ini. Ditolak → sesi tidak disimpan. */
  canAccess: (user: SessionUser) => boolean;
  /** Pesan bila akun valid tetapi bukan untuk aplikasi ini. */
  deniedMessage: (user: SessionUser) => LoginNotice;
  onSuccess?: (user: SessionUser) => void;
  initialEmail?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validate = (field: Field, value: string): string | undefined => {
  if (field === 'email') {
    if (!value.trim()) return 'Isi email kerja Anda.';
    if (!EMAIL.test(value.trim())) return 'Format email belum benar, contoh: nama@dagingprima.co.id';
    return undefined;
  }
  return value ? undefined : 'Isi kata sandi.';
};

const END_NOTICE: Record<'expired' | 'unauthenticated', LoginNotice> = {
  expired: { tone: 'info', title: 'Sesi berakhir', message: 'Demi keamanan, sesi otomatis berakhir. Silakan masuk lagi.' },
  unauthenticated: { tone: 'info', title: 'Silakan masuk lagi', message: 'Sesi Anda tidak berlaku lagi, misalnya karena akses diubah oleh HR.' },
};

/** Pesan dari server sudah ramah pengguna; di sini hanya dipilih nada dan judulnya. */
const noticeFromError = (e: unknown): { notice: LoginNotice | null; fields?: Partial<Record<Field, string>> } => {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'INVALID_LOGIN':
        return { notice: { tone: 'danger', title: 'Belum bisa masuk', message: e.message } };
      case 'LOGIN_LOCKED':
        return { notice: { tone: 'warning', title: 'Akun terkunci sementara', message: e.message } };
      case 'ACCOUNT_INACTIVE':
        return { notice: { tone: 'danger', title: 'Akun tidak aktif', message: e.message } };
      case 'NETWORK':
        return { notice: { tone: 'warning', title: 'Tidak ada koneksi', message: e.message } };
      case 'INVALID_REQUEST': {
        const f = (e.details?.fields ?? {}) as Record<string, string>;
        return { notice: null, fields: { email: f.email ? 'Format email belum benar.' : undefined, password: f.password ? 'Isi kata sandi.' : undefined } };
      }
      default:
        return { notice: { tone: 'danger', title: 'Belum bisa masuk', message: e.status >= 500 ? 'Server sedang bermasalah. Coba lagi beberapa menit lagi.' : e.message } };
    }
  }
  return { notice: { tone: 'danger', title: 'Belum bisa masuk', message: e instanceof Error ? e.message : 'Coba lagi beberapa saat.' } };
};

/**
 * Logika form login bersama (web admin & aplikasi karyawan).
 * Validasi saat keluar field (blur), error hilang begitu pengguna mengetik, fokus ke field pertama yang salah saat kirim.
 */
export const useLoginForm = (options: UseLoginFormOptions): LoginFormState => {
  const api = useApi();
  const store = useSessionStore();
  const { endReason } = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
  const [email, setEmailValue] = useState(options.initialEmail ?? '');
  const [password, setPasswordValue] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverNotice, setServerNotice] = useState<LoginNotice | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const notice = serverNotice ?? (endReason === 'expired' || endReason === 'unauthenticated' ? END_NOTICE[endReason] : null);

  const setEmail = useCallback((v: string) => {
    setEmailValue(v);
    setErrors((prev) => (prev.email ? { ...prev, email: undefined } : prev));
  }, []);
  const setPassword = useCallback((v: string) => {
    setPasswordValue(v);
    setErrors((prev) => (prev.password ? { ...prev, password: undefined } : prev));
  }, []);

  const blur = useCallback(
    (field: Field) => {
      const value = field === 'email' ? email : password;
      // Field yang belum pernah diisi tidak langsung dimarahi saat sekadar dilewati.
      if (!value) return;
      setErrors((prev) => ({ ...prev, [field]: validate(field, value) }));
    },
    [email, password],
  );

  const keyUp = useCallback((e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false), []);

  const submit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (submitting) return;
      const next = { email: validate('email', email), password: validate('password', password) };
      setErrors(next);
      if (next.email || next.password) {
        (next.email ? emailRef : passwordRef).current?.focus();
        return;
      }
      setSubmitting(true);
      setServerNotice(null);
      try {
        const result = await api.auth.login(email.trim(), password);
        if (!optionsRef.current.canAccess(result.user)) {
          setServerNotice(optionsRef.current.deniedMessage(result.user));
          setPasswordValue('');
          return;
        }
        store.start(result);
        optionsRef.current.onSuccess?.(result.user);
      } catch (err) {
        const { notice: n, fields } = noticeFromError(err);
        setServerNotice(n);
        if (fields) setErrors(fields);
        // Sandi dikosongkan setelah gagal agar tidak terkirim ulang tanpa sengaja; fokus kembali ke sandi.
        if (err instanceof ApiError && (err.code === 'INVALID_LOGIN' || err.code === 'LOGIN_LOCKED')) {
          setPasswordValue('');
          passwordRef.current?.focus();
        }
      } finally {
        setSubmitting(false);
      }
    },
    [api, store, email, password, submitting],
  );

  return useMemo(
    () => ({
      email,
      password,
      showPassword,
      capsLock,
      submitting,
      errors,
      notice,
      emailRef,
      passwordRef,
      setEmail,
      setPassword,
      toggleShowPassword: () => setShowPassword((v) => !v),
      blur,
      keyUp,
      submit,
    }),
    [email, password, showPassword, capsLock, submitting, errors, notice, setEmail, setPassword, blur, keyUp, submit],
  );
};
