'use client';

import { Copy, KeyRound, PencilLine, Plus, RefreshCw, Send, Trash2, Webhook } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; write?: boolean; allowedIps: string[]; expiresAt: string | null; lastUsedAt: string | null; requestCount: number; createdAt: string; status: 'active' | 'expired' | 'revoked' }
interface Endpoint { id: string; url: string; description: string | null; events: string[]; enabled: boolean; disabledReason: string | null; consecutiveFailures: number; lastSuccessAt: string | null; lastFailureAt: string | null }
interface Delivery { id: string; endpointId: string; eventType: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; attempts: number; responseStatus: number | null; error: string | null; test: boolean; redelivery: boolean; createdAt: string; lastAttemptAt: string | null; nextAttemptAt: string | null }
interface View { inPlan: boolean; scopes: Array<{ scope: string; allowed: boolean; write?: boolean }>; events: string[]; keys: ApiKey[]; webhooks: Endpoint[] }

interface KeyBody { name: string; scopes: string[]; allowedIps: string[]; expiresAt: string | null }

const when = (iso: string, lng: string) => new Date(iso).toLocaleString(lng, { dateStyle: 'medium', timeStyle: 'short' });
const scopeKey = (s: string) => s.replace(':', '_');
const eventKey = (e: string) => e.replace('.', '_');

/** A secret shown once, with a copy button and a plain warning. */
function SecretOnce({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  return (
    <div className="grid gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3" role="status">
      <p className="text-small font-semibold text-ink">{label}</p>
      <p className="text-small text-ink">{t('integrations.secretOnce')}</p>
      <div className="flex flex-wrap gap-2">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} className="w-full min-w-0 basis-full rounded-xl border border-line bg-panel px-3 py-2 font-mono text-caption text-ink sm:basis-0 sm:flex-1" />
        <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => void navigator.clipboard.writeText(value).then(() => toast(t('integrations.copied'), 'ok'), () => toast(t('calendarFeed.copyManually'), 'warn'))}>
          {t('integrations.copy')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{t('integrations.saved')}</Button>
      </div>
    </div>
  );
}

function Checks({ legend, name, options, badge, help }: { legend: string; name: string; options: Array<{ value: string; label: string; hint?: string; disabled?: boolean; checked?: boolean }>; badge?: string; help?: string }) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 flex flex-wrap items-center gap-2 text-small font-semibold text-ink">
        {legend}
        {badge ? <StatusPill tone="warn">{badge}</StatusPill> : null}
      </legend>
      {help ? <p className="text-caption text-muted">{help}</p> : null}
      <div className="grid gap-x-4 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value} className={`flex min-h-11 items-start gap-3 py-2 text-small ${o.disabled ? 'opacity-60' : ''}`}>
            <input type="checkbox" name={name} value={o.value} defaultChecked={o.checked} disabled={o.disabled} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
            <span className="min-w-0">
              <span className="block font-semibold text-ink">{o.label}</span>
              {o.hint ? <span className="text-muted">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Settings › Integrations: API keys and webhooks for the organization's own systems. */
export function IntegrationsSettings() {
  const { t } = useTranslation();
  const { can } = useSession();
  const data = useQuery<View>('/api/integrations');
  if (data.error) return <ErrorNotice onRetry={data.reload} />;
  if (!data.data) return <ListSkeleton rows={4} />;
  const v = data.data;
  return (
    <div className="grid max-w-4xl gap-6">
      {!v.inPlan ? (
        <Card>
          <CardHeader title={t('integrations.planTitle')} description={t('integrations.planHelp')} action={<StatusPill tone="neutral">{t('integrations.notInPlan')}</StatusPill>} />
          {can('billing.manage') ? (
            <CardBody className="pt-2">
              <ButtonLink href="/manage/billing" variant="secondary" size="sm">{t('integrations.seeBilling')}</ButtonLink>
            </CardBody>
          ) : null}
        </Card>
      ) : null}
      <ApiKeysCard v={v} reload={data.reload} />
      <WebhooksCard v={v} reload={data.reload} />
      {v.webhooks.length ? <DeliveriesCard endpoints={v.webhooks} /> : null}
      <p className="text-caption text-muted">{t('integrations.docs')}</p>
    </div>
  );
}

function ApiKeysCard({ v, reload }: { v: View; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  // A key that can change data is confirmed first.
  const [confirming, setConfirming] = useState<KeyBody | null>(null);
  const live = v.keys.filter((k) => k.status !== 'revoked');
  const writeScopes = new Set(v.scopes.filter((s) => s.write).map((s) => s.scope));
  const isWrite = (k: ApiKey) => k.write ?? k.scopes.some((s) => writeScopes.has(s));

  async function make(body: KeyBody) {
    const r = await run('add', () => api<{ key: string }>('/api/integrations/api-keys', { method: 'POST', body }), t('integrations.keyMade'));
    setConfirming(null);
    if (r) {
      setShown(r.key);
      setAdding(false);
      await reload();
    }
  }
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const expires = String(f.get('expiresAt') ?? '').trim();
    const body: KeyBody = {
      name: String(f.get('name') ?? '').trim(),
      scopes: [...f.getAll('scopes'), ...f.getAll('writeScopes')].map(String),
      allowedIps: String(f.get('allowedIps') ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
      expiresAt: expires || null,
    };
    if (body.scopes.some((s) => writeScopes.has(s))) setConfirming(body);
    else await make(body);
  }
  async function rotate(k: ApiKey) {
    const r = await run(`rotate-${k.id}`, () => api<{ key: string }>(`/api/integrations/api-keys/${k.id}/rotate`, { method: 'POST' }), t('integrations.keyRotated'));
    if (r) {
      setShown(r.key);
      await reload();
    }
  }
  async function revoke() {
    if (!revoking) return;
    const r = await run('revoke', () => api(`/api/integrations/api-keys/${revoking.id}`, { method: 'DELETE' }), t('integrations.keyRevoked'));
    setRevoking(null);
    if (r !== undefined) await reload();
  }
  const tone: Record<ApiKey['status'], Tone> = { active: 'ok', expired: 'neutral', revoked: 'neutral' };

  return (
    <Card>
      <CardHeader
        title={t('integrations.keysTitle')}
        description={t('integrations.keysHelp')}
        action={v.inPlan && !adding ? <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('integrations.newKey')}</Button> : undefined}
      />
      <CardBody className="grid gap-4 pt-2">
        {shown ? <SecretOnce label={t('integrations.yourKey')} value={shown} onDone={() => setShown(null)} /> : null}
        {adding ? (
          <form onSubmit={(e) => void add(e)} className="grid gap-4 rounded-xl border border-line p-4">
            <Field label={t('integrations.keyName')} hint={t('integrations.keyNameHint')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={60} autoComplete="off" placeholder="SAP HR" />}</Field>
            <Checks legend={t('integrations.scopes')} name="scopes" options={v.scopes.filter((s) => !s.write).map((s) => ({ value: s.scope, label: t(`integrations.scope.${scopeKey(s.scope)}`), hint: s.allowed ? s.scope : t('integrations.scopeNotYours'), disabled: !s.allowed }))} />
            {writeScopes.size ? (
              <div className="grid gap-1 rounded-xl border border-warn/40 bg-warn/5 p-3">
                <Checks
                  legend={t('integrations.writeScopes')}
                  badge={t('integrations.canChange')}
                  help={t('integrations.writeScopesHelp')}
                  name="writeScopes"
                  options={v.scopes.filter((s) => s.write).map((s) => ({ value: s.scope, label: t(`integrations.scope.${scopeKey(s.scope)}`), hint: s.allowed ? s.scope : t('integrations.writeNotYours'), disabled: !s.allowed }))}
                />
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('integrations.allowedIps')} hint={t('integrations.allowedIpsHint')}>{(p) => <Textarea {...p} name="allowedIps" rows={2} autoComplete="off" spellCheck={false} placeholder="203.0.113.0/24" />}</Field>
              <Field label={t('integrations.expires')} hint={t('integrations.expiresHint')}>{(p) => <Input {...p} name="expiresAt" type="date" />}</Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === 'add'} icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>{t('integrations.makeKey')}</Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        ) : null}
        {live.length ? (
          <ul className="divide-y divide-line">
            {live.map((k) => (
              <li key={k.id} className="grid gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-semibold text-ink">{k.name}</span>
                  {isWrite(k) ? (
                    <StatusPill tone="warn" icon={<PencilLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={2.5} />}>
                      {t('integrations.writeBadge')}
                    </StatusPill>
                  ) : null}
                  <StatusPill tone={tone[k.status]}>{t(`integrations.keyStatus.${k.status}`)}</StatusPill>
                </div>
                <code className="break-all text-caption text-muted">{k.prefix}_…</code>
                <p className="text-caption text-muted">
                  {k.scopes.join(', ')}
                  {k.allowedIps.length ? ` · ${t('integrations.onlyFrom', { list: k.allowedIps.join(', ') })}` : ''}
                </p>
                <p className="text-caption text-muted">
                  {k.lastUsedAt ? t('integrations.lastUsed', { time: when(k.lastUsedAt, i18n.language), count: k.requestCount }) : t('integrations.neverUsed')}
                  {k.expiresAt ? ` · ${t('integrations.expiresOn', { time: when(k.expiresAt, i18n.language) })}` : ''}
                </p>
                {k.status === 'active' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" loading={busy === `rotate-${k.id}`} icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={() => void rotate(k)} aria-label={t('integrations.rotateKey', { name: k.name })}>{t('integrations.rotate')}</Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setRevoking(k)} aria-label={t('integrations.revokeKey', { name: k.name })}>{t('integrations.revoke')}</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : !adding ? (
          <EmptyState icon={KeyRound} title={t('integrations.noKeys')} level={3} />
        ) : null}
      </CardBody>
      <Dialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        title={t('integrations.confirmWriteTitle', { name: confirming?.name ?? '' })}
        description={t('integrations.confirmWriteHelp')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
            <Button loading={busy === 'add'} onClick={() => confirming && void make(confirming)}>{t('integrations.confirmWriteOk')}</Button>
          </>
        }
      >
        <ul className="grid list-disc gap-1 pl-5 text-small text-ink">
          {(confirming?.scopes ?? []).filter((s) => writeScopes.has(s)).map((s) => (
            <li key={s}>{t(`integrations.scope.${scopeKey(s)}`)} <code className="text-caption text-muted">{s}</code></li>
          ))}
        </ul>
      </Dialog>
      <Dialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={t('integrations.revokeTitle', { name: revoking?.name ?? '' })}
        description={t('integrations.revokeHelp')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={busy === 'revoke'} onClick={() => void revoke()}>{t('integrations.revoke')}</Button>
          </>
        }
      />
    </Card>
  );
}

function WebhooksCard({ v, reload }: { v: View; reload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Endpoint | null>(null);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { url: String(f.get('url') ?? '').trim(), description: String(f.get('description') ?? '').trim() || null, events: f.getAll('events').map(String) };
    const r = await run('add', () => api<{ secret: string }>('/api/integrations/webhooks', { method: 'POST', body }), t('integrations.webhookMade'));
    if (r) {
      setShown(r.secret);
      setAdding(false);
      await reload();
    }
  }
  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    const r = await run(key, fn, ok);
    if (r !== undefined) await reload();
    return r;
  };
  async function test(ep: Endpoint) {
    const r = await run(`test-${ep.id}`, () => api<Delivery>(`/api/integrations/webhooks/${ep.id}/test`, { method: 'POST' }));
    if (r) await reload();
    return r;
  }
  const toast = useToast();
  async function sendTest(ep: Endpoint) {
    const r = await test(ep);
    if (r) toast(r.status === 'SUCCEEDED' ? t('integrations.testOk', { code: r.responseStatus }) : t('integrations.testFailed', { reason: r.error ?? r.responseStatus ?? '' }), r.status === 'SUCCEEDED' ? 'ok' : 'warn');
  }
  async function rotate(ep: Endpoint) {
    const r = await run(`rotate-${ep.id}`, () => api<{ secret: string }>(`/api/integrations/webhooks/${ep.id}/rotate-secret`, { method: 'POST' }), t('integrations.secretRotated'));
    if (r) setShown(r.secret);
  }
  async function remove() {
    if (!removing) return;
    await act('remove', () => api(`/api/integrations/webhooks/${removing.id}`, { method: 'DELETE' }), t('integrations.webhookRemoved'));
    setRemoving(null);
  }
  const state = (ep: Endpoint): [Tone, string] => (ep.enabled ? ['ok', t('integrations.on')] : ep.disabledReason === 'failures' ? ['warn', t('integrations.offFailures')] : ['neutral', t('integrations.off')]);

  return (
    <Card>
      <CardHeader
        title={t('integrations.webhooksTitle')}
        description={t('integrations.webhooksHelp')}
        action={v.inPlan && !adding ? <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('integrations.newWebhook')}</Button> : undefined}
      />
      <CardBody className="grid gap-4 pt-2">
        {shown ? <SecretOnce label={t('integrations.yourSecret')} value={shown} onDone={() => setShown(null)} /> : null}
        {adding ? (
          <form onSubmit={(e) => void add(e)} className="grid gap-4 rounded-xl border border-line p-4">
            <Field label={t('integrations.url')} hint={t('integrations.urlHint')}>{(p) => <Input {...p} name="url" type="url" inputMode="url" required maxLength={500} autoComplete="url" placeholder="https://erp.example.ca/fh/events" />}</Field>
            <Field label={t('integrations.description')}>{(p) => <Input {...p} name="description" maxLength={120} autoComplete="off" placeholder="Tempest" />}</Field>
            <Checks legend={t('integrations.events')} name="events" options={v.events.map((e) => ({ value: e, label: t(`integrations.event.${eventKey(e)}`), hint: e }))} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === 'add'} icon={<Webhook className="h-4 w-4" aria-hidden="true" />}>{t('integrations.addWebhook')}</Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
            </div>
          </form>
        ) : null}
        {v.webhooks.length ? (
          <ul className="divide-y divide-line">
            {v.webhooks.map((ep) => {
              const [tone, label] = state(ep);
              return (
                <li key={ep.id} className="grid gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-all font-semibold text-ink">{ep.description || new URL(ep.url).host}</span>
                    <StatusPill tone={tone}>{label}</StatusPill>
                  </div>
                  <code className="break-all text-caption text-muted">{ep.url}</code>
                  <p className="text-caption text-muted">{ep.events.join(', ')}</p>
                  <p className="text-caption text-muted">
                    {ep.lastSuccessAt ? t('integrations.lastSuccess', { time: when(ep.lastSuccessAt, i18n.language) }) : t('integrations.noSuccessYet')}
                    {ep.consecutiveFailures ? ` · ${t('integrations.failuresInRow', { count: ep.consecutiveFailures })}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" loading={busy === `test-${ep.id}`} icon={<Send className="h-4 w-4" aria-hidden="true" />} onClick={() => void sendTest(ep)} disabled={!v.inPlan}>{t('integrations.sendTest')}</Button>
                    <Button size="sm" variant="secondary" loading={busy === `toggle-${ep.id}`} onClick={() => void act(`toggle-${ep.id}`, () => api(`/api/integrations/webhooks/${ep.id}`, { method: 'PATCH', body: { enabled: !ep.enabled } }), ep.enabled ? t('integrations.turnedOff') : t('integrations.turnedOn'))} disabled={!v.inPlan}>
                      {ep.enabled ? t('integrations.turnOff') : t('integrations.turnOn')}
                    </Button>
                    <Button size="sm" variant="ghost" loading={busy === `rotate-${ep.id}`} icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={() => void rotate(ep)} disabled={!v.inPlan}>{t('integrations.rotateSecret')}</Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setRemoving(ep)} aria-label={t('integrations.removeWebhook', { url: ep.url })}>{t('integrations.remove')}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : !adding ? (
          <EmptyState icon={Webhook} title={t('integrations.noWebhooks')} level={3} />
        ) : null}
        <p className="text-caption text-muted">{t('integrations.signingHelp')}</p>
      </CardBody>
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t('integrations.removeTitle')}
        description={t('integrations.removeHelp', { url: removing?.url ?? '' })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={busy === 'remove'} onClick={() => void remove()}>{t('integrations.remove')}</Button>
          </>
        }
      />
    </Card>
  );
}

function DeliveriesCard({ endpoints }: { endpoints: Endpoint[] }) {
  const { t, i18n } = useTranslation();
  const list = useQuery<Delivery[]>('/api/integrations/deliveries?limit=30');
  const { run, busy } = useAction();
  const name = (id: string) => {
    const ep = endpoints.find((e) => e.id === id);
    return ep ? ep.description || new URL(ep.url).host : '';
  };
  const tone: Record<Delivery['status'], Tone> = { SUCCEEDED: 'ok', FAILED: 'danger', PENDING: 'neutral' };
  async function again(d: Delivery) {
    const r = await run(d.id, () => api<Delivery>(`/api/integrations/deliveries/${d.id}/redeliver`, { method: 'POST' }), t('integrations.redelivered'));
    if (r) await list.reload();
  }
  return (
    <Card>
      <CardHeader
        title={t('integrations.deliveriesTitle')}
        description={t('integrations.deliveriesHelp')}
        action={<Button size="sm" variant="ghost" icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={() => void list.reload()}>{t('integrations.refresh')}</Button>}
      />
      <CardBody className="pt-2">
        {list.error ? (
          <ErrorNotice onRetry={list.reload} />
        ) : !list.data ? (
          <ListSkeleton rows={3} />
        ) : !list.data.length ? (
          <p className="text-small text-muted">{t('integrations.noDeliveries')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-small font-semibold text-ink">
                    <code>{d.eventType}</code>
                    {d.test ? ` · ${t('integrations.test')}` : ''}
                    {d.redelivery ? ` · ${t('integrations.again')}` : ''}
                  </p>
                  <p className="break-words text-caption text-muted">
                    {name(d.endpointId)} · {when(d.createdAt, i18n.language)} · {t('integrations.tries', { count: d.attempts })}
                    {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ''}
                    {d.error && d.status !== 'SUCCEEDED' ? ` · ${d.error}` : ''}
                    {d.nextAttemptAt ? ` · ${t('integrations.nextTry', { time: when(d.nextAttemptAt, i18n.language) })}` : ''}
                  </p>
                </div>
                <StatusPill tone={tone[d.status]}>{t(`integrations.delivery.${d.status}`)}</StatusPill>
                {d.status !== 'PENDING' ? (
                  <Button size="sm" variant="ghost" loading={busy === d.id} onClick={() => void again(d)} aria-label={t('integrations.redeliverOne', { type: d.eventType })}>{t('integrations.redeliver')}</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
