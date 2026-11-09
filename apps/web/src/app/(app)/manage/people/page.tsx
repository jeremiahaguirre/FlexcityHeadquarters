'use client';

import { Award, ChevronRight, Scale, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { scoreTone } from '@/components/people/CaseFilePanel';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate } from '@/lib/format';
import { type ReviewRow, dayOf } from '@/lib/people';
import { useQuery } from '@/lib/useQuery';

export default function PeopleReviewPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const list = useQuery<ReviewRow[]>('/api/people/review');
  const [view, setView] = useState<'attention' | 'everyone'>('attention');
  const rows = (list.data ?? []).filter((r) => view === 'everyone' || r.review.attention);
  const flagged = (list.data ?? []).filter((r) => r.review.attention).length;

  return (
    <div className="grid gap-6">
      <PageHeader title={t('people.title')} description={t('people.description')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('people.title')}
          value={view}
          onChange={setView}
          options={[
            { value: 'attention', label: t('people.needsAttention', { count: flagged }) },
            { value: 'everyone', label: t('people.everyone') },
          ]}
        />
        <p className="flex max-w-xl items-start gap-2 text-caption text-muted">
          <Scale className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('people.advisory')}
        </p>
      </div>
      {list.error ? (
        <ErrorNotice onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <EmptyState icon={UserCheck} title={t('people.allClear')}>
          {t('people.allClearHelp')}
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/manage/staff/person?id=${r.id}#case-file`} className="flex items-center gap-4 px-4 py-4 hover:bg-surface sm:px-6">
                  <Avatar name={r.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body-strong">{r.name}</p>
                      <span className="text-caption text-muted">{r.roles.map((x) => t(`roles.${x}`)).join(' · ')}</span>
                    </div>
                    {r.review.flags.length ? (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {r.review.flags.map((f) => (
                          <li key={f.code}>
                            <StatusPill tone={f.code === 'SAFETY_CONCERN' || f.code === 'REPEATED_NO_SHOWS' ? 'danger' : 'warn'}>{t(`people.flagsShort.${f.code}`, f)}</StatusPill>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-caption text-muted">{t('people.noFlags')}</p>
                    )}
                    <p className="mt-1.5 text-caption text-muted">
                      {r.review.activeLevel ? t('people.onFile', { level: t(`people.level.${r.review.activeLevel}`) }) : t('people.nothingOnFile')}
                      {r.review.suggestedLevel ? ` · ${t('people.typicalNextShort', { level: t(`people.level.${r.review.suggestedLevel}`) })}` : ''}
                      {r.flaggedSince ? ` · ${t('people.flaggedSince', { date: formatDate(dayOf(r.flaggedSince), lng, 'dated') })}` : ''}
                    </p>
                  </div>
                  <div className="grid justify-items-end gap-1">
                    <StatusPill tone={scoreTone(r.score)}>{r.score}</StatusPill>
                    {r.review.commendations90 ? (
                      <span className="flex items-center gap-1 text-caption text-ok">
                        <Award className="h-3.5 w-3.5" aria-hidden="true" />
                        {r.review.commendations90}
                      </span>
                    ) : null}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
