'use client';

import { ClipboardCheck, FileSignature } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { type ChecklistItem, isOpen, itemName, stateTone } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';

/** The employee's own onboarding: policies to read and sign, and what HR or their supervisor still needs. */
export function MyOnboarding({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const { me } = useSession();
  const list = useQuery<ChecklistItem[]>('/api/me/onboarding');
  const { run, busy } = useAction();
  const [reading, setReading] = useState<ChecklistItem | null>(null);
  const items = list.data ?? [];
  const open = items.filter((i) => isOpen(i.state) || i.state === 'EXPIRING');
  if (!items.length || (compact && !open.length)) return null;

  async function acknowledge(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reading) return;
    const typedName = String(new FormData(e.currentTarget).get('name'));
    const ok = await run('ack', () => api(`/api/me/onboarding/${reading.id}/acknowledge`, { method: 'POST', body: { typedName } }), t('onboarding.acknowledged'));
    if (ok !== undefined) {
      setReading(null);
      await list.reload();
    }
  }
  // On Today: only what the employee does themselves, plus one line for the rest.
  const shown = compact ? open.filter((i) => i.owner === 'EMPLOYEE') : items;
  const othersOpen = open.filter((i) => i.owner !== 'EMPLOYEE').length;
  if (compact && !shown.length) return null;
  return (
    <Card className={compact ? 'border-brand/30' : 'lg:col-span-2'}>
      <CardHeader title={t('onboarding.mine')} description={t('onboarding.mineHelp', { done: items.length - open.length, total: items.length })} />
      <CardBody className="pt-2">
        <ul className="grid gap-2">
          {shown.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5 text-small">
              <span className="min-w-0">
                <span className="block font-semibold">{itemName(i, lng)}</span>
                <span className="text-caption text-muted">{t(`onboarding.whoDoes.${i.owner}`)}</span>
              </span>
              {i.owner === 'EMPLOYEE' && i.kind === 'ACKNOWLEDGEMENT' && isOpen(i.state) ? (
                <Button size="sm" icon={<FileSignature className="h-4 w-4" aria-hidden="true" />} onClick={() => setReading(i)}>{t('onboarding.readAndSign')}</Button>
              ) : (
                <StatusPill tone={stateTone(i.state)}>{t(`onboarding.state.${i.state}`)}</StatusPill>
              )}
            </li>
          ))}
        </ul>
        {compact && othersOpen ? <p className="mt-3 text-caption text-muted">{t('onboarding.othersOpen', { count: othersOpen })}</p> : null}
        {!compact ? <p className="mt-3 flex gap-2 text-caption text-muted"><ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden="true" />{t('onboarding.privacy')}</p> : null}
      </CardBody>
      <Dialog open={!!reading} onClose={() => setReading(null)} title={reading ? itemName(reading, lng) : ''} description={t('onboarding.readHelp')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => void acknowledge(e)}>
          <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface p-4 text-small leading-6">{reading?.policyText ?? reading?.description}</div>
          <Field label={t('onboarding.typeName')} hint={t('onboarding.typeNameHint')}>{(p) => <Input {...p} name="name" required minLength={2} autoComplete="name" defaultValue="" placeholder={me ? `${me.firstName} ${me.lastName}` : ''} />}</Field>
          <Button type="submit" loading={busy === 'ack'}>{t('onboarding.acknowledge')}</Button>
        </form>
      </Dialog>
    </Card>
  );
}
