'use client';

import { Download, Eye, EyeOff, Maximize2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReadinessBars, ScoreRing } from '@/components/platform/trust/charts';
import { trustDownload, useAgo } from '@/components/platform/trust/hooks';
import { errorText } from '@/components/platform/trust/ui';
import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { fr, pick, testTone, useLiveTrust, type Overview } from '@/lib/trust';

/**
 * Present mode: a clean, full-screen view of FH's posture for a call or a screen share. Internal
 * names (risks, customers, failing-test details) stay hidden unless the presenter turns them on.
 * Never says "certified": frameworks read "preparing" with their readiness.
 */
export default function PresentPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const live = useLiveTrust<Overview>('/trust/overview?days=30');
  const o = live.data;
  const [details, setDetails] = useState(false);
  const ago = useAgo(o?.updatedAt ?? null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) window.history.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const lang = fr(i18n.language) ? 'fr' : 'en';
  const download = (format: 'pdf' | 'csv') => void trustDownload(`/trust/summary.${format}?lang=${lang}`, `fh-security-posture.${format}`).catch((e) => toast(errorText(e, t), 'warn'));
  const inScope = o?.frameworks.filter((f) => f.inScope) ?? [];
  const passing = o?.controls.PASSING ?? 0;
  const failing = (o?.tests ?? []).filter((x) => x.status === 'FAIL' || x.status === 'ERROR');
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-page text-ink">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 py-6 md:px-10 md:py-10">
        <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <span className="flex items-center gap-3"><LogoMark size={36} /><span className="text-subheading">FlexcityHeadquarters</span></span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" aria-pressed={details} icon={details ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />} onClick={() => setDetails(!details)}>{details ? t('trust.present.hideDetails') : t('trust.present.showDetails')}</Button>
            <Button variant="ghost" size="sm" icon={<Maximize2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}>{t('trust.present.fullscreen')}</Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => download('pdf')}>PDF</Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => download('csv')}>CSV</Button>
            <Link href="/platform/trust" className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink" aria-label={t('trust.present.exit')}><X className="h-5 w-5" aria-hidden="true" /></Link>
          </div>
        </header>
        <main className="mt-8 grid flex-1 content-center gap-10">
          <section className="text-center">
            <p className="text-label uppercase text-muted">{t('trust.present.eyebrow')}</p>
            <h1 className="mt-2 text-display [text-wrap:balance]">{t('trust.present.title')}</h1>
            <p className="mx-auto mt-3 max-w-2xl text-body text-muted">{t('trust.present.lead')}</p>
          </section>
          {o ? (
            <>
              <section className="grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
                <div className="flex flex-col items-center gap-2">
                  <ScoreRing score={o.score} size={220} label={t('trust.overview.score')} />
                  <p className="text-small text-muted">{t('trust.present.controlsInPlace', { count: passing })}</p>
                </div>
                <div className="rounded-xl2 border border-line bg-panel p-6 shadow-card">
                  <h2 className="mb-4 text-subheading">{t('trust.present.frameworks')}</h2>
                  <ReadinessBars frameworks={inScope} />
                  <p className="mt-4 text-caption text-muted">{t('trust.present.notCertified')}</p>
                </div>
              </section>
              <section className="grid gap-3 sm:grid-cols-3">
                <Stat label={t('trust.present.testsPassing')} value={`${o.tests.filter((x) => x.status === 'PASS').length} / ${o.tests.length}`} />
                <Stat label={t('trust.present.residency')} value={o.tests.find((x) => x.key === 'data_residency')?.status === 'PASS' ? t('trust.present.canada') : '—'} />
                <Stat label={t('trust.present.checked')} value={ago} />
              </section>
              {details ? (
                <section className="rounded-xl2 border border-line bg-panel p-6 shadow-card">
                  <h2 className="text-subheading">{t('trust.present.attention')}</h2>
                  {failing.length ? <ul className="mt-3 grid gap-2">{failing.map((x) => <li key={x.key} className="flex items-start gap-2 text-small"><StatusPill tone={testTone(x.status)}>{t(`trust.testStatus.${x.status}`)}</StatusPill><span><span className="font-semibold">{pick(x, 'title', i18n.language)}</span> · {pick(x, 'summary', i18n.language)}</span></li>)}</ul> : <p className="mt-2 text-small text-muted">{t('trust.overview.noneFailing')}</p>}
                </section>
              ) : null}
            </>
          ) : <p className="text-center text-muted">{t('common.loading')}</p>}
        </main>
        {/* Only a configured address (SECURITY_EMAIL on the API): never a placeholder in front of a customer. */}
        {o?.securityContact ? <footer className="mt-10 text-center text-caption text-muted">{t('trust.present.footer', { email: o.securityContact })}</footer> : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl2 border border-line bg-panel p-5 text-center shadow-card">
      <p className="text-small text-muted">{label}</p>
      <p className="mt-1 text-heading">{value}</p>
    </div>
  );
}
