'use client';

import { ArrowLeft, Briefcase, CalendarClock, MapPin, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ButtonLink } from '@/components/ui/Button';
import { ApplyForm } from '@/components/jobs/Applications';
import { formatDate, formatMoney } from '@/lib/format';
import { type Job, jobDescription, jobTitle } from '@/lib/jobs';

/** One posting on its own page. */
export function JobDetail({ job: j }: { job: Job | null }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const back = (
    <Link href="/jobs" className="inline-flex items-center gap-1.5 rounded-lg text-small font-semibold text-brand-text hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t('jobs.allOpenings')}
    </Link>
  );
  if (!j) {
    return (
      <div className="grid gap-4">
        {back}
        <p className="text-body text-muted">{t('jobs.closed')}</p>
      </div>
    );
  }
  const pay = j.payMin && j.payMax ? `${formatMoney(j.payMin, lng)}–${formatMoney(j.payMax, lng)} ${t('jobs.perHour')}` : j.payMin ? `${formatMoney(j.payMin, lng)} ${t('jobs.perHour')}` : null;
  return (
    <article className="grid gap-6">
      {back}
      <header>
        <h1 className="text-title">{jobTitle(j, lng)}</h1>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-small text-muted">
          <li className="flex items-center gap-1.5"><Briefcase className="h-4 w-4" aria-hidden="true" />{t(`staff.employment.${j.employmentStatus}`)}</li>
          {j.facility ? <li className="flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden="true" />{j.facility}</li> : null}
          {pay ? <li className="flex items-center gap-1.5"><Wallet className="h-4 w-4" aria-hidden="true" />{pay}</li> : null}
          <li className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" aria-hidden="true" />{t('jobs.applyBy', { date: formatDate(`${j.closesOn}T12:00:00`, lng, 'dated') })}</li>
        </ul>
      </header>
      <p className="max-w-prose whitespace-pre-wrap text-body">{jobDescription(j, lng)}</p>
      {j.applyInApp ? <ApplyForm jobId={j.id} /> : j.applyUrl ? <ButtonLink href={j.applyUrl} className="justify-self-start" target="_blank" rel="noopener noreferrer">{t('jobs.apply')}</ButtonLink> : null}
    </article>
  );
}
