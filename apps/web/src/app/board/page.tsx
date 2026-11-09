'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';

interface Offer {
  id: string;
  status: 'OPEN' | 'PENDING_APPROVAL';
  shift: {
    id: string;
    version: number;
    startsAt: string;
    endsAt: string;
    facility: { name: string; timezone: string };
    position: { name: string; nameFr: string | null };
  };
}

/** Stored as translation keys, not text, so it re-renders when the language changes. */
type Notice = { kind: 'ok' | 'warn' | 'error'; key: string; params?: Record<string, string>; reasonKeys?: string[] };

export default function BoardPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    try {
      setOffers(await api<Offer[]>('/api/shiftboard/offers'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.push('/login');
      else setNotice({ kind: 'error', key: 'board.error' });
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(o: Offer) {
    setBusy(o.id);
    setNotice(null);
    try {
      const r = await api<{ outcome: 'ASSIGNED' | 'PENDING_APPROVAL'; overtimeHours?: string }>(`/api/offers/${o.id}/claim`, {
        method: 'POST',
        body: { expectedShiftVersion: o.shift.version },
      });
      setNotice(
        r.outcome === 'ASSIGNED'
          ? { kind: 'ok', key: 'board.assigned' }
          : { kind: 'warn', key: 'board.pendingApproval', params: { hours: r.overtimeHours ?? '' } },
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNotice({ kind: 'warn', key: 'board.alreadyClaimed' });
      else if (e instanceof ApiError && e.status === 422) {
        const reasonKeys = ((e.details as { blocks?: Array<{ code: string }> })?.blocks ?? []).map((b) => `blocks.${b.code}`);
        setNotice({ kind: 'error', key: 'board.notEligible', reasonKeys });
      } else setNotice({ kind: 'error', key: 'board.error' });
    } finally {
      setBusy(null);
      void load();
    }
  }

  const fmt = (iso: string, tz: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(i18n.language, { timeZone: tz, ...opts }).format(new Date(iso));

  const tone = { ok: 'border-ok text-ok', warn: 'border-warn text-warn', error: 'border-danger text-danger' };

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">{t('board.title')}</h1>
      <div aria-live="polite">
        {notice ? (
          <div className={`mb-4 rounded-md border-l-4 bg-surface px-4 py-3 ${tone[notice.kind]}`}>
            <p>{t(notice.key, notice.params)}</p>
            {notice.reasonKeys?.length ? (
              <ul className="mt-1 list-disc pl-5 text-ink">
                {notice.reasonKeys.map((k) => (
                  <li key={k}>{t(k)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {offers === null ? null : offers.length === 0 ? (
        <p className="text-muted">{t('board.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {offers.map((o) => {
            const tz = o.shift.facility.timezone;
            const position = i18n.language === 'fr-CA' && o.shift.position.nameFr ? o.shift.position.nameFr : o.shift.position.name;
            return (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {fmt(o.shift.startsAt, tz, { weekday: 'long', month: 'long', day: 'numeric' })}
                  </p>
                  <p className="text-sm text-muted">
                    {fmt(o.shift.startsAt, tz, { hour: 'numeric', minute: '2-digit' })}–{fmt(o.shift.endsAt, tz, { hour: 'numeric', minute: '2-digit' })} · {position} · {o.shift.facility.name}
                  </p>
                </div>
                {o.status === 'PENDING_APPROVAL' ? (
                  <span className="rounded-full bg-surface px-3 py-1 text-sm text-warn">{t('board.pendingBadge')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void claim(o)}
                    disabled={busy !== null}
                    className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast hover:bg-brand-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    {busy === o.id ? t('board.claiming') : t('board.claim')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
