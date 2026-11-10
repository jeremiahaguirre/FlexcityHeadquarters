'use client';

import { Copy, KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

type Protocol = 'OIDC' | 'SAML';
interface Connection { protocol: Protocol; enabled: boolean; enforced: boolean; idpMfa: boolean; label: string | null; domains: string[]; oidcIssuer: string | null; oidcClientId: string | null; hasSecret: boolean; samlEntryPoint: string | null; samlIdpIssuer: string | null; samlCert: string | null; lastUsedAt: string | null }
interface SsoView { sp: { redirectUri: string; acsUrl: string; entityId: string; metadataUrl: string }; connection: Connection | null }

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  return (
    <div className="grid gap-1">
      <span className="text-caption font-semibold text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-page px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-small">{value}</code>
        <button
          type="button"
          aria-label={t('sso.copy', { what: label })}
          className="rounded-md p-1 text-muted hover:text-ink"
          onClick={() => void navigator.clipboard.writeText(value).then(() => toast(t('sso.copied'), 'ok'), () => undefined)}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const Check = ({ name, label, hint, checked }: { name: string; label: string; hint: string; checked: boolean }) => (
  <label className="flex items-start gap-3 text-small">
    <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />
    <span>
      <span className="block font-semibold">{label}</span>
      <span className="text-muted">{hint}</span>
    </span>
  </label>
);

/** HR connects Microsoft Entra ID (or any OpenID Connect / SAML provider) for staff sign-in. */
export function SsoCard() {
  const { t, i18n } = useTranslation();
  const data = useQuery<SsoView>('/api/sso');
  const { run, busy } = useAction();
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const c = data.data?.connection ?? null;
  const p: Protocol = protocol ?? c?.protocol ?? 'OIDC';

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? '').trim() || null;
    const secret = str('oidcSecret');
    const body = {
      protocol: p,
      enabled: f.get('enabled') === 'on',
      enforced: f.get('enforced') === 'on',
      idpMfa: f.get('idpMfa') === 'on',
      label: str('label'),
      domains: String(f.get('domains') ?? '').split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean),
      oidcIssuer: str('oidcIssuer') ?? c?.oidcIssuer ?? null,
      oidcClientId: str('oidcClientId') ?? c?.oidcClientId ?? null,
      ...(secret ? { oidcSecret: secret } : {}),
      samlEntryPoint: str('samlEntryPoint') ?? c?.samlEntryPoint ?? null,
      samlIdpIssuer: str('samlIdpIssuer') ?? c?.samlIdpIssuer ?? null,
      samlCert: str('samlCert') ?? c?.samlCert ?? null,
    };
    const r = await run('save', () => api('/api/sso', { method: 'PUT', body }), t('sso.saved'));
    if (r !== undefined) await data.reload();
  }

  if (data.error) return null;
  if (!data.data) return <Skeleton className="h-64" />;
  const sp = data.data.sp;
  return (
    <Card>
      <CardHeader
        title={t('sso.title')}
        description={t('sso.help')}
        action={c?.enabled ? <StatusPill tone="ok">{c.enforced ? t('sso.statusEnforced') : t('sso.statusOn')}</StatusPill> : <StatusPill tone="neutral">{t('sso.statusOff')}</StatusPill>}
      />
      <CardBody className="pt-2">
        <form key={`${p}-${c?.lastUsedAt ?? ''}-${c?.enabled}`} className="grid gap-5" onSubmit={(e) => void save(e)}>
          <Segmented<Protocol> label={t('sso.protocol')} value={p} onChange={setProtocol} options={[{ value: 'OIDC', label: t('sso.oidc') }, { value: 'SAML', label: t('sso.saml') }]} />

          <div className="grid gap-3 rounded-xl border border-line p-4">
            <p className="text-small font-semibold">{t('sso.step1')}</p>
            {p === 'OIDC' ? (
              <>
                <p className="text-small text-muted">{t('sso.oidcStep1')}</p>
                <CopyRow label={t('sso.redirectUri')} value={sp.redirectUri} />
              </>
            ) : (
              <>
                <p className="text-small text-muted">{t('sso.samlStep1')}</p>
                <CopyRow label={t('sso.entityId')} value={sp.entityId} />
                <CopyRow label={t('sso.acsUrl')} value={sp.acsUrl} />
                <CopyRow label={t('sso.metadataUrl')} value={sp.metadataUrl} />
              </>
            )}
          </div>

          <div className="grid gap-4">
            <p className="text-small font-semibold">{t('sso.step2')}</p>
            {p === 'OIDC' ? (
              <>
                <Field label={t('sso.issuer')} hint={t('sso.issuerHint')}>{(x) => <Input {...x} name="oidcIssuer" defaultValue={c?.oidcIssuer ?? ''} placeholder="https://login.microsoftonline.com/<tenant-id>/v2.0" autoComplete="off" />}</Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('sso.clientId')}>{(x) => <Input {...x} name="oidcClientId" defaultValue={c?.oidcClientId ?? ''} autoComplete="off" />}</Field>
                  <Field label={t('sso.clientSecret')} hint={c?.hasSecret ? t('sso.secretKept') : t('sso.secretHint')}>{(x) => <Input {...x} name="oidcSecret" type="password" autoComplete="new-password" placeholder={c?.hasSecret ? '••••••••' : ''} />}</Field>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('sso.entryPoint')}>{(x) => <Input {...x} name="samlEntryPoint" type="url" defaultValue={c?.samlEntryPoint ?? ''} autoComplete="off" />}</Field>
                  <Field label={t('sso.idpIssuer')}>{(x) => <Input {...x} name="samlIdpIssuer" defaultValue={c?.samlIdpIssuer ?? ''} autoComplete="off" />}</Field>
                </div>
                <Field label={t('sso.cert')} hint={t('sso.certHint')}>{(x) => <Textarea {...x} name="samlCert" rows={5} defaultValue={c?.samlCert ?? ''} className="font-mono text-caption" />}</Field>
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('sso.label')} hint={t('sso.labelHint')}>{(x) => <Input {...x} name="label" defaultValue={c?.label ?? ''} maxLength={40} placeholder="Microsoft" />}</Field>
              <Field label={t('sso.domains')} hint={t('sso.domainsHint')}>{(x) => <Input {...x} name="domains" defaultValue={c?.domains.join(', ') ?? ''} placeholder="kelowna.ca" />}</Field>
            </div>
          </div>

          <div className="grid gap-3">
            <p className="text-small font-semibold">{t('sso.step3')}</p>
            <Check name="enabled" label={t('sso.enabled')} hint={t('sso.enabledHint')} checked={!!c?.enabled} />
            <Check name="enforced" label={t('sso.enforced')} hint={t('sso.enforcedHint')} checked={!!c?.enforced} />
            <Check name="idpMfa" label={t('sso.idpMfa')} hint={t('sso.idpMfaHint')} checked={!!c?.idpMfa} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy === 'save'} icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>{t('common.save')}</Button>
            {c?.lastUsedAt ? <span className="text-caption text-muted">{t('sso.lastUsed', { time: new Date(c.lastUsedAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) })}</span> : null}
          </div>
          <p className="text-caption text-muted">{t('sso.safety')}</p>
        </form>
      </CardBody>
    </Card>
  );
}
