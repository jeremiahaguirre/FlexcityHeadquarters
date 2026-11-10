'use client';

import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/components/Logo';

/** Full-screen loading: the FH mark draws itself, again and again, until the app is ready. */
export function ShellLoading() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-screen place-items-center bg-page" role="status" aria-live="polite">
      <div className="grid justify-items-center gap-5">
        <div className="relative grid place-items-center">
          <span aria-hidden="true" className="absolute h-28 w-28 rounded-full bg-[radial-gradient(closest-side,rgb(var(--brand)/0.18),transparent)]" />
          <LogoMark size={76} animate="loop" className="relative" />
        </div>
        <p className="font-display text-[17px] leading-none tracking-[-0.035em]" aria-hidden="true">
          <span className="font-extrabold text-ink">Flexcity</span>
          <span className="font-medium text-brand-text">Headquarters</span>
        </p>
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    </div>
  );
}
