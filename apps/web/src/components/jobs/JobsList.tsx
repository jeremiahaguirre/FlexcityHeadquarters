'use client';

import { Briefcase, CalendarClock, MapPin, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { type Job, jobDescription, jobTitle } from '@/lib/jobs';

/** Open postings. `initial` comes from the server (so the page is complete as sent); the demo loads them here. */
export function JobsList({ initial }: { initial: Job[] | null }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [jobs, setJobs] = useState<Job[] | null>(initial);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    api<Job[]>('/api/public/jobs', {}, false).then(setJobs, () => setFailed(true));
  };
  useEffect(() => {
    if (!initial) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pay = (j: Job) => (j.payMin && j.payMax ? `${formatMoney(j.payMin, lng)}–${formatMoney(j.payMax, lng)} ${t('jobs.perHour')}` : j.payMin ? `${formatMoney(j.payMin, lng)} ${t('jobs.perHour')}` : null);

  return (
    <>
      <h1 className="text-title">{t('jobs.publicTitle')}</h1>
      <p className="mt-2 max-w-prose text-body text-muted">{t('jobs.publicIntro')}</p>
      <div className="mt-8 grid gap-4">
        {failed ? (
          <ErrorNotice onRetry={load} />
        ) : !jobs ? (
          <ListSkeleton rows={3} />
        ) : !jobs.length ? (
          <EmptyState icon={Briefcase} title={t('jobs.noOpenings')}>{t('jobs.noOpeningsHelp')}</EmptyState>
        ) : (
          jobs.map((j) => (
            <Card key={j.id}>
              <CardBody className="grid gap-4">
                <div>
                  <h2 className="text-heading">
                    <Link href={`/jobs/${j.id}`} className="rounded-lg hover:underline">{jobTitle(j, lng)}</Link>
                  </h2>
                  <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-small text-muted">
                    <li className="flex items-center gap-1.5">
                      <Briefcase className="h-4 w-4" aria-hidden="true" />
                      {t(`staff.employment.${j.employmentStatus}`)}
                    </li>
                    {j.facility ? (
                      <li className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4" aria-hidden="true" />
                        {j.facility}
                      </li>
                    ) : null}
                    {pay(j) ? (
                      <li className="flex items-center gap-1.5">
                        <Wallet className="h-4 w-4" aria-hidden="true" />
                        {pay(j)}
                      </li>
                    ) : null}
                    <li className="flex items-center gap-1.5">
                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                      {t('jobs.applyBy', { date: formatDate(`${j.closesOn}T12:00:00`, lng, 'dated') })}
                    </li>
                  </ul>
                </div>
                <p className="max-w-prose whitespace-pre-wrap text-body">{jobDescription(j, lng)}</p>
                <ButtonLink href={j.applyUrl} className="justify-self-start" target="_blank" rel="noopener noreferrer">
                  {t('jobs.apply')}
                </ButtonLink>
              </CardBody>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
