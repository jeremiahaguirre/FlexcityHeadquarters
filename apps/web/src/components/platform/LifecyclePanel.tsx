'use client';

import { DoorClosed, ExternalLink, LifeBuoy, Power } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { papi, usePlatformQuery } from '@/lib/platform';

interface Lifecycle { disabledAt: string | null; disabledReason: string | null; offboardedAt: string | null; deleteAfter: string | null; exportUntil?: string | null; exports?: string[]; support: { level: 'SETUP' | 'FULL'; expiresAt: string; reason: string | null } | null; visits: Array<{ id: string; admin: string; startedAt: string; endsAt: string }> }

/** Support visits (with the organization's consent) and closing an organization. */
export function LifecyclePanel({ id, subdomain }: { id: string; subdomain: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const data = usePlatformQuery<Lifecycle>(`/tenants/${id}/lifecycle`);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'disable' | 'offboard'>('none');
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast(ok, 'ok');
      await data.reload();
      return r;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  async function visit() {
    const r = (await run('visit', () => papi<{ url: string; endsAt: string }>(`/tenants/${id}/support-visit`, { method: 'POST' }))) as { url: string } | undefined;
    if (r?.url) window.open(r.url, '_blank', 'noopener');
  }
  const d = data.data;
  if (!d) return <Skeleton className="h-64" />;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('lifecycle.supportTitle')} description={t('lifecycle.supportHelp')} />
        <CardBody className="grid gap-4 pt-2">
          {d.support ? (
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone="ok">{t('lifecycle.allowedUntil', { time: when(d.support.expiresAt) })}</StatusPill>
              <span className="text-small text-muted">{t(`support.level.${d.support.level}`)}{d.support.reason ? ` · ${d.support.reason}` : ''}</span>
              <Button size="sm" icon={<ExternalLink className="h-4 w-4" aria-hidden="true" />} loading={busy === 'visit'} disabled={!!d.disabledAt} onClick={() => void visit()}>{t('lifecycle.openVisit')}</Button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-small text-muted"><LifeBuoy className="h-4 w-4" aria-hidden="true" />{t('lifecycle.noConsent')}</p>
          )}
          {d.visits.length ? (
            <ul className="divide-y divide-line text-small">
              {d.visits.map((v) => <li key={v.id} className="flex flex-wrap justify-between gap-2 py-2"><span className="font-semibold">{v.admin}</span><span className="text-muted">{when(v.startedAt)} – {when(v.endsAt)}</span></li>)}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      <Card className="border-danger/30">
        <CardHeader title={t('lifecycle.closeTitle')} description={t('lifecycle.closeHelp')} />
        <CardBody className="grid gap-4 pt-2">
          {d.offboardedAt ? (
            <div className="grid gap-1 text-small">
              <p><StatusPill tone="danger">{t('lifecycle.offboarded')}</StatusPill> {t('lifecycle.deleteOn', { date: d.deleteAfter })}</p>
              <p className="text-muted">
                {d.exportUntil ? t('lifecycle.exportOpen', { date: d.exportUntil.slice(0, 10) }) : t('lifecycle.exportOff')}
                {d.exports?.length ? ` ${t('lifecycle.exportsTaken', { count: d.exports.length, last: when(d.exports[0]!) })}` : d.exportUntil ? ` ${t('lifecycle.exportsNone')}` : ''}
              </p>
            </div>
          ) : d.disabledAt ? (
            <p className="text-small"><StatusPill tone="warn">{t('lifecycle.disabled')}</StatusPill> {d.disabledReason}</p>
          ) : (
            <p className="text-small"><StatusPill tone="ok">{t('lifecycle.open')}</StatusPill></p>
          )}
          {mode === 'disable' ? (
            <form
              className="grid gap-3"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const reason = String(new FormData(e.currentTarget).get('reason'));
                void run('disable', () => papi(`/tenants/${id}/disable`, { method: 'POST', body: { reason } }), t('lifecycle.disabledToast')).then(() => setMode('none'));
              }}
            >
              <Field label={t('lifecycle.reason')} hint={t('lifecycle.disableHint')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={200} />}</Field>
              <div className="flex gap-2"><Button type="submit" variant="danger" loading={busy === 'disable'}>{t('lifecycle.disable')}</Button><Button variant="ghost" onClick={() => setMode('none')}>{t('common.cancel')}</Button></div>
            </form>
          ) : mode === 'offboard' ? (
            <form
              className="grid gap-3"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run('offboard', () => papi(`/tenants/${id}/offboard`, { method: 'POST', body: { reason: String(f.get('reason')), retentionDays: Number(f.get('days')), confirm: String(f.get('confirm')), dataExport: f.get('dataExport') === 'on' } }), t('lifecycle.offboardedToast')).then(() => setMode('none'));
              }}
            >
              <p className="text-small text-muted">{t('lifecycle.offboardHelp')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('lifecycle.reason')}>{(p) => <Input {...p} name="reason" required minLength={3} maxLength={200} />}</Field>
                <Field label={t('lifecycle.retention')} hint={t('lifecycle.retentionHint')}>{(p) => <Input {...p} name="days" type="number" min={30} max={3650} defaultValue={90} required />}</Field>
              </div>
              <label className="flex items-start gap-3 text-small">
                <input type="checkbox" name="dataExport" defaultChecked className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
                <span>
                  <span className="block font-semibold">{t('lifecycle.dataExport')}</span>
                  <span className="text-muted">{t('lifecycle.dataExportHelp')}</span>
                </span>
              </label>
              <Field label={t('lifecycle.confirm', { subdomain })}>{(p) => <Input {...p} name="confirm" required autoComplete="off" />}</Field>
              <div className="flex gap-2"><Button type="submit" variant="danger" loading={busy === 'offboard'}>{t('lifecycle.offboard')}</Button><Button variant="ghost" onClick={() => setMode('none')}>{t('common.cancel')}</Button></div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              {d.disabledAt ? (
                <Button variant="secondary" icon={<Power className="h-4 w-4" aria-hidden="true" />} loading={busy === 'enable'} onClick={() => void run('enable', () => papi(`/tenants/${id}/enable`, { method: 'POST' }), t('lifecycle.enabledToast'))}>{t('lifecycle.enable')}</Button>
              ) : (
                <Button variant="secondary" icon={<Power className="h-4 w-4" aria-hidden="true" />} onClick={() => setMode('disable')}>{t('lifecycle.disable')}</Button>
              )}
              {!d.offboardedAt ? <Button variant="danger" icon={<DoorClosed className="h-4 w-4" aria-hidden="true" />} onClick={() => setMode('offboard')}>{t('lifecycle.offboard')}</Button> : null}
            </div>
          )}
          <p className="text-caption text-muted">{t('lifecycle.passkeyNote')}</p>
        </CardBody>
      </Card>
    </div>
  );
}
