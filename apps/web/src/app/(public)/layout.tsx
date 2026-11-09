import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { AuthLanguageSwitch } from '@/components/shell/AuthLanguageSwitch';
import { DEMO, DEMO_TENANT } from '@/lib/demo';
import { currentTenant } from '@/lib/tenant';

/** Pages anyone can open without signing in (e.g. job postings). */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const tenant = DEMO ? DEMO_TENANT : await currentTenant();
  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Logo variant="mark" size={36} />
            <span className="text-body-strong">{tenant?.name ?? 'FlexcityHeadquarters'}</span>
          </div>
          <AuthLanguageSwitch />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}
