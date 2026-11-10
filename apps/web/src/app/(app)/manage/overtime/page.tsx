'use client';

import { PhoneCall, Scale } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { formatDate, dateFormat } from '@/lib/format';
import { useAction, useQuery } from '@/lib/useQuery';

interface Row { userId: string; name: string; chargedHours: number; acceptedHours: number; refusals: number; seniorityDate: string | null }
interface Standings { policy: { countRefusals: boolean; clause: string | null; periodStartMonth: number }; periodFrom: string; rows: Row[] }

const localInput = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Overtime in agreement order: fewest hours charged, then seniority. */
export default function OvertimePage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const positions = useQuery<Array<{ id: string; name: string; nameFr: string | null }>>('/api/positions');
  const [positionId, setPositionId] = useState('');
  useEffect(() => {
    if (!positionId && positions.data?.[0]) setPositionId(positions.data[0].id);
  }, [positions.data, positionId]);
  const data = useQuery<Standings>(positionId ? `/api/overtime/standings?positionId=${positionId}` : null);
  const policy = useQuery<Standings['policy']>('/api/overtime/policy');
  const { run, busy } = useAction();
  const [calling, setCalling] = useState<Row | null>(null);
  const pos = (p: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && p.nameFr ? p.nameFr : p.name);

  async function record(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!calling) return;
    const f = new FormData(e.currentTarget);
    const ok = await run('call', () => api('/api/overtime/entries', { method: 'POST', body: { userId: calling.userId, positionId, kind: f.get('kind'), hours: String(f.get('hours')), occurredAt: new Date(String(f.get('at'))).toISOString(), note: f.get('note') || null } }), t('overtime.recorded'));
    if (ok !== undefined) {
      setCalling(null);
      await data.reload();
    }
  }
  async function savePolicy(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run('policy', () => api('/api/overtime/policy', { method: 'PUT', body: { countRefusals: f.get('refusals') === 'on', clause: String(f.get('clause') || '') || null, periodStartMonth: Number(f.get('month')) } }), t('overtime.policySaved'));
    await Promise.all([policy.reload(), data.reload()]);
  }
  const months = Array.from({ length: 12 }, (_, i) => dateFormat(lng, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 1))));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('overtime.title')}
        description={t('overtime.description')}
        actions={
          <Field label={t('overtime.position')}>
            {(p) => (
              <Select {...p} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
                {positions.data?.map((x) => <option key={x.id} value={x.id}>{pos(x)}</option>)}
              </Select>
            )}
          </Field>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title={t('overtime.order')} description={data.data ? t('overtime.orderHelp', { date: formatDate(`${data.data.periodFrom}T12:00:00`, lng, 'dated') }) : undefined} />
          <CardBody className="overflow-x-auto pt-2">
            {!data.data ? (
              <Skeleton className="h-48" />
            ) : (
              <table className="w-full min-w-[34rem] text-left text-small">
                <thead className="text-label uppercase text-muted"><tr><th className="py-2">#</th><th>{t('overtime.person')}</th><th className="text-right">{t('overtime.charged')}</th><th className="text-right">{t('overtime.refusals')}</th><th>{t('overtime.seniority')}</th><th /></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.data.rows.map((r, i) => (
                    <tr key={r.userId}>
                      <td className="py-2.5">{i === 0 ? <StatusPill tone="ok">{t('overtime.next')}</StatusPill> : i + 1}</td>
                      <td className="font-semibold">{r.name}</td>
                      <td className="text-right tabular-nums">{r.chargedHours.toFixed(2)} h</td>
                      <td className="text-right tabular-nums">{r.refusals}</td>
                      <td>{r.seniorityDate ? formatDate(`${r.seniorityDate}T12:00:00`, lng, 'dated') : '—'}</td>
                      <td className="text-right"><Button size="sm" variant="ghost" icon={<PhoneCall className="h-4 w-4" aria-hidden="true" />} onClick={() => setCalling(r)}>{t('overtime.call')}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('overtime.policy')} description={t('overtime.policyHelp')} />
          <CardBody className="pt-2">
            {policy.data ? (
              <form key={JSON.stringify(policy.data)} className="grid gap-4" onSubmit={(e) => void savePolicy(e)}>
                <Field label={t('overtime.clause')} hint={t('overtime.clauseHint')}>{(p) => <Input {...p} name="clause" maxLength={200} defaultValue={policy.data!.clause ?? ''} placeholder="Article 12.3" />}</Field>
                <Field label={t('overtime.periodStart')}>{(p) => <Select {...p} name="month" defaultValue={policy.data!.periodStartMonth}>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>}</Field>
                <label className="flex items-start gap-2 text-small"><input type="checkbox" name="refusals" defaultChecked={policy.data.countRefusals} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />{t('overtime.countRefusals')}</label>
                <Button type="submit" loading={busy === 'policy'} className="justify-self-start">{t('common.save')}</Button>
              </form>
            ) : <Skeleton className="h-40" />}
            <p className="mt-4 flex gap-2 text-caption text-muted"><Scale className="h-4 w-4 shrink-0" aria-hidden="true" />{t('overtime.note')}</p>
          </CardBody>
        </Card>
      </div>
      <Dialog open={!!calling} onClose={() => setCalling(null)} title={t('overtime.callTitle', { name: calling?.name ?? '' })} description={t('overtime.callHelp')} closeLabel={t('common.close')}>
        <form className="grid gap-4" onSubmit={(e) => void record(e)}>
          <Field label={t('overtime.outcome')}>{(p) => <Select {...p} name="kind" defaultValue="REFUSED"><option value="ACCEPTED">{t('overtime.kind.ACCEPTED')}</option><option value="REFUSED">{t('overtime.kind.REFUSED')}</option><option value="NO_ANSWER">{t('overtime.kind.NO_ANSWER')}</option></Select>}</Field>
          <div className="grid gap-4">
            <Field label={t('overtime.hours')}>{(p) => <Input {...p} name="hours" inputMode="decimal" required pattern={'\\d{1,3}(\\.\\d{1,2})?'} defaultValue="4" />}</Field>
            <Field label={t('overtime.when')}>{(p) => <Input {...p} name="at" type="datetime-local" required defaultValue={localInput()} />}</Field>
          </div>
          <Field label={t('overtime.note2')}>{(p) => <Input {...p} name="note" maxLength={300} placeholder={t('overtime.notePlaceholder')} />}</Field>
          <Button type="submit" loading={busy === 'call'}>{t('overtime.save')}</Button>
        </form>
      </Dialog>
    </div>
  );
}
