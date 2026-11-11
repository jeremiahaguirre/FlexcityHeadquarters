'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CHOICE_EVENT, analyticsState, saveChoice } from '@/lib/analyticsConsent';

/**
 * A small, non-blocking question at the bottom of the page: may we count this visit? Shown only until
 * the visitor answers, and never when the browser sends GPC / Do Not Track. Nothing is counted
 * before "Allow". Not a modal: no focus trap, and the page stays usable behind it.
 */
export function AnalyticsConsent({ title, body, yes, no, more, moreHref }: { title: string; body: string; yes: string; no: string; more: string; moreHref: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const read = () => setShow(analyticsState(navigator, window) === 'unset');
    read();
    window.addEventListener(CHOICE_EVENT, read);
    return () => window.removeEventListener(CHOICE_EVENT, read);
  }, []);
  if (!show) return null;
  const choose = (v: 'on' | 'off') => {
    saveChoice(window, v);
    setShow(false);
    window.dispatchEvent(new Event(CHOICE_EVENT));
  };
  return (
    <section aria-labelledby="analytics-consent-title" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 shadow-lift backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 md:px-6">
        <div className="min-w-0 flex-1 basis-72">
          <h2 id="analytics-consent-title" className="text-small font-semibold text-ink">{title}</h2>
          <p className="text-caption text-muted">
            {body}{' '}
            <Link href={moreHref} className="font-semibold text-brand-text underline">{more}</Link>
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => choose('off')} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-panel px-4 text-small font-semibold text-ink hover:bg-surface">{no}</button>
          <button type="button" onClick={() => choose('on')} className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-small font-semibold text-brand-contrast hover:bg-brand-hover">{yes}</button>
        </div>
      </div>
    </section>
  );
}
