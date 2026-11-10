'use client';

import { Download, FileSignature } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { pdownload, usePlatformQuery } from '@/lib/platform';

interface Row { id: string; person: string; email: string | null; signedName: string; version: string; locale: string; signedAt: string; choices: { notifications?: string; location?: string }; textSha256: string; ipAddress: string | null }
interface Consents { currentVersion: string; activeStaff: number; signedCurrent: number; records: Row[] }

/** Signed first-sign-in agreements for one organization: who, when, what they chose, and a certificate for each. */
export function ConsentsPanel({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const data = usePlatformQuery<Consents>(`/tenants/${id}/consents`);
  const [busy, setBusy] = useState<string | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const get = async (key: string, path: string, name: string) => {
    setBusy(key);
    try {
      await pdownload(path, name);
    } catch {
      toast(t('consents.downloadFailed'), 'warn');
    } finally {
      setBusy(null);
    }
  };
  if (data.error) return <ErrorNotice onRetry={data.reload} />;
  if (!data.data) return <Skeleton className="h-64" />;
  const d = data.data;
  const tone = (c?: string): 'ok' | 'warn' | 'neutral' => (c === 'granted' ? 'ok' : c === 'denied' ? 'warn' : 'neutral');
  return (
    <Card>
      <CardHeader
        title={t('consents.title')}
        description={t('consents.lead', { version: d.currentVersion, signed: d.signedCurrent, staff: d.activeStaff })}
        action={d.records.length ? <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} loading={busy === 'csv'} onClick={() => void get('csv', `/tenants/${id}/consents.csv`, 'consents.csv')}>{t('consents.csv')}</Button> : undefined}
      />
      <CardBody>
        {!d.records.length ? (
          <EmptyState icon={FileSignature} title={t('consents.none')} />
        ) : (
          <ul className="divide-y divide-line">
            {d.records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.person}{r.signedName !== r.person ? <span className="font-normal text-muted"> · {t('consents.signedAs', { name: r.signedName })}</span> : null}</p>
                  <p className="text-caption text-muted">{when(r.signedAt)} · {t('consents.version', { version: r.version })} · {r.locale}{r.ipAddress ? ` · ${r.ipAddress}` : ''}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <StatusPill tone={tone(r.choices.notifications)}>{t('consent.notifications.title')}: {t(`consents.state.${r.choices.notifications ?? 'skipped'}`)}</StatusPill>
                    <StatusPill tone={tone(r.choices.location)}>{t('consent.location.title')}: {t(`consents.state.${r.choices.location ?? 'skipped'}`)}</StatusPill>
                    {r.version !== d.currentVersion ? <StatusPill tone="neutral">{t('consents.older')}</StatusPill> : null}
                  </div>
                </div>
                <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} loading={busy === r.id} onClick={() => void get(r.id, `/tenants/${id}/consents/${r.id}/certificate`, `agreement-${r.id.slice(0, 8)}.pdf`)}>{t('consents.certificate')}</Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
