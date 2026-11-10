'use client';

import { Copy, KeyRound, Plus, Tablet, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

interface KioskRow { id: string; name: string; facility: string; lastSeenAt: string | null }

/** Supervisors: shared tablets where staff punch with their number and PIN. */
export function KiosksCard() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const toast = useToast();
  const list = useQuery<KioskRow[]>(can('timeclock.review') ? '/api/kiosks' : null);
  const facilities = useQuery<Array<{ id: string; name: string }>>(can('timeclock.review') ? '/api/facilities' : null);
  const { run, busy } = useAction();
  const [link, setLink] = useState<string | null>(null);
  if (!can('timeclock.review') || !list.data) return null;
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('add', () => api<{ setupUrl: string }>('/api/kiosks', { method: 'POST', body: { facilityId: String(f.get('facilityId')), name: String(f.get('name')) } }));
    if (r) { setLink(r.setupUrl); (e.target as HTMLFormElement).reset(); await list.reload(); }
  }
  return (
    <Card>
      <CardHeader title={t('kiosk.adminTitle')} description={t('kiosk.adminHelp')} />
      <CardBody className="grid gap-4 pt-2">
        {link ? (
          <div className="grid gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3">
            <p className="text-small text-ink">{t('kiosk.setupLink')}</p>
            <div className="flex flex-wrap gap-2">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t('kiosk.setupLinkLabel')} className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-small" />
              <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={() => void navigator.clipboard.writeText(link).then(() => toast(t('calendarFeed.copied'), 'ok'), () => toast(t('calendarFeed.copyManually'), 'warn'))}>{t('calendarFeed.copy')}</Button>
            </div>
          </div>
        ) : null}
        {list.data.length ? (
          <ul className="divide-y divide-line text-small">
            {list.data.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2 py-2">
                <Tablet className="h-4 w-4 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="font-semibold text-ink">{k.name}</span> · {k.facility}</span>
                <StatusPill tone={k.lastSeenAt ? 'ok' : 'neutral'}>{k.lastSeenAt ? t('kiosk.seen', { date: formatDate(k.lastSeenAt, i18n.language) }) : t('kiosk.neverSeen')}</StatusPill>
                <Button size="sm" variant="ghost" aria-label={t('kiosk.revoke', { name: k.name })} loading={busy === k.id} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => void run(k.id, () => api(`/api/kiosks/${k.id}`, { method: 'DELETE' }), t('kiosk.revoked')).then(() => list.reload())} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted">{t('kiosk.none')}</p>
        )}
        <form onSubmit={(e) => void add(e)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={t('kiosk.facility')}>{(p) => <Select {...p} name="facilityId" required>{facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>}</Field>
          <Field label={t('kiosk.name')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={60} placeholder={t('kiosk.namePlaceholder')} />}</Field>
          <Button type="submit" loading={busy === 'add'} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('kiosk.add')}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** A person's PIN for the facility kiosk. */
export function KioskPinCard() {
  const { t } = useTranslation();
  const { can } = useSession();
  const q = useQuery<{ set: boolean; employeeNumber: string | null }>(can('timeclock.punch') ? '/api/me/kiosk-pin' : null);
  const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  if (!q.data) return null;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pin = String(new FormData(e.currentTarget).get('pin'));
    const r = await run('pin', () => api('/api/me/kiosk-pin', { method: 'PUT', body: { pin } }), t('kiosk.pinSaved'));
    if (r !== undefined) { setEditing(false); await q.reload(); }
  }
  return (
    <Card>
      <CardHeader title={t('kiosk.pinTitle')} description={q.data.employeeNumber ? t('kiosk.pinHelp', { number: q.data.employeeNumber }) : t('kiosk.pinNoNumber')} action={q.data.set ? <StatusPill tone="ok">{t('kiosk.pinSet')}</StatusPill> : undefined} />
      {q.data.employeeNumber ? (
        <CardBody className="pt-2">
          {editing ? (
            <form onSubmit={(e) => void save(e)} className="grid gap-3">
              <Field label={t('kiosk.newPin')} hint={t('kiosk.pinRule')}>{(p) => <Input {...p} name="pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="\d{4,6}" minLength={4} maxLength={6} required className="w-40" />}</Field>
              <div className="flex gap-2"><Button type="submit" loading={busy === 'pin'}>{t('common.save')}</Button><Button variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button></div>
            </form>
          ) : (
            <Button size="sm" variant="secondary" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing(true)}>{q.data.set ? t('kiosk.changePin') : t('kiosk.setPin')}</Button>
          )}
        </CardBody>
      ) : null}
    </Card>
  );
}
