'use client';

import { Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import { api } from '@/lib/api';
import { type ApprovalStep, type LeaveKind, leaveLabel } from '@/lib/leaveTypes';
import { useAction, useQuery } from '@/lib/useQuery';

type Draft = Omit<LeaveKind, 'id' | 'code' | 'system'>;
const EMPTY: Draft = { name: '', nameFr: '', paid: false, hasBalance: false, yearlyHours: null, carryOverMaxHours: null, protectedLeave: false, approvalChain: [], payCode: null, sortOrder: 100, archived: false };
const CHAINS: Array<{ key: string; chain: ApprovalStep[] }> = [
  { key: 'default', chain: [] },
  { key: 'hr', chain: ['HR'] },
  { key: 'managerHr', chain: ['MANAGER', 'HR'] },
];
const chainKey = (c: ApprovalStep[]) => CHAINS.find((x) => x.chain.join() === c.join())?.key ?? 'default';
const num = (v: string) => (v === '' ? null : Number(v));

/** HR: the kinds of leave people can ask for. The built-in ones keep how they work; the organization adds its own. */
export function LeaveTypesCard() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<{ types: LeaveKind[] }>('/api/leave-types?archived=true');
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<{ kind: LeaveKind | null; draft: Draft } | null>(null);
  if (q.error || !q.data) return null;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const builtIn = !!editing?.kind?.system;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const body = editing.draft;
    const r = await run('save', () => (editing.kind ? api(`/api/settings/leave-types/${editing.kind.id}`, { method: 'PATCH', body }) : api('/api/settings/leave-types', { method: 'POST', body })), t('leaveTypes.saved'));
    if (r !== undefined) {
      setEditing(null);
      await q.reload();
    }
  }
  const check = (label: string, value: boolean, onChange: (v: boolean) => void) => (
    <label className="flex min-h-11 items-center gap-3 text-small text-ink">
      <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={value} disabled={builtIn} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Card>
      <CardHeader
        title={t('leaveTypes.title')}
        description={t('leaveTypes.help')}
        action={
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing({ kind: null, draft: EMPTY })}>
            {t('leaveTypes.add')}
          </Button>
        }
      />
      <CardBody className="pt-2">
        <ul className="divide-y divide-line">
          {q.data.types.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-small">
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {leaveLabel(t, lng, k)}
                  {k.system ? <StatusPill tone="neutral" className="ml-2">{t('leaveTypes.builtIn')}</StatusPill> : null}
                  {k.archived ? <StatusPill tone="inactive" className="ml-2">{t('leaveTypes.archived')}</StatusPill> : null}
                </p>
                <p className="text-caption text-muted">
                  {[k.paid ? t('leaveTypes.paid') : t('leaveTypes.unpaid'), k.hasBalance ? (k.yearlyHours != null ? t('leaveTypes.yearly', { hours: k.yearlyHours }) : t('leaveTypes.balance')) : null, k.protectedLeave ? t('leaveTypes.protected') : null, k.approvalChain.length ? t(`leaveTypes.chains.${chainKey(k.approvalChain)}`) : null, k.payCode ? t('leaveTypes.payCodeShown', { code: k.payCode }) : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button variant="ghost" size="sm" aria-label={t('leaveTypes.edit', { name: leaveLabel(t, lng, k) })} icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing({ kind: k, draft: { name: k.name, nameFr: k.nameFr, paid: k.paid, hasBalance: k.hasBalance, yearlyHours: k.yearlyHours, carryOverMaxHours: k.carryOverMaxHours, protectedLeave: k.protectedLeave, approvalChain: k.approvalChain, payCode: k.payCode, sortOrder: k.sortOrder, archived: k.archived } })} />
            </li>
          ))}
        </ul>
      </CardBody>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.kind ? t('leaveTypes.editTitle') : t('leaveTypes.addTitle')} description={builtIn ? t('leaveTypes.builtInHelp') : undefined} closeLabel={t('common.close')} wide>
        {editing ? (
          <form className="grid gap-4" onSubmit={(e) => void save(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('leaveTypes.name')}>{(p) => <Input {...p} required minLength={2} maxLength={80} value={editing.draft.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
              <Field label={t('leaveTypes.nameFr')}>{(p) => <Input {...p} lang="fr" required minLength={2} maxLength={80} value={editing.draft.nameFr} onChange={(e) => set({ nameFr: e.target.value })} />}</Field>
            </div>
            {check(t('leaveTypes.paidLabel'), editing.draft.paid, (paid) => set({ paid }))}
            {check(t('leaveTypes.balanceLabel'), editing.draft.hasBalance, (hasBalance) => set({ hasBalance }))}
            {editing.draft.hasBalance && !builtIn ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('leaveTypes.yearlyHours')} hint={t('leaveTypes.yearlyHoursHint')}>{(p) => <Input {...p} type="number" min={0} max={2000} step="0.25" value={editing.draft.yearlyHours ?? ''} onChange={(e) => set({ yearlyHours: num(e.target.value) })} />}</Field>
                <Field label={t('leaveTypes.carryOver')} hint={t('leaveTypes.carryOverHint')}>{(p) => <Input {...p} type="number" min={0} max={2000} step="0.25" value={editing.draft.carryOverMaxHours ?? ''} onChange={(e) => set({ carryOverMaxHours: num(e.target.value) })} />}</Field>
              </div>
            ) : null}
            {check(t('leaveTypes.protectedLabel'), editing.draft.protectedLeave, (protectedLeave) => set({ protectedLeave }))}
            <Field label={t('leaveTypes.chainLabel')}>
              {(p) => (
                <Select {...p} disabled={builtIn} value={chainKey(editing.draft.approvalChain)} onChange={(e) => set({ approvalChain: CHAINS.find((x) => x.key === e.target.value)!.chain })}>
                  {CHAINS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {t(`leaveTypes.chains.${c.key}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('leaveTypes.payCode')} hint={t('leaveTypes.payCodeHint')}>{(p) => <Input {...p} maxLength={30} value={editing.draft.payCode ?? ''} onChange={(e) => set({ payCode: e.target.value.trim() || null })} />}</Field>
            {editing.kind && !builtIn ? check(t('leaveTypes.archiveLabel'), editing.draft.archived, (archived) => set({ archived })) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === 'save'}>
                {t('common.save')}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </Card>
  );
}
