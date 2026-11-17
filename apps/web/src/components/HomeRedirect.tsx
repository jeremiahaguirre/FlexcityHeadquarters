'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ShellLoading } from '@/components/shell/ShellLoading';
import { api } from '@/lib/api';
import { homePath } from '@/lib/nav';

/** Sends people to the first screen their role can use, or to sign-in. */
export function HomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    api<{ permissions: string[]; hiddenMenu?: string[]; features?: Record<string, boolean> }>('/api/me')
      .then((me) => router.replace(homePath((p) => me.permissions.includes(p), me.hiddenMenu ?? [], me.features)))
      .catch(() => router.replace('/login'));
  }, [router]);
  return <ShellLoading />;
}
