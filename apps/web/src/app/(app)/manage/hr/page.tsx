'use client';

import { Banknote, Bandage, Briefcase, CalendarClock, ClipboardCheck, DoorOpen, GraduationCap, HeartPulse, type LucideIcon, Scale, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { GrievancesPanel } from '@/components/hr/Grievances';
import { LeavePanel } from '@/components/hr/LeaveBalances';
import { OffboardingPanel } from '@/components/hr/Offboarding';
import { ReviewsPanel } from '@/components/hr/Reviews';
import { Card } from '@/components/ui/Card';
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
  return (
    <div className="grid gap-6">
      <PageHeader title={t('hr.title')} description={t('hr.description')} />
      <div className="overflow-x-auto"><Segmented label={t('hr.title')} value={tab} onChange={setTab} options={TABS.map((v) => ({ value: v, label: t(`hr.tabs.${v}`) }))} /></div>
      {tab === 'overview' ? <Overview onTab={setTab} /> : tab === 'leave' ? <LeavePanel canEdit /> : tab === 'reviews' ? <ReviewsPanel /> : tab === 'labour' ? <GrievancesPanel /> : <OffboardingPanel />}
    </div>
  );
}

/** HR's departments at a glance: each card is what needs attention there, and opens it. */
function Overview({ onTab }: { onTab: (t: Tab) => void }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const o = useQuery<HrOverview>('/api/hr/overview');
  if (!o.data) return <Skeleton className="h-64" />;
  const d = o.data;
  type Area = { key: string; icon: LucideIcon; stat: string; attention: boolean; href?: string; tab?: Tab; show: boolean };
  const areas: Area[] = [
    { key: 'records', icon: Users, stat: t('hr.stat.staff', { count: d.staff }), attention: false, href: '/manage/staff', show: can('users.read') },
    { key: 'recruiting', icon: Briefcase, stat: t('hr.stat.openJobs', { count: d.openJobs }), attention: false, href: '/manage/jobs', show: can('jobs.manage') },
    { key: 'payroll', icon: Banknote, stat: d.pendingBank ? t('hr.stat.pendingBank', { count: d.pendingBank }) : t('hr.stat.draftRuns', { count: d.draftRuns }), attention: d.pendingBank > 0, href: '/manage/payroll', show: can('payroll.export') },
    { key: 'benefits', icon: HeartPulse, stat: t('hr.stat.enrolled', { count: d.enrolled, plans: d.plans }), attention: false, href: '/manage/benefits', show: can('benefits.manage') },
    { key: 'leave', icon: CalendarClock, stat: t('hr.stat.leave'), attention: false, tab: 'leave', show: can('leave.manage') },
    { key: 'performance', icon: ClipboardCheck, stat: d.reviewsLate ? t('hr.stat.reviewsLate', { count: d.reviewsLate }) : t('hr.stat.reviewsOpen', { count: d.reviewsOpen }), attention: d.reviewsLate > 0, tab: 'reviews', show: can('performance.manage') },
    { key: 'training', icon: GraduationCap, stat: t('hr.stat.trainingDue', { count: d.trainingDue }), attention: d.trainingDue > 0, href: '/manage/training', show: can('training.manage') },
    { key: 'health', icon: Bandage, stat: t('hr.stat.health', { claims: d.openClaims, cases: d.activeAccommodations }), attention: d.openClaims > 0, href: '/manage/injuries', show: can('injury.manage') },
    { key: 'labour', icon: Scale, stat: t('hr.stat.grievances', { count: d.openGrievances }), attention: d.openGrievances > 0, tab: 'labour', show: can('grievances.manage') },
    { key: 'relations', icon: UserCheck, stat: t('hr.stat.flagged', { count: d.flagged }), attention: d.flagged > 0, href: '/manage/people', show: can('reliability.read') },
    { key: 'offboarding', icon: DoorOpen, stat: t('hr.stat.offboarding', { count: d.offboarding }), attention: d.offboarding > 0, tab: 'offboarding', show: can('users.write') },
  ];
  const card = (a: Area) => (
    <Card className="h-full p-4 transition-shadow hover:shadow-lift">
      <span className="flex items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${a.attention ? 'bg-warn-bg text-warn' : 'bg-brand/10 text-brand-text'}`}><a.icon className="h-5 w-5" aria-hidden="true" /></span>
        <span className="text-body-strong">{t(`hr.areas.${a.key}`)}</span>
      </span>
      <p className={`mt-3 text-small ${a.attention ? 'font-semibold text-warn' : 'text-muted'}`}>{a.stat}</p>
    </Card>
  );
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {areas.filter((a) => a.show).map((a) => (
        <li key={a.key}>
          {a.href ? <Link href={a.href} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{card(a)}</Link> : <button type="button" onClick={() => onTab(a.tab!)} className="block h-full w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{card(a)}</button>}
        </li>
      ))}
    </ul>
  );
}
