'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { canUseAdminWeb, ROLE_LABEL, useSession } from '@dagingpeople/api';
import { AdminShell } from '@/features/admin/AdminShell';

/**
 * Jembatan Next → fitur + penjaga sesi. Token ada di sessionStorage (hanya di peramban), jadi pengecekan
 * dilakukan di klien; server API tetap menolak setiap request tanpa token sah (pertahanan sebenarnya).
 */
export const AdminFrame = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, user, logout } = useSession();
  const allowed = user ? canUseAdminWeb(user) : false;

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace(`/masuk?next=${encodeURIComponent(pathname)}`);
    else if (!allowed) logout();
  }, [ready, user, allowed, pathname, router, logout]);

  if (!ready || !user || !allowed) return <div className="adm-gate" aria-busy="true" aria-label="Memeriksa sesi" />;
  return (
    <AdminShell currentPath={pathname} account={{ name: user.name, role: user.role, roleLabel: ROLE_LABEL[user.role] }} onLogout={logout}>
      {children}
    </AdminShell>
  );
};
