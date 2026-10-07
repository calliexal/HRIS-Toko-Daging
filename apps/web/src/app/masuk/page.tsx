'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@dagingpeople/api';
import { AdminLoginScreen, safeNextPath } from '@/features/auth/AdminLoginScreen';
import { nextWebPaths } from '@/features/paths';

const LoginPageInner = () => {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, session } = useSession();
  const next = safeNextPath(params.get('next'), nextWebPaths.attendance);

  // Sudah login (mis. membuka /masuk dari bookmark) → langsung ke tujuan.
  useEffect(() => {
    if (ready && session) router.replace(next);
  }, [ready, session, next, router]);

  if (!ready || session) return null;
  return <AdminLoginScreen onSignedIn={() => router.replace(next)} />;
};

const LoginPage = () => (
  <Suspense fallback={null}>
    <LoginPageInner />
  </Suspense>
);

export default LoginPage;
