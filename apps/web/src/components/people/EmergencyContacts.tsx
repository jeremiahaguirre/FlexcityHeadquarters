'use client';

import { ArrowUp, Phone, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { useAction, useQuery } from '@/lib/useQuery';

export interface Contact { id?: string; name: string; relationship: string | null; phone: string; altPhone: string | null; priority?: number }
const MAX = 3;
const blank = (): Contact => ({ name: '', relationship: '', phone: '', altPhone: '' });

/** Read-only list with tap-to-call numbers (monitors, HR). */
export function ContactList({ contacts }: { contacts: Contact[] }) {
  const { t } = useTranslation();
  if (!contacts.length) return <p className="text-small text-muted">{t('emergency.none')}</p>;
  return (
    <ol className="grid gap-2">
      {contacts.map((c, i) => (
        <li key={c.id ?? i} className="rounded-xl border border-line p-3">
          <p className="font-semibold text-ink">{i + 1}. {c.name}{c.relationship ? <span className="font-normal text-muted"> · {c.relationship}</span> : null}</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-small">
            <a className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}><Phone className="h-3.5 w-3.5" aria-hidden="true" />{c.phone}</a>
            {c.altPhone ? <a className="inline-flex items-center gap-1 text-brand-text underline-offset-2 hover:underline" href={`tel:${c.altPhone.replace(/[^\d+]/g, '')}`}><Phone className="h-3.5 w-3.5" aria-hidden="true" />{c.altPhone}</a> : null}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Editor for one person's contacts: `/api/me/emergency-contacts` or `/api/users/:id/emergency-contacts`. */
export function EmergencyContactsCard({ path, own }: { path: string; own: boolean }) {
  const { t } = useTranslation();
  const q = useQuery<Contact[]>(path);
  const { run, busy } = useAction();
  const [rows, setRows] = useState<Contact[] | null>(null);
  useEffect(() => setRows(null), [path]);
  const editing = rows !== null;
  const set = (i: number, k: keyof Contact, v: string) => setRows((r) => r!.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const move = (i: number) => setRows((r) => { const n = [...r!]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n; });

  async function save(e: FormEvent) {
    e.preventDefault();
    const body = rows!.filter((c) => c.name.trim() || c.phone.trim()).map((c) => ({ name: c.name.trim(), relationship: c.relationship?.trim() || null, phone: c.phone.trim(), altPhone: c.altPhone?.trim() || null }));
    const ok = await run('save', () => api(path, { method: 'PUT', body }), t('emergency.saved'));
    if (ok !== undefined) { setRows(null); await q.reload(); }
  }

  return (
    <Card>
      <CardHeader
        title={t('emergency.title')}
        description={own ? t('emergency.helpOwn') : t('emergency.helpHr')}
        action={!editing ? <Button size="sm" variant="secondary" onClick={() => setRows(q.data?.length ? q.data.map((c) => ({ ...c, relationship: c.relationship ?? '', altPhone: c.altPhone ?? '' })) : [blank()])}>{q.data?.length ? t('common.edit') : t('emergency.add')}</Button> : null}
      />
      <CardBody className="pt-3">
        {!editing ? (
          q.data ? <ContactList contacts={q.data} /> : null
        ) : (
          <form onSubmit={(e) => void save(e)} className="grid gap-4">
            {rows.map((c, i) => (
              <fieldset key={i} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
                <legend className="px-1 text-small font-semibold text-ink">{t('emergency.order', { n: i + 1 })}</legend>
                <Field label={t('emergency.name')}>{(p) => <Input {...p} value={c.name} onChange={(e) => set(i, 'name', e.target.value)} required minLength={2} maxLength={80} autoComplete="off" />}</Field>
                <Field label={t('emergency.relationship')}>{(p) => <Input {...p} value={c.relationship ?? ''} onChange={(e) => set(i, 'relationship', e.target.value)} maxLength={40} placeholder={t('emergency.relationshipHint')} />}</Field>
                <Field label={t('emergency.phone')}>{(p) => <Input {...p} type="tel" value={c.phone} onChange={(e) => set(i, 'phone', e.target.value)} required />}</Field>
                <Field label={t('emergency.altPhone')}>{(p) => <Input {...p} type="tel" value={c.altPhone ?? ''} onChange={(e) => set(i, 'altPhone', e.target.value)} />}</Field>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  {i > 0 ? <Button size="sm" variant="ghost" icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />} onClick={() => move(i)}>{t('emergency.callFirst')}</Button> : null}
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setRows((r) => r!.filter((_, j) => j !== i))}>{t('emergency.remove')}</Button>
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-2">
              {rows.length < MAX ? <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setRows((r) => [...r!, blank()])}>{t('emergency.another')}</Button> : null}
              <Button type="submit" loading={busy === 'save'}>{t('common.save')}</Button>
              <Button variant="ghost" onClick={() => setRows(null)}>{t('common.cancel')}</Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
