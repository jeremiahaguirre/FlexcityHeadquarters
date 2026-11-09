import type { ReactNode } from 'react';
import { ServiceWorker } from '@/components/ServiceWorker';
import { AppShell } from '@/components/shell/AppShell';
import { ShellLoading } from '@/components/shell/ShellLoading';
import { DEMO, DEMO_TENANT } from '@/lib/demo';
import { SessionProvider } from '@/lib/session';
import { currentTenant } from '@/lib/tenant';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const tenant = DEMO ? DEMO_TENANT : await currentTenant();
  return (
    <SessionProvider fallback={<ShellLoading />}>
      <ServiceWorker />
      <AppShell organization={{ name: tenant?.name ?? '', logoUrl: tenant?.logoUrl ?? null }}>{children}</AppShell>
    </SessionProvider>
  );
}
