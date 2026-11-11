'use client';

import { ArrowLeftRight, CalendarDays, CalendarPlus, Gift, PhoneCall } from 'lucide-react';
import { MyTrades, TradeDialog } from '@/components/shiftboard/Trades';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShiftCard, type ShiftLike } from '@/components/ShiftCard';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { dateFormat, formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface Shift extends ShiftLike {
  id: string;
  assignee: { id: string; name: string } | null;
  offer?: { id: string; status: 'OPEN' | 'PENDING_APPROVAL' } | null;
}

const range = () => {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: new Date(from.getTime() + 28 * 86_400_000).toISOString() };
};

function groupByDay<T extends ShiftLike>(list: T[]): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  for (const s of list) m.set(s.localStartsAt.slice(0, 10), [...(m.get(s.localStartsAt.slice(0, 10)) ?? []), s]);
  return [...m];
}

export default function SchedulePage() {
  const { t, i18n } = useTranslation();
  const { me, can } = useSession();
  const [view, setView] = useState<'mine' | 'everyone'>('mine');
  const r = range();
  const q = `from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`;
  const mine = useQuery<Shift[]>(`/api/me/shifts?${q}`);
  const everyone = useQuery<Shift[]>(view === 'everyone' ? `/api/shifts?${q}` : null);
  const { run, busy } = useAction();
  const list = view === 'mine' ? mine : everyone;
  const [trading, setTrading] = useState<string | null>(null);

  const giveAway = (s: Shift) =>
    run(`give-${s.id}`, () => api(`/api/shifts/${s.id}/offer`, { method: 'POST' }), t('schedule.posted')).then(() => mine.reload());

  return (
    <>
      <PageHeader
        title={t('schedule.title')}
        description={t('schedule.description')}
        actions={
          <Segmented
            label={t('schedule.view')}
            value={view}
            onChange={setView}
            options={[
              { value: 'mine', label: t('schedule.mine') },
              { value: 'everyone', label: t('schedule.everyone') },
            ]}
          />
        }
      />
      {view === 'mine' ? (
        <div className="mb-6 grid gap-3">
          <MyTrades onChanged={() => void mine.reload()} />
          <MyOnCall />
          <p className="text-small"><Link href="/profile#calendar" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-text hover:underline sm:min-h-0"><CalendarPlus className="h-4 w-4" aria-hidden="true" />{t('calendarFeed.addToCalendar')}</Link></p>
        </div>
      ) : null}
      {list.loading ? (
        <ListSkeleton />
      ) : list.error ? (
        <ErrorNotice onRetry={list.reload} />
      ) : !list.data?.length ? (
        <EmptyState icon={CalendarDays} title={t('schedule.emptyTitle')} action={can('shiftboard.claim') ? <ButtonLink href="/board">{t('today.findShift')}</ButtonLink> : undefined}>
          {t('schedule.emptyBody')}
        </EmptyState>
      ) : (
        <div className="grid gap-6">
          {groupByDay(list.data).map(([day, shifts]) => (
            <section key={day} aria-label={formatDate(`${day}T12:00:00`, i18n.language, 'long')}>
              {/* Each card's date tile already shows the day: the heading is for screen readers only. */}
              <h2 className="sr-only">{formatDate(`${day}T12:00:00`, i18n.language, 'long')}</h2>
              <div className="fh-stagger grid gap-3">
                {shifts.map((s) => {
                  const isMine = s.assignee?.id === me?.id || view === 'mine';
                  return (
                    <ShiftCard
                      key={s.id}
                      shift={s}
                      highlight={view === 'everyone' && isMine}
                      aside={
                        view === 'everyone' ? (
                          s.assignee ? (
                            <StatusPill tone={isMine ? 'brand' : 'neutral'}>{isMine ? t('schedule.you') : s.assignee.name}</StatusPill>
                          ) : (
                            <StatusPill tone="new" icon={<CalendarPlus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}>{t('schedule.open')}</StatusPill>
                          )
                        ) : s.offer ? (
                          <StatusPill tone={s.offer.status === 'PENDING_APPROVAL' ? 'warn' : 'new'}>
                            {s.offer.status === 'PENDING_APPROVAL' ? t('schedule.claimPending') : t('schedule.onBoard')}
                          </StatusPill>
                        ) : null
                      }
                      footer={
                        view === 'mine' && !s.offer && can('shiftboard.post') ? (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" size="sm" icon={<Gift className="h-4 w-4" aria-hidden="true" />} loading={busy === `give-${s.id}`} onClick={() => void giveAway(s)}>
                              {t('schedule.giveAway')}
                            </Button>
                            <Button variant="ghost" size="sm" icon={<ArrowLeftRight className="h-4 w-4" aria-hidden="true" />} onClick={() => setTrading(s.id)}>
                              {t('trades.trade')}
                            </Button>
                          </div>
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <TradeDialog shiftId={trading} onClose={() => setTrading(null)} onDone={() => setTrading(null)} />
    </>
  );
}

/** The person's own on-call (standby) periods, when they have any. */
function MyOnCall() {
  const { t, i18n } = useTranslation();
  const q = useQuery<Array<{ id: string; startsAt: string; endsAt: string; department: { name: string; nameFr: string | null } | null; note: string | null }>>('/api/me/on-call');
  if (!q.data?.length) return null;
  const fmt = (iso: string) => dateFormat(i18n.language, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  return (
    <section className="rounded-2xl border border-line bg-panel p-4" aria-labelledby="my-on-call">
      <h2 id="my-on-call" className="flex items-center gap-2 text-small font-semibold"><PhoneCall className="h-4 w-4 text-brand-text" aria-hidden="true" />{t('onCall.mine')}</h2>
      <ul className="mt-2 grid gap-1 text-small">
        {q.data.map((p) => (
          <li key={p.id}>
            {fmt(p.startsAt)} – {fmt(p.endsAt)}
            {p.department ? <span className="text-muted"> · {i18n.language === 'fr-CA' && p.department.nameFr ? p.department.nameFr : p.department.name}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
