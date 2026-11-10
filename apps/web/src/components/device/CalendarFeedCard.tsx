'use client';

import { CalendarPlus, Copy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

/** A private link that puts the person's shifts in Google, Outlook or Apple Calendar. */
export function CalendarFeedCard() {
  const { t } = useTranslation();
  const { can } = useSession();
  const toast = useToast();
  const q = useQuery<{ active: boolean }>(can('shifts.self') ? '/api/me/calendar' : null);
  const { run, busy } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  if (!q.data) return null;
  const make = () => run('make', () => api<{ url: string }>('/api/me/calendar', { method: 'POST' })).then((r) => { if (r) { setUrl(r.url); void q.reload(); } });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url!);
      toast(t('calendarFeed.copied'), 'ok');
    } catch {
      toast(t('calendarFeed.copyManually'), 'warn');
    }
  };
  return (
    <Card id="calendar">
      <CardHeader title={t('calendarFeed.title')} description={t('calendarFeed.help')} action={q.data.active ? <StatusPill tone="ok">{t('calendarFeed.on')}</StatusPill> : undefined} />
      <CardBody className="grid gap-3 pt-2">
        {url ? (
          <>
            <p className="text-small text-muted">{t('calendarFeed.copyNow')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t('calendarFeed.link')} className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-small text-ink" />
              <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => void copy()}>{t('calendarFeed.copy')}</Button>
            </div>
            <p className="text-caption text-muted">{t('calendarFeed.howTo')}</p>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={q.data.active ? 'secondary' : 'primary'} icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />} loading={busy === 'make'} onClick={() => void make()}>
            {q.data.active ? t('calendarFeed.newLink') : t('calendarFeed.getLink')}
          </Button>
          {q.data.active ? <Button size="sm" variant="ghost" loading={busy === 'off'} onClick={() => void run('off', () => api('/api/me/calendar', { method: 'DELETE' }), t('calendarFeed.turnedOff')).then(() => { setUrl(null); void q.reload(); })}>{t('calendarFeed.turnOff')}</Button> : null}
        </div>
        {q.data.active && !url ? <p className="text-caption text-muted">{t('calendarFeed.lost')}</p> : null}
      </CardBody>
    </Card>
  );
}
