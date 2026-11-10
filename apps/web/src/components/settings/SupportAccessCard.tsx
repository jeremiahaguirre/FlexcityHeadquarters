'use client';

import { LifeBuoy, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

interface Grant { id: string; level: 'SETUP' | 'FULL'; reason: string | null; expiresAt: string; revokedAt: string | null; createdAt: string; active: boolean; grantedBy: string | null }
interface Visit { id: string; admin: string; startedAt: string; endsAt: string }

/** The organization decides if and when FH support may look in, and sees every visit. */
export function SupportAccessCard() {
  const { t, i18n } = useTranslation();
  const data = useQuery<{ grants: Grant[]; visits: Visit[] }>('/api/support-access');
  const { run, busy } = useAction();
  const [level, setLevel] = useState<'SETUP' | 'FULL'>('SETUP');
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const active = data.data?.grants.find((g) => g.active);

  async function allow(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('allow', () => api('/api/support-access', { method: 'POST', body: { hours: Number(f.get('hours')), level, reason: String(f.get('reason') ?? '').trim() || null } }), t('support.allowed'));
    if (r !== undefined) await data.reload();
  }
  return (
    <Card>
      <CardHeader title={t('support.cardTitle')} description={t('support.cardHelp')} />
      <CardBody className="grid gap-4 pt-2">
        {!data.data ? (
          <Skeleton className="h-24" />
        ) : active ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-new/30 bg-new-bg px-4 py-3 text-small">
            <ShieldCheck className="h-5 w-5 text-new" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t('support.activeLine', { time: when(active.expiresAt) })}</span>
              <span className="text-muted">{t(`support.level.${active.level}`)}{active.grantedBy ? ` · ${t('support.by', { name: active.grantedBy })}` : ''}{active.reason ? ` · ${active.reason}` : ''}</span>
            </span>
            <Button size="sm" variant="danger" loading={busy === 'revoke'} onClick={() => void run('revoke', () => api(`/api/support-access/${active.id}`, { method: 'DELETE' }), t('support.revoked')).then(() => data.reload())}>{t('support.revoke')}</Button>
          </div>
        ) : (
          <form onSubmit={(e) => void allow(e)} className="grid gap-4">
            <p className="text-small text-muted">{t('support.off')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('support.what')}>
                {(p) => (
                  <Select {...p} value={level} onChange={(e) => setLevel(e.target.value as 'SETUP' | 'FULL')}>
                    <option value="SETUP">{t('support.level.SETUP')}</option>
                    <option value="FULL">{t('support.level.FULL')}</option>
                  </Select>
                )}
              </Field>
              <Field label={t('support.howLong')}>
                {(p) => (
                  <Select {...p} name="hours" defaultValue="4">
                    {[1, 4, 8, 24, 72].map((h) => <option key={h} value={h}>{t('support.hours', { count: h })}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <p className="text-caption text-muted">{t(`support.levelHelp.${level}`)}</p>
            <Field label={t('support.reason')}>{(p) => <Input {...p} name="reason" maxLength={200} placeholder={t('support.reasonPlaceholder')} />}</Field>
            <div><Button type="submit" loading={busy === 'allow'} icon={<LifeBuoy className="h-4 w-4" aria-hidden="true" />}>{t('support.allow')}</Button></div>
          </form>
        )}
        {data.data?.visits.length ? (
          <div>
            <p className="mb-1 text-caption font-semibold text-muted">{t('support.visits')}</p>
            <ul className="divide-y divide-line text-small">
              {data.data.visits.map((v) => (
                <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="font-semibold">{v.admin}</span><span className="text-muted">{when(v.startedAt)} – {when(v.endsAt)}</span></li>
              ))}
            </ul>
            <p className="mt-1 text-caption text-muted">{t('support.auditHint')}</p>
          </div>
        ) : null}
        <p className="flex items-center gap-1.5 text-caption text-muted"><StatusPill tone="neutral">{t('support.readOnly')}</StatusPill>{t('support.never')}</p>
      </CardBody>
    </Card>
  );
}
