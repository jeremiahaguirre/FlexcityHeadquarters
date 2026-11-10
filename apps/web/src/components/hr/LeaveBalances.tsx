'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { api } from '@/lib/api';
import { formatHours } from '@/lib/format';
import { LEAVE_TYPES, type LeaveBalance, type LeaveType, type PersonBalances } from '@/lib/hr';
import { useAction, useQuery } from '@/lib/useQuery';

/** One person's balances as small tiles: remaining of entitled, with used and pending. */
export function BalanceTiles({ types }: { types: LeaveBalance[] }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const shown = types.filter((b) => b.entitled != null || b.used || b.pending);
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {shown.map((b) => {
        const total = (b.entitled ?? 0) + b.carryover;
        const pct = total ? Math.min(100, Math.round(((b.used + b.pending) / total) * 100)) : 0;
        return (
          <li key={b.type} className="rounded-2xl border border-line p-3">
            <p className="text-caption font-semibold uppercase tracking-wide text-muted">{t(`timeOff.types.${b.type}`)}</p>
            <p className="text-heading tabular-nums">{b.remaining != null ? t('leave.hoursLeft', { hours: formatHours(b.remaining, lng) }) : t('leave.hoursUsed', { hours: formatHours(b.used, lng) })}</p>
            {b.entitled != null ? (
              <>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface" aria-hidden="true"><div className="fh-bar h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></div>
                <p className="mt-1 text-caption text-muted">{t('leave.breakdown', { entitled: formatHours(b.entitled, lng), carry: formatHours(b.carryover, lng), used: formatHours(b.used, lng), pending: formatHours(b.pending, lng) })}</p>
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** On the time-off page: what I have left this year. Hidden where the HR suite is off. */
export function MyLeaveBalances() {
  const { t } = useTranslation();
  const data = useQuery<{ year: number; types: LeaveBalance[] }>('/api/me/leave');
  if (data.error || !data.data?.types.length) return null;
  return (
    <Card className="mb-3">
      <CardHeader title={t('leave.myTitle', { year: data.data.year })} description={t('leave.myHelp')} />
      <CardBody className="pt-2"><BalanceTiles types={data.data.types} /></CardBody>
    </Card>
  );
}

/** HR / supervisors: everyone's balances, and HR sets entitlements. */
export function LeavePanel({ canEdit }: { canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [year, setYear] = useState(new Date().getFullYear());
  const data = useQuery<{ year: number; people: PersonBalances[] }>(`/api/leave/balances?year=${year}`);
  const [editing, setEditing] = useState<{ person: PersonBalances; type: LeaveType } | null>(null);
  const { run, busy } = useAction();
  const [q, setQ] = useState('');

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const f = new FormData(e.currentTarget);
    const r = await run('ent', () => api(`/api/users/${editing.person.userId}/leave`, { method: 'PUT', body: { year, type: String(f.get('type')), hours: Number(f.get('hours')), carryover: Number(f.get('carryover') || 0), note: String(f.get('note') || '') || null } }), t('leave.saved'));
    if (r !== undefined) {
      setEditing(null);
      await data.reload();
    }
  }
  const people = (data.data?.people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const cell = (b: LeaveBalance | undefined) => (b ? (b.remaining != null ? formatHours(b.remaining, lng) : '—') : '—');
  return (
    <Card>
      <CardHeader
        title={t('leave.title')}
        description={t('leave.help')}
        action={
          <div className="flex flex-wrap gap-2">
            <Input aria-label={t('hr.searchName')} placeholder={t('hr.searchName')} value={q} onChange={(e) => setQ(e.target.value)} className="w-40" />
            <Select aria-label={t('leave.year')} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i).map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
        }
      />
      <CardBody className="pt-2">
        {!data.data ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-small">
              <thead>
                <tr className="text-left text-caption text-muted">
                  <th className="py-2 pr-3 font-semibold">{t('leave.person')}</th>
                  {(['VACATION', 'SICK'] as const).map((k) => <th key={k} className="py-2 pr-3 text-right font-semibold">{t('leave.remainingOf', { type: t(`timeOff.types.${k}`) })}</th>)}
                  <th className="py-2 pr-3 text-right font-semibold">{t('leave.usedAll')}</th>
                  {canEdit ? <th className="py-2" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {people.map((p) => {
                  const by = (k: LeaveType) => p.types.find((b) => b.type === k);
                  const low = (by('VACATION')?.remaining ?? 1) < 0;
                  return (
                    <tr key={p.userId}>
                      <td className="py-2 pr-3 font-semibold">{p.name}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${low ? 'text-danger' : ''}`}>{cell(by('VACATION'))}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{cell(by('SICK'))}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatHours(p.types.reduce((a, b) => a + b.used, 0), lng)}</td>
                      {canEdit ? <td className="py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing({ person: p, type: 'VACATION' })}>{t('leave.set')}</Button></td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? t('leave.setFor', { name: editing.person.name, year }) : ''}>
        {editing ? (
          <form onSubmit={(e) => void save(e)} className="grid gap-3">
            <Field label={t('leave.type')}>{(p) => <Select {...p} name="type" defaultValue={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as LeaveType })}>{LEAVE_TYPES.map((k) => <option key={k} value={k}>{t(`timeOff.types.${k}`)}</option>)}</Select>}</Field>
            {(() => {
              const b = editing.person.types.find((x) => x.type === editing.type);
              return (
                <div key={editing.type} className="grid grid-cols-2 gap-3">
                  <Field label={t('leave.hours')} hint={b && !b.set && b.entitled != null ? t('leave.defaultHint', { hours: b.entitled }) : undefined}>{(p) => <Input {...p} name="hours" type="number" min={0} step="0.25" required defaultValue={b?.set ? (b.entitled ?? '') : (b?.entitled ?? '')} />}</Field>
                  <Field label={t('leave.carryover')}>{(p) => <Input {...p} name="carryover" type="number" min={0} step="0.25" defaultValue={b?.carryover || ''} />}</Field>
                </div>
              );
            })()}
            <Field label={t('leave.note')}>{(p) => <Input {...p} name="note" maxLength={200} />}</Field>
            <div><Button type="submit" loading={busy === 'ent'}>{t('common.save')}</Button></div>
          </form>
        ) : null}
      </Dialog>
    </Card>
  );
}
