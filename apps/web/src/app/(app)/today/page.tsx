'use client';

import { MyStation } from '@/components/punch/MyStation';
import { MyCare } from '@/components/people/MyCare';
import { PoliciesBanner } from '@/components/hr/Policies';
import { MyAnnouncements } from '@/components/communication/Notices';
import { MyOnboarding } from '@/components/people/MyOnboarding';
import { SurveyNudge } from '@/components/surveys/SurveyNudge';
import { ArrowRight, CalendarOff, ClipboardCheck, Repeat, Waves } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShiftCard, type ShiftLike } from '@/components/ShiftCard';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hero } from '@/components/ui/Hero';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate, formatTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useQuery } from '@/lib/useQuery';
import { PunchControl } from '@/components/punch/PunchControl';
import { CountUp } from '@/components/ui/CountUp';

interface Offer { id: string; status: string }
interface Pool { id: string; name: string; status: 'OPEN' | 'CLOSURE_RECOMMENDED' | 'CLOSED' }


function Tile({ href, icon, label, value, tone }: { href: string; icon: ReactNode; label: string; value: ReactNode; tone?: 'warn' | 'new' }) {
  return (
    <Link href={href} className="fh-lift group flex items-center gap-4 rounded-xl2 border border-line bg-panel p-4 shadow-card hover:border-brand/40">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${tone === 'warn' ? 'bg-warn-bg text-warn' : tone === 'new' ? 'bg-new-bg text-new' : 'bg-brand/10 text-brand-text'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-heading tabular-nums text-ink">{typeof value === 'number' ? <CountUp value={value} format={String} /> : value}</span>
        <span className="block text-small text-muted">{label}</span>
      </span>
      <ArrowRight className="h-5 w-5 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

/** Home screen: today's shift and clock-in, then tiles for what is waiting (open shifts, approvals, pool status), each shown only with the permission behind it. */
export default function TodayPage() {
  const { t, i18n } = useTranslation();
  const { me, can } = useSession();
  // Fixed once per visit: a range that changed every render would refetch forever.
  const [range] = useState(() => {
    const from = new Date();
    from.setMinutes(0, 0, 0);
    return { from: from.toISOString(), to: new Date(from.getTime() + 14 * 86_400_000).toISOString() };
  });
  const shifts = useQuery<Array<ShiftLike & { id: string }>>(`/api/me/shifts?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
  const offers = useQuery<Offer[]>(can('shiftboard.claim') ? '/api/shiftboard/offers' : null);
  const claims = useQuery<unknown[]>(can('shiftboard.approve') ? '/api/offers/pending' : null);
  const timeOff = useQuery<unknown[]>(can('timeoff.approve') ? '/api/time-off' : null);
  const punches = useQuery<unknown[]>(can('timeclock.review') ? '/api/punches' : null);
  const pools = useQuery<Pool[]>(can('ops.status.read') ? '/api/ops/status' : null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('today.morning') : hour < 18 ? t('today.afternoon') : t('today.evening');
  const next = shifts.data?.[0];
  const openCount = offers.data?.filter((o) => o.status === 'OPEN').length ?? 0;
  const approvals = (claims.data?.length ?? 0) + (timeOff.data?.length ?? 0) + (punches.data?.length ?? 0);
  const poolIssues = pools.data?.filter((p) => p.status !== 'OPEN') ?? [];

  return (
    // Wide screens: two columns, what to do now (clock in, next shift, coming up) beside what to know
    // (notices, station, onboarding, totals). Below xl the column wrappers dissolve (display: contents)
    // and "order" keeps the phone's single-column sequence exactly as it was.
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)] xl:items-start">
      <div className="grid gap-8 xl:col-span-2">
        <Hero eyebrow={formatDate(new Date().toISOString(), i18n.language, 'long')} title={`${greeting}, ${me?.firstName ?? ''}`} />
        <MyCare />
        <PoliciesBanner />
      </div>
      <div className="contents xl:col-start-2 xl:row-start-2 xl:grid xl:gap-6">
        <div className="max-xl:order-1 empty:hidden">
          <MyAnnouncements />
        </div>
        <div className="max-xl:order-1 empty:hidden">
          <SurveyNudge />
        </div>
        <div className="max-xl:order-1 empty:hidden">
          <MyStation />
        </div>
        <div className="max-xl:order-1 empty:hidden">
          <MyOnboarding compact />
        </div>
        <section aria-label={t('today.atAGlance')} className="fh-stagger grid gap-3 empty:hidden max-xl:order-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
          {can('shiftboard.claim') ? (
            <Tile href="/board" icon={<Repeat className="h-5 w-5" aria-hidden="true" />} value={openCount} label={t('today.openShifts', { count: openCount })} tone={openCount ? 'new' : undefined} />
          ) : null}
          {can('timeclock.review') || can('shiftboard.approve') ? (
            <Tile href="/manage/approvals" icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />} value={approvals} label={t('today.approvals', { count: approvals })} tone={approvals ? 'warn' : undefined} />
          ) : null}
          {can('ops.status.read') ? (
            <Tile
              href="/status"
              icon={<Waves className="h-5 w-5" aria-hidden="true" />}
              value={poolIssues.length ? poolIssues.length : t('today.allOpen')}
              label={poolIssues.length ? t('today.poolsNeedAttention', { count: poolIssues.length }) : t('today.poolsOk')}
              tone={poolIssues.length ? 'warn' : undefined}
            />
          ) : null}
        </section>
      </div>
      <div className="contents xl:col-start-1 xl:row-start-2 xl:grid xl:gap-8">

      {can('timeclock.punch') ? (
        <section aria-label={t('timeclock.title')} className="max-xl:order-2">
          <PunchControl variant="large" />
        </section>
      ) : null}
      <section aria-labelledby="next-h" className="grid gap-3 max-xl:order-2">
        <h2 id="next-h" className="text-heading">
          {t('today.nextShift')}
        </h2>
        {shifts.loading ? (
          <Skeleton className="h-28" />
        ) : next ? (
          <ShiftCard
            shift={next}
            aside={
              <StatusPill tone="brand">
                {shifts.data!.length === 1 ? t('today.onlyShift') : t('today.moreShifts', { count: shifts.data!.length - 1 })}
              </StatusPill>
            }
            footer={
              <ButtonLink href="/schedule" variant="ghost" size="sm">
                {t('today.seeSchedule')}
              </ButtonLink>
            }
          />
        ) : (
          <Card className="flex flex-wrap items-center gap-4 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-muted"><CalendarOff className="h-5 w-5" aria-hidden="true" /></span>
            <div className="min-w-[12rem] flex-1">
              <p className="text-body-strong">{t('today.noShiftsTitle')}</p>
              <p className="text-small text-muted">{t('today.noShiftsBody')}</p>
            </div>
            {can('shiftboard.claim') ? <ButtonLink href="/board" size="sm" variant="secondary" className="ml-14 sm:ml-0">{t('today.findShift')}</ButtonLink> : null}
          </Card>
        )}
      </section>

      {shifts.data && shifts.data.length > 1 ? (
        <Card className="p-5 max-xl:order-4">
          <h2 className="text-subheading">{t('today.comingUp')}</h2>
          <ul className="mt-3 divide-y divide-line">
            {shifts.data.slice(1, 5).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-small">
                <span className="font-semibold">{formatDate(s.localStartsAt, i18n.language)}</span>
                <span className="tabular-nums text-muted">
                  {formatTime(s.localStartsAt, i18n.language)} · {s.facility.name}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      </div>
    </div>
  );
}
