'use client';

import { MessageSquareText } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

interface SmsState { enabled: boolean; phone: string | null; verified: boolean; urgentShifts: boolean }

/** Urgent texts and calls: shown only where the organization turned them on. */
export function TextAlertsCard() {
  const { t } = useTranslation();
  const q = useQuery<SmsState>('/api/me/sms');
  const { run, busy } = useAction();
  const [pending, setPending] = useState<string | null>(null);
  const s = q.data;
  if (!s?.enabled) return null;

  async function sendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const phone = String(new FormData(e.currentTarget).get('phone'));
    const r = await run('send', () => api('/api/me/sms', { method: 'POST', body: { phone } }), t('textAlerts.codeSent'));
    if (r !== undefined) setPending(phone);
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code'));
    const r = await run('verify', () => api('/api/me/sms/verify', { method: 'POST', body: { phone: pending, code } }), t('textAlerts.verified'));
    if (r !== undefined) { setPending(null); await q.reload(); }
  }

  return (
    <Card>
      <CardHeader title={t('textAlerts.title')} description={t('textAlerts.help')} action={s.verified ? <StatusPill tone="ok">{t('textAlerts.on')}</StatusPill> : undefined} />
      <CardBody className="grid gap-4 pt-3">
        {s.verified && !pending ? (
          <>
            <p className="flex items-center gap-2 text-body text-ink"><MessageSquareText className="h-4 w-4 text-muted" aria-hidden="true" />{t('textAlerts.to', { phone: s.phone })}</p>
            <label className="flex items-start gap-3 text-body text-ink">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" checked={s.urgentShifts} disabled={busy === 'pref'} onChange={(e) => void run('pref', () => api('/api/me/sms', { method: 'PATCH', body: { urgentShifts: e.target.checked } })).then(() => q.reload())} />
              <span>{t('textAlerts.urgentShifts')}<span className="block text-small text-muted">{t('textAlerts.urgentShiftsHelp')}</span></span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPending('')}>{t('textAlerts.change')}</Button>
              <Button size="sm" variant="ghost" loading={busy === 'off'} onClick={() => void run('off', () => api('/api/me/sms', { method: 'DELETE' }), t('textAlerts.stopped')).then(() => q.reload())}>{t('textAlerts.stop')}</Button>
            </div>
          </>
        ) : pending ? (
          <form onSubmit={(e) => void verify(e)} className="grid gap-4">
            <p className="text-small text-muted">{t('textAlerts.enterCode', { phone: pending })}</p>
            <Field label={t('textAlerts.code')}>{(p) => <Input {...p} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className="w-40 tracking-[0.3em]" />}</Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === 'verify'}>{t('textAlerts.confirm')}</Button>
              <Button variant="ghost" onClick={() => setPending(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        ) : null}
        {(!s.verified && !pending) || pending === '' ? (
          <form onSubmit={(e) => void sendCode(e)} className="grid gap-4">
            <Field label={t('textAlerts.mobile')} hint={t('textAlerts.mobileHint')}>{(p) => <Input {...p} name="phone" type="tel" autoComplete="tel" required className="max-w-xs" />}</Field>
            <Button type="submit" className="justify-self-start" loading={busy === 'send'}>{t('textAlerts.sendCode')}</Button>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
