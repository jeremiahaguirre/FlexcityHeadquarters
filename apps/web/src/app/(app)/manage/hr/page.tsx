'use client';

import { Banknote, Bandage, Briefcase, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, DoorOpen, GraduationCap, HeartPulse, type LucideIcon, Scale, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { GrievancesPanel } from '@/components/hr/Grievances';
import { LeavePanel } from '@/components/hr/LeaveBalances';
import { OffboardingPanel } from '@/components/hr/Offboarding';
import { ReviewsPanel } from '@/components/hr/Reviews';
import { Card } from '@/components/ui/Card';
import { Hero } from '@/components/ui/Hero';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import type { HrOverview } from '@/lib/hr';
import { useSession } from '@/lib/session';
import { useQuery } from '@/lib/useQuery';

const TABS = ['overview', 'leave', 'reviews', 'labour', 'offboarding'] as const;
type Tab = (typeof TABS)[number];

export default function HrPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <HrInner />
    </Suspense>
  );
}

function HrInner() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get('tab');
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'overview';
  const setTab = (v: Tab) => router.replace(v === 'overview' ? '/manage/hr' : `/manage/hr?tab=${v}`, { scroll: false });
  const tabs = <div className="overflow-x-auto"><Segmented label={t('hr.title')} value={tab} onChange={setTab} options={TABS.map((v) => ({ value: v, label: t(`hr.tabs.${v}`) }))} /></div>;
  return (
    <div className="grid gap-6">
      {tab !== 'overview' ? <PageHeader title={t('hr.title')} description={t('hr.description')} /> : null}
      {tab !== 'overview' ? tabs : null}
      {tab === 'overview' ? <Overview onTab={setTab} tabs={tabs} /> : tab === 'leave' ? <LeavePanel canEdit /> : tab === 'reviews' ? <ReviewsPanel /> : tab === 'labour' ? <GrievancesPanel /> : <OffboardingPanel />}
    </div>
  );
}

/**
 * HR's home. Calm by default: what needs action first (and only that), four
 * numbers, then a quiet directory of every HR area.
 */
function Overview({ onTab, tabs }: { onTab: (t: Tab) => void; tabs: ReactNode }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { can, me } = useSession();
  const o = useQuery<HrOverview>('/api/hr/overview');
  if (!o.data) return <Skeleton className="h-64" />;
  const d = o.data;
  type Area = { key: string; icon: LucideIcon; href?: string; tab?: Tab; show: boolean; todo?: string | null };
  const all: Area[] = [
    { key: 'records', icon: Users, href: '/manage/staff', show: can('users.read') },
    { key: 'recruiting', icon: Briefcase, href: '/manage/jobs', show: can('jobs.manage') },
    { key: 'payroll', icon: Banknote, href: '/manage/payroll', show: can('payroll.export'), todo: d.pendingBank ? t('hr.stat.pendingBank', { count: d.pendingBank }) : null },
    { key: 'benefits', icon: HeartPulse, href: '/manage/benefits', show: can('benefits.manage') },
    { key: 'leave', icon: CalendarClock, tab: 'leave', show: can('leave.manage') },
    { key: 'performance', icon: ClipboardCheck, tab: 'reviews', show: can('performance.manage'), todo: d.reviewsLate ? t('hr.stat.reviewsLate', { count: d.reviewsLate }) : null },
    { key: 'training', icon: GraduationCap, href: '/manage/training', show: can('training.manage'), todo: d.trainingDue ? t('hr.stat.trainingDue', { count: d.trainingDue }) : null },
    { key: 'health', icon: Bandage, href: '/manage/injuries', show: can('injury.manage'), todo: d.openClaims ? t('hr.stat.openClaims', { count: d.openClaims }) : null },
    { key: 'labour', icon: Scale, tab: 'labour', show: can('grievances.manage'), todo: d.openGrievances ? t('hr.stat.grievances', { count: d.openGrievances }) : null },
    { key: 'relations', icon: UserCheck, href: '/manage/people', show: can('reliability.read'), todo: d.flagged ? t('hr.stat.flagged', { count: d.flagged }) : null },
    { key: 'offboarding', icon: DoorOpen, tab: 'offboarding', show: can('users.write'), todo: d.offboarding ? t('hr.stat.offboarding', { count: d.offboarding }) : null },
  ];
  const areas = all.filter((a) => a.show);
  const todo = areas.filter((a) => a.todo);
  const hour = new Date().getHours();
  const greeting = t(`today.${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}`);
  const go = (a: Area, children: ReactNode, className: string) =>
    a.href ? <Link href={a.href} className={className}>{children}</Link> : <button type="button" onClick={() => onTab(a.tab!)} className={`${className} w-full text-left`}>{children}</button>;
  const numbers = [
    { label: t('hr.num.staff'), value: d.staff, icon: Users, tint: 'bg-brand/10 text-brand-text' },
    { label: t('hr.num.enrolled'), value: d.enrolled, icon: HeartPulse, tint: 'bg-new-bg text-new' },
    { label: t('hr.num.reviews'), value: d.reviewsOpen, icon: ClipboardCheck, tint: 'bg-ok-bg text-ok' },
    { label: t('hr.num.jobs'), value: d.openJobs, icon: Briefcase, tint: 'bg-surface text-ink' },
  ];
  // A gentle colour per area so the directory isn't a wall of grey icons.
  const TINTS = ['bg-brand/10 text-brand-text', 'bg-new-bg text-new', 'bg-ok-bg text-ok', 'bg-surface text-ink'];
  return (
    <div className="grid gap-8">
      <section aria-labelledby="hr-today" className="grid gap-4">
        <Hero
          eyebrow={new Intl.DateTimeFormat(lng, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}
          title={<span id="hr-today">{greeting}{me?.firstName ? `, ${me.firstName}` : ''}</span>}
          aside={<span className={`rounded-full px-3 py-1.5 text-small font-semibold ${todo.length ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'}`}>{todo.length ? t('hr.attentionCount', { count: todo.length }) : t('hr.allClear')}</span>}
        />
        {tabs}
        {todo.length ? (
          <Card>
            <ul className="divide-y divide-line">
              {todo.map((a) => (
                <li key={a.key}>
                  {go(
                    a,
                    <>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warn-bg text-warn"><a.icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-body-strong">{a.todo}</span>
                        <span className="block text-caption text-muted">{t(`hr.areas.${a.key}`)}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </>,
                    'group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card className="flex items-center gap-3 p-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-ok-bg text-ok"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /></span>
            <p className="text-body text-muted">{t('hr.allClearBody')}</p>
          </Card>
        )}
      </section>

      <section aria-label={t('hr.numbers')}>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
          {numbers.map((n) => (
            // Only dt and dd inside each group, as a description list requires; the icon is placed by the grid.
            <div key={n.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 bg-panel px-4 py-4">
              <dt className="col-start-2 row-start-1 truncate text-caption text-muted">{n.label}</dt>
              <dd className="col-start-2 row-start-2 text-heading tabular-nums">{new Intl.NumberFormat(lng).format(n.value)}</dd>
              <dd aria-hidden="true" className={`col-start-1 row-span-2 row-start-1 grid h-10 w-10 place-items-center rounded-xl ${n.tint}`}><n.icon className="h-5 w-5" /></dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="hr-areas" className="grid gap-3">
        <h2 id="hr-areas" className="text-label uppercase text-muted">{t('hr.allAreas')}</h2>
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a) => (
            <li key={a.key}>
              {go(
                a,
                <>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TINTS[areas.indexOf(a) % TINTS.length]}`}><a.icon className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="flex-1 text-small font-semibold">{t(`hr.areas.${a.key}`)}</span>
                  {a.todo ? <span className="h-2 w-2 rounded-full bg-warn" aria-label={t('hr.needsAttention')} /> : null}
                </>,
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-panel hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
