'use client';

import { Wrench, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEMO } from '@/lib/demo';
import { pick } from '@/lib/noteText';
import { useLiveChange } from '@/lib/useLiveChange';
import { useQuery } from '@/lib/useQuery';

interface Banner { id: string; startsAt: string; endsAt: string; message: { en: string; fr: string }; status: 'upcoming' | 'active' }
/** Heads-up banners this person closed (per window), on this device. */
const DISMISSED_KEY = 'fh-maintenance-dismissed';

function dismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** "Thursday 10:00 p.m. – 11:30 p.m." on this device. */
export function windowLabel(b: Pick<Banner, 'startsAt' | 'endsAt'>, lang: string): string {
  const s = new Date(b.startsAt);
  const e = new Date(b.endsAt);
  const day = new Intl.DateTimeFormat(lang, { weekday: 'long', month: 'long', day: 'numeric' });
  const time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' });
  return s.toDateString() === e.toDateString() ? `${day.format(s)}, ${time.format(s)} – ${time.format(e)}` : `${day.format(s)}, ${time.format(s)} – ${day.format(e)}, ${time.format(e)}`;
}

/**
 * Planned maintenance (services/platform/maintenance.ts on the API): a short heads-up the day
 * before, which can be closed, and a banner while it lasts. Informational: the app keeps working
 * as well as it can. `signedOut` reads the sign-in page's version (no session).
 */
export function MaintenanceBanner({ signedOut = false }: { signedOut?: boolean }) {
  const { t, i18n } = useTranslation();
  const q = useQuery<{ banners: Banner[] }>(DEMO ? null : signedOut ? '/api/public/maintenance' : '/api/maintenance');
  useLiveChange('updates', q.reload);
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => setClosed(dismissed()), []);
  // Refetch the moment a heads-up turns into the window, or the window ends (no polling).
  const banners = q.data?.banners ?? [];
  useEffect(() => {
    const now = Date.now();
    const next = banners.flatMap((b) => [Date.parse(b.startsAt), Date.parse(b.endsAt)]).filter((x) => x > now).sort((x, y) => x - y)[0];
    if (!next || next - now > 2 ** 31 - 1) return;
    const id = setTimeout(() => void q.reload(), next - now + 1000);
    return () => clearTimeout(id);
  }, [banners.map((b) => b.id + b.status).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = banners.filter((b) => b.status === 'active' || !closed.includes(b.id));
  if (!shown.length) return null;
  const lang = i18n.language;
  return (
    <div className="mb-6 grid gap-2">
      {shown.map((b) => (
        <div key={b.id} role="status" className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-small text-ink ${b.status === 'active' ? 'border-warn/40 bg-warn/10' : 'border-line bg-panel'}`}>
          <Wrench className={`mt-0.5 h-4 w-4 shrink-0 ${b.status === 'active' ? 'text-warn' : 'text-muted'}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{b.status === 'active' ? t('maintenance.now', { until: new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(new Date(b.endsAt)) }) : t('maintenance.soon', { when: windowLabel(b, lang) })}</p>
            <p className="text-muted">{pick(lang, b.message)}</p>
          </div>
          {b.status === 'upcoming' ? (
            <button
              type="button"
              className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:text-ink"
              aria-label={t('common.dismiss')}
              onClick={() => {
                const next = [...new Set([...dismissed(), b.id])].slice(-20);
                try {
                  localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
                } catch {
                  /* storage blocked: closed for this visit */
                }
                setClosed(next);
              }}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
