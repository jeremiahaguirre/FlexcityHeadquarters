'use client';

import { CalendarDays, Gift } from 'lucide-react';
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
import { formatDate } from '@/lib/format';
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
              <h2 className="mb-2 text-label uppercase text-muted">{formatDate(`${day}T12:00:00`, i18n.language, 'long')}</h2>
              <div className="grid gap-3">
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
                            <StatusPill tone="new">{t('schedule.open')}</StatusPill>
                          )
                        ) : s.offer ? (
                          <StatusPill tone={s.offer.status === 'PENDING_APPROVAL' ? 'warn' : 'new'}>
                            {s.offer.status === 'PENDING_APPROVAL' ? t('schedule.claimPending') : t('schedule.onBoard')}
                          </StatusPill>
                        ) : null
                      }
                      footer={
                        view === 'mine' && !s.offer && can('shiftboard.post') ? (
                          <Button variant="secondary" size="sm" icon={<Gift className="h-4 w-4" aria-hidden="true" />} loading={busy === `give-${s.id}`} onClick={() => void giveAway(s)}>
                            {t('schedule.giveAway')}
                          </Button>
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
    </>
  );
}
