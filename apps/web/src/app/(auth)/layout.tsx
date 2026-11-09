import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { AuthLanguageSwitch } from '@/components/shell/AuthLanguageSwitch';
import { DEMO, DEMO_TENANT } from '@/lib/demo';
import { currentTenant } from '@/lib/tenant';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const tenant = DEMO ? DEMO_TENANT : await currentTenant();
  return (
    <div className="relative grid min-h-screen bg-page lg:grid-cols-2">
      <div className="absolute right-4 top-4 z-10">
        <AuthLanguageSwitch />
      </div>
      <main id="main" className="flex flex-col justify-center px-6 py-16 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex flex-col items-center text-center">
            <Logo variant="stacked" size={88} />
            {tenant ? <p className="mt-5 rounded-full bg-surface px-3 py-1 text-caption text-muted">{tenant.name}</p> : null}
          </div>
          {children}
        </div>
      </main>
      {/* Calm brand panel on large screens */}
      <div aria-hidden="true" className="relative hidden overflow-hidden bg-[linear-gradient(150deg,#0B3B3C_0%,#0F766E_55%,#14B8A6_100%)] lg:block">
        <svg className="absolute -bottom-10 -right-10 h-[115%] opacity-[0.14]" viewBox="0 0 120 120" fill="none">
          <path fill="#fff" d="M37 110C24 88 19 60 26 40 33 20 53 10 76 8.5 87 8 95 9.5 101 12.5 85 14.5 69 18.5 58 25.5 47.5 32.5 42.5 44 42.5 58 42.5 76 41.5 94 37 110Z" />
          <path fill="#fff" d="M42.5 60C53 50 69 47 88 48 75 52 63 56 52 64 47.5 67 43.5 64.5 42.5 60Z" />
          <circle cx="77" cy="86" r="22" fill="#fff" />
        </svg>
        <div className="absolute inset-x-12 bottom-14 max-w-md text-white">
          <p className="text-label uppercase tracking-[0.18em] text-[#C5F23A]">FlexcityHeadquarters</p>
          <p className="mt-3 text-title text-white">Every shift covered, every guard certified, every pool ready.</p>
        </div>
      </div>
    </div>
  );
}
