'use client';

import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { usePlatformQuery } from '@/lib/platform';

interface Usage {
  inPlan: boolean;
  apiKeys: { active: number; total: number; requests: number; lastUsedAt: string | null };
  webhooks: Array<{ host: string; enabled: boolean; disabledReason: string | null; events: number; lastSuccessAt: string | null; lastFailureAt: string | null }>;
  deliveries30d: { succeeded: number; failed: number; pending: number };
}

/** Dev console: whether a city uses the API and webhooks, and how much. Counts only, never keys or secrets. */
export function IntegrationsPanel({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const q = usePlatformQuery<Usage>(`/tenants/${id}/integrations`);
  if (q.error) return <ErrorNotice onRetry={q.reload} />;
  if (!q.data) return <Skeleton className="h-48" />;
  const d = q.data;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : t('platformIntegrations.never'));
  const stat = (label: string, value: string | number) => (
    <div className="rounded-xl border border-line p-3">
      <p className="text-caption text-muted">{label}</p>
      <p className="text-body-strong text-ink">{value}</p>
    </div>
  );
  return (
    <Card>
      <CardHeader
        title={t('platformIntegrations.title')}
        description={t('platformIntegrations.help')}
        action={<StatusPill tone={d.inPlan ? 'ok' : 'neutral'}>{d.inPlan ? t('platformIntegrations.inPlan') : t('platformIntegrations.notInPlan')}</StatusPill>}
      />
      <CardBody className="grid gap-5 pt-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stat(t('platformIntegrations.activeKeys'), d.apiKeys.active)}
          {stat(t('platformIntegrations.requests'), d.apiKeys.requests.toLocaleString(i18n.language))}
          {stat(t('platformIntegrations.delivered'), d.deliveries30d.succeeded.toLocaleString(i18n.language))}
          {stat(t('platformIntegrations.failed'), d.deliveries30d.failed.toLocaleString(i18n.language))}
        </div>
        <p className="text-small text-muted">{t('platformIntegrations.lastCall', { time: when(d.apiKeys.lastUsedAt) })}</p>
        {d.webhooks.length ? (
          <ul className="divide-y divide-line">
            {d.webhooks.map((w, i) => (
              <li key={`${w.host}-${i}`} className="flex flex-wrap items-center gap-2 py-2 text-small">
                <span className="min-w-0 flex-1 break-all font-semibold text-ink">{w.host}</span>
                <span className="text-caption text-muted">{t('platformIntegrations.events', { count: w.events })} · {t('platformIntegrations.lastSuccess', { time: when(w.lastSuccessAt) })}</span>
                <StatusPill tone={w.enabled ? 'ok' : w.disabledReason === 'failures' ? 'warn' : 'neutral'}>{w.enabled ? t('integrations.on') : w.disabledReason === 'failures' ? t('integrations.offFailures') : t('integrations.off')}</StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Plug} title={t('platformIntegrations.noWebhooks')} level={3} />
        )}
      </CardBody>
    </Card>
  );
}
