import type { ReactNode } from 'react';
import { BrandMotto } from '@/components/BrandMotto';
import { CityBrand } from '@/components/CoBrand';
import { Logo } from '@/components/Logo';
import { AuthLanguageSwitch } from '@/components/shell/AuthLanguageSwitch';
import { DEMO, DEMO_TENANT } from '@/lib/demo';
import { currentTenant } from '@/lib/tenant';
import { UnknownOrg } from '@/components/UnknownOrg';
import { ServiceWorker } from '@/components/ServiceWorker';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const tenant = DEMO ? DEMO_TENANT : await currentTenant();
  if (!tenant) return <UnknownOrg />;
  return (
    <div className="relative grid min-h-screen bg-page lg:grid-cols-2">
      <ServiceWorker />
      <div className="absolute right-4 top-4 z-10">
        <AuthLanguageSwitch />
      </div>
      <main id="main" className="flex flex-col justify-center px-6 py-16 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex flex-col items-center text-center">
            <Logo variant="stacked" size={88} />
            {tenant ? (
              <div className="mt-6 flex w-full flex-col items-center gap-2 border-t border-line pt-5">
                <CityBrand org={{ name: tenant.name, logoUrl: tenant.logoUrl }} size="lg" />
                {tenant.logoUrl ? <p className="text-caption text-muted">{tenant.name}</p> : null}
              </div>
            ) : null}
          </div>
          {children}
        </div>
      </main>
      {/* Calm brand panel on large screens */}
      <div aria-hidden="true" className="relative hidden overflow-hidden bg-[linear-gradient(150deg,#082E2C_0%,#0D5F59_55%,#3A8C82_100%)] lg:block">
        <svg className="absolute -bottom-10 -right-10 h-[115%] opacity-[0.14]" viewBox="0 0 120 120" fill="none">
          <path fill="#fff" d="M37 110C24 88 19 60 26 40 33 20 53 10 76 8.5 87 8 95 9.5 101 12.5 85 14.5 69 18.5 58 25.5 47.5 32.5 42.5 44 42.5 58 42.5 76 41.5 94 37 110Z" />
          <path fill="#fff" d="M42.5 60C53 50 69 47 88 48 75 52 63 56 52 64 47.5 67 43.5 64.5 42.5 60Z" />
          <circle cx="77" cy="86" r="22" fill="#fff" />
        </svg>
        <div className="absolute inset-x-12 bottom-14 max-w-md text-white">
          <BrandMotto />
        </div>
      </div>
    </div>
  );
}
