import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CoBrand } from '@/components/CoBrand';
import { Logo } from '@/components/Logo';
import { AuthLanguageSwitch } from '@/components/shell/AuthLanguageSwitch';
import { PRIVATE_ROBOTS, PUBLIC_ROBOTS } from '@/lib/crawlers';
import { DEMO, DEMO_TENANT } from '@/lib/demo';
import { currentTenant } from '@/lib/tenant';
import { UnknownOrg } from '@/components/UnknownOrg';

// Job postings and sign-up may appear in search results (never in the demo); no AI training either way.
export const metadata: Metadata = { robots: DEMO ? PRIVATE_ROBOTS : PUBLIC_ROBOTS };

/** Pages anyone can open without signing in (e.g. job postings). */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const tenant = DEMO ? DEMO_TENANT : await currentTenant();
  if (!tenant) return <UnknownOrg />;
  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          {tenant ? <CoBrand org={{ name: tenant.name, logoUrl: tenant.logoUrl }} logoSize={32} /> : <Logo size={32} />}
          <AuthLanguageSwitch />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}
