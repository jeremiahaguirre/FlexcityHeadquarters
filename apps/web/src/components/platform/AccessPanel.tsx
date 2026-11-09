'use client';

import { RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { papi, usePlatformQuery } from '@/lib/platform';
import { useAction } from '@/lib/useQuery';
import type { PanelProps } from './types';

interface Access {
  roles: Array<{ role: string; mfa: boolean; customized: boolean; permissions: string[]; defaults: string[]; menu: Array<{ href: string; shown: boolean }> }>;
  menu: Array<{ href: string; key: string; group: string; permissions: string[]; feature: string | null; featureOn: boolean }>;
  permissions: Array<{ key: string; feature: string | null }>;
}

const GROUPS = ['mine', 'deck', 'manage', 'union'] as const;
/** Permissions that reach pay, personal records, discipline or city setup. */
const SENSITIVE = new Set(['users.write', 'users.privacy', 'payroll.export', 'discipline.read', 'discipline.write', 'reliability.read', 'reliability.write', 'audit.read', 'tenant.configure', 'incidents.read', 'compliance.report']);

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-brand' : 'bg-line'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[1.125rem]' : 'left-0.5'}`} />
    </button>
  );
}

/** Every menu item and permission, per access level, as switches. Changes apply to the API on the next request. */
export function AccessPanel({ id }: PanelProps) {
  const { t } = useTranslation();
  const q = usePlatformQuery<Access>(`/tenants/${id}/access`);
  const [data, setData] = useState<Access | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const { run } = useAction();
  const a = data ?? q.data;
  if (!a) return <Skeleton className="h-96" />;

  async function change(key: string, fn: () => Promise<Access>, ok: string) {
    setBusy(key);
    const next = await run(key, fn, ok);
    if (next && Array.isArray(next.roles)) setData(next);
    else await q.reload();
    setBusy(null);
  }
  const roleName = (r: string) => t(`roles.${r}`);
  const head = (
    <tr>
      <th className="sticky left-0 z-10 bg-panel py-2 pr-4 text-left font-semibold" />
      {a.roles.map((r) => (
        <th key={r.role} className="min-w-[6.5rem] px-2 py-2 text-center align-bottom">
          <span className="block text-caption font-semibold">{roleName(r.role)}</span>
          {r.customized ? (
            <button
              type="button"
              className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-brand-text hover:underline"
              onClick={() => void change(`reset${r.role}`, () => papi<Access>(`/tenants/${id}/access/reset`, { method: 'POST', body: { role: r.role } }), t('access.resetDone', { role: roleName(r.role) }))}
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {t('access.reset')}
            </button>
          ) : (
            <span className="mt-1 block text-caption text-muted">{t('access.default')}</span>
          )}
        </th>
      ))}
    </tr>
  );
  const table = (rows: ReactNode) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-small">
        <thead>{head}</thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );

  return (
    <div className="grid gap-6">
      <p className="text-small text-muted">{t('access.help')}</p>
      <Card>
        <CardHeader title={t('access.mfaTitle')} />
        <CardBody className="pt-1">
          <p className="mb-3 text-small text-muted">{t('access.mfaHelp')}</p>
          {table(
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-panel py-2 pr-4 text-left font-semibold">
                {t('access.mfaRow')}
              </th>
              {a.roles.map((r) => {
                const key = `mfa${r.role}`;
                return (
                  <td key={r.role} className="px-2 py-2 text-center">
                    <span className="inline-flex justify-center">
                      <Switch
                        on={r.mfa}
                        disabled={busy === key}
                        label={t('access.mfaSwitch', { role: roleName(r.role) })}
                        onChange={() => void change(key, () => papi<Access>(`/tenants/${id}/access/mfa`, { method: 'PUT', body: { role: r.role, required: !r.mfa } }), t(r.mfa ? 'access.mfaOff' : 'access.mfaOn', { role: roleName(r.role) }))}
                      />
                    </span>
                  </td>
                );
              })}
            </tr>,
          )}
        </CardBody>
      </Card>
      {GROUPS.map((g) => {
        const items = a.menu.filter((m) => m.group === g);
        return (
          <Card key={g}>
            <CardHeader title={t(`navGroups.${g}`)} />
            <CardBody className="pt-1">
              {table(
                items.map((m) => (
                  <tr key={m.href} className="border-t border-line">
                    <th scope="row" className="sticky left-0 z-10 border-t border-line bg-panel py-2.5 pr-4 text-left font-normal">
                      <span className="block font-semibold">{t(`nav.${m.key}`)}</span>
                      {!m.featureOn ? <StatusPill tone="neutral" className="mt-1">{t('access.featureOff')}</StatusPill> : null}
                    </th>
                    {a.roles.map((r) => {
                      const shown = r.menu.find((x) => x.href === m.href)!.shown;
                      const key = `${r.role}${m.href}`;
                      return (
                        <td key={r.role} className="border-t border-line px-2 py-2.5 text-center">
                          <div className="flex justify-center">
                            <Switch
                              on={shown}
                              disabled={busy === key || !m.featureOn}
                              label={t('access.menuSwitch', { item: t(`nav.${m.key}`), role: roleName(r.role) })}
                              onChange={() => void change(key, () => papi<Access>(`/tenants/${id}/access/menu`, { method: 'PUT', body: { role: r.role, href: m.href, shown: !shown } }), t(shown ? 'access.hidden' : 'access.shown', { item: t(`nav.${m.key}`), role: roleName(r.role) }))}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                )),
              )}
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader
          title={t('access.advanced')}
          description={t('access.advancedHelp')}
          action={<Button size="sm" variant="secondary" onClick={() => setAdvanced((v) => !v)}>{advanced ? t('access.hideAdvanced') : t('access.showAdvanced')}</Button>}
        />
        {advanced ? (
          <CardBody className="pt-1">
            {table(
              a.permissions.map((p) => (
                <tr key={p.key}>
                  <th scope="row" className="sticky left-0 z-10 border-t border-line bg-panel py-2 pr-4 text-left font-normal">
                    <code className="text-caption">{p.key}</code>
                    {SENSITIVE.has(p.key) ? <StatusPill tone="warn" className="ml-2">{t('access.sensitive')}</StatusPill> : null}
                  </th>
                  {a.roles.map((r) => {
                    const on = r.permissions.includes(p.key);
                    const changed = on !== r.defaults.includes(p.key);
                    const key = `${r.role}:${p.key}`;
                    return (
                      <td key={r.role} className={`border-t border-line px-2 py-2 text-center ${changed ? 'bg-brand/5' : ''}`}>
                        <div className="flex justify-center">
                          <Switch
                            on={on}
                            disabled={busy === key}
                            label={t('access.permSwitch', { perm: p.key, role: roleName(r.role) })}
                            onChange={() => void change(key, () => papi<Access>(`/tenants/${id}/access/permission`, { method: 'PUT', body: { role: r.role, permission: p.key, on: !on } }), t('access.saved'))}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              )),
            )}
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
