'use client';

import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useLiveChange } from '@/lib/useLiveChange';
import { useQuery } from '@/lib/useQuery';
import { pick } from '@/lib/noteText';

interface Change { id: string; title: { en: string; fr: string }; summary: { en: string; fr: string }; scheduledAt: string; status: 'PLANNED' | 'APPLIED' | 'ROLLED_BACK'; features: Record<string, boolean>; keptOwnChoice: string[] }
const TONE: Record<Change['status'], Tone> = { PLANNED: 'pending', APPLIED: 'ok', ROLLED_BACK: 'inactive' };

/** HR admins: feature changes FH has scheduled for this organization, and what its own choices keep as they are. */
export function ComingChanges() {
  const { t, i18n } = useTranslation();
  const q = useQuery<Change[]>('/api/updates/changes');
  useLiveChange('updates', q.reload);
  if (!q.data?.length) return null;
  const lang = i18n.language;
  const fname = (k: string) => t(`platform.features.${k}.name`, { defaultValue: k });
  return (
    <Card className="mb-6">
      <CardHeader title={t('releases.comingTitle')} description={t('releases.comingHelp')} />
      <CardBody className="grid gap-4 pt-0">
        {q.data.map((c) => (
          <article key={c.id} className="grid gap-1.5 border-t border-line pt-4 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted" aria-hidden="true" />
              <p className="text-small font-semibold">{new Date(c.scheduledAt).toLocaleString(lang, { dateStyle: 'long', timeStyle: 'short' })}</p>
              <StatusPill tone={TONE[c.status]}>{t(`releases.changeStatus.${c.status}`)}</StatusPill>
            </div>
            <h3 className="text-subheading">{pick(lang, c.title)}</h3>
            <p className="text-small text-ink">{pick(lang, c.summary)}</p>
            <ul className="flex flex-wrap gap-1.5">
              {Object.entries(c.features).map(([k, on]) => <li key={k}><StatusPill tone={on ? 'ok' : 'neutral'}>{on ? t('releases.turnOn', { name: fname(k) }) : t('releases.turnOff', { name: fname(k) })}</StatusPill></li>)}
            </ul>
            {c.keptOwnChoice.length ? <p className="text-small text-muted">{t('releases.keptYours', { names: c.keptOwnChoice.map(fname).join(', ') })}</p> : null}
          </article>
        ))}
      </CardBody>
    </Card>
  );
}
