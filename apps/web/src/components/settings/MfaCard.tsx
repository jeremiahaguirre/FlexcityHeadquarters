'use client';

import { type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

/** Which access levels must use a passkey (or their provider's MFA) to sign in. HR always does. */
export function MfaCard() {
  const { t } = useTranslation();
  const data = useQuery<{ roles: string[]; all: string[] }>('/api/settings/mfa');
  const { run, busy } = useAction();
  if (data.error || !data.data) return null;
  const d = data.data;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('save', () => api('/api/settings/mfa', { method: 'PUT', body: { roles: f.getAll('role').map(String) } }), t('mfaSettings.saved'));
    if (r !== undefined) await data.reload();
  }
  return (
    <Card>
      <CardHeader title={t('mfaSettings.title')} description={t('mfaSettings.help')} />
      <CardBody className="pt-2">
        <form key={d.roles.join()} className="grid gap-3" onSubmit={(e) => void save(e)}>
          <div className="grid gap-2 sm:grid-cols-2">
            {d.all.map((r) => (
              <label key={r} className="flex items-center gap-3 text-small">
                <input type="checkbox" name="role" value={r} defaultChecked={d.roles.includes(r) || r === 'HR_ADMIN'} disabled={r === 'HR_ADMIN'} className="h-5 w-5 accent-[rgb(var(--brand))]" />
                {t(`roles.${r}`)}
              </label>
            ))}
          </div>
          <p className="text-caption text-muted">{t('mfaSettings.note')}</p>
          <div><Button type="submit" size="sm" loading={busy === 'save'}>{t('common.save')}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
