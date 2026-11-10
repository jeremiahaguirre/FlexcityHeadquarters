'use client';

import { Baby, CheckCircle2, ChevronRight, ClipboardList, Lock, Plus, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { type ChecklistItem, OWNERS, type OnboardingItem, itemName, stateTone } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { useAction, useQuery } from '@/lib/useQuery';
import { DepartmentTabs } from '@/components/DepartmentTabs';
import { departmentParam, useDepartmentTab } from '@/lib/departments';

interface Person { id: string; name: string; roles: string[]; hr: { total: number; done: number }; supervisor: { total: number; done: number }; employee: { total: number; done: number }; outstanding: number; expiring: number; blocked: boolean }

function Page() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [tab, setTab] = useState<'people' | 'requirements'>('people');
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(params.get('user'));
  return (
    <div className="grid gap-6">
      <PageHeader title={t('onboarding.title')} description={t('onboarding.description')} />
      {can('onboarding.configure') ? (
        <Segmented label={t('onboarding.title')} value={tab} onChange={setTab} options={[{ value: 'people', label: t('onboarding.people') }, { value: 'requirements', label: t('onboarding.requirements') }]} />
      ) : null}
      {tab === 'people' ? <People onOpen={setOpen} /> : <Requirements />}
      {open ? <Checklist userId={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <Page />
    </Suspense>
  );
}

function Progress({ label, p }: { label: string; p: { total: number; done: number } }) {
  if (!p.total) return null;
  const pct = Math.round((p.done / p.total) * 100);
  return (
    <div className="min-w-[7rem]">
      <p className="flex justify-between text-caption text-muted"><span>{label}</span><span className="tabular-nums">{p.done}/{p.total}</span></p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface"><div className={`fh-bar h-full rounded-full ${pct === 100 ? 'bg-ok' : 'bg-brand'}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function People({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const [department, setDepartment] = useDepartmentTab();
  const list = useQuery<Person[]>(`/api/onboarding/people${departmentParam(department, true)}`);
  const [all, setAll] = useState(false);
  if (!list.data) return <Skeleton className="h-64" />;
  const rows = list.data.filter((p) => all || p.outstanding || p.expiring);
  return (
    <div className="grid gap-4">
      <DepartmentTabs value={department} onChange={setDepartment} />
      <Segmented label={t('onboarding.people')} value={all ? 'all' : 'open'} onChange={(v) => setAll(v === 'all')} options={[{ value: 'open', label: t('onboarding.needsAction', { count: list.data.filter((p) => p.outstanding || p.expiring).length }) }, { value: 'all', label: t('onboarding.everyone') }]} />
      {!rows.length ? (
        <EmptyState icon={CheckCircle2} title={t('onboarding.allDone')}>{t('onboarding.allDoneHelp')}</EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p.id)} className="flex w-full flex-wrap items-center gap-4 px-4 py-4 text-left hover:bg-surface sm:px-6">
                  <Avatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body-strong">{p.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.blocked ? <StatusPill tone="danger" icon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}>{t('onboarding.cantSchedule')}</StatusPill> : null}
                      {p.outstanding ? <StatusPill tone="warn">{t('onboarding.outstanding', { count: p.outstanding })}</StatusPill> : null}
                      {p.expiring ? <StatusPill tone="neutral">{t('onboarding.expiringCount', { count: p.expiring })}</StatusPill> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <Progress label={t('onboarding.owner.HR')} p={p.hr} />
                    <Progress label={t('onboarding.owner.SUPERVISOR')} p={p.supervisor} />
                    <Progress label={t('onboarding.owner.EMPLOYEE')} p={p.employee} />
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Checklist({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const data = useQuery<{ user: { name: string }; items: Array<ChecklistItem & { canComplete: boolean; canWaive: boolean }> }>(`/api/onboarding/people/${userId}`);
  const { run, busy } = useAction();
  const [acting, setActing] = useState<{ item: ChecklistItem; action: 'complete' | 'waive' } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acting) return;
    const f = new FormData(e.currentTarget);
    const ok = await run('rec', () => api(`/api/onboarding/people/${userId}/items/${acting.item.id}`, { method: 'POST', body: { action: acting.action, completedOn: f.get('date'), note: f.get('note') || null, reason: f.get('reason') || null } }), t('onboarding.saved'));
    if (ok !== undefined) {
      setActing(null);
      await data.reload();
    }
  }

  return (
    <Dialog open onClose={onClose} title={data.data?.user.name ?? ''} description={t('onboarding.checklistHelp')} closeLabel={t('common.close')}>
      {!data.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-5">
          {OWNERS.map((o) => {
            const items = data.data!.items.filter((i) => i.owner === o);
            if (!items.length) return null;
            return (
              <section key={o}>
                <h3 className="mb-2 text-label uppercase text-muted">{t(`onboarding.owner.${o}`)}</h3>
                <ul className="grid gap-2">
                  {items.map((i) => (
                    <li key={i.id} className="rounded-xl border border-line px-3 py-2.5 text-small">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-semibold">{i.blocksScheduling ? <Lock className="h-3.5 w-3.5 text-muted" aria-label={t('onboarding.blocks')} /> : null}{itemName(i, lng)}</p>
                          <p className="text-caption text-muted">
                            {t(`onboarding.kind.${i.kind}`)}
                            {i.completedOn ? ` · ${t(i.state === 'WAIVED' ? 'onboarding.waivedOn' : 'onboarding.doneOn', { date: formatDate(`${i.completedOn}T12:00:00`, lng, 'dated') })}` : ''}
                            {i.expiresOn ? ` · ${t('onboarding.expires', { date: formatDate(`${i.expiresOn}T12:00:00`, lng, 'dated') })}` : ''}
                          </p>
                          {i.note || i.waivedReason ? <p className="text-caption text-muted">{i.waivedReason ?? i.note}</p> : null}
                        </div>
                        <StatusPill tone={stateTone(i.state)}>{t(`onboarding.state.${i.state}`)}</StatusPill>
                      </div>
                      {(i.state === 'PENDING' || i.state === 'EXPIRED' || i.state === 'EXPIRING') && (i.canComplete || i.canWaive) ? (
                        <div className="mt-2 flex gap-3">
                          {i.canComplete ? <button type="button" className="text-caption font-semibold text-brand-text hover:underline" onClick={() => setActing({ item: i, action: 'complete' })}>{i.state === 'PENDING' ? t('onboarding.markDone') : t('onboarding.renew')}</button> : null}
                          {i.canWaive ? <button type="button" className="text-caption font-semibold text-muted hover:underline" onClick={() => setActing({ item: i, action: 'waive' })}>{t('onboarding.waive')}</button> : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="flex gap-2 text-caption text-muted"><ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />{t('onboarding.privacy')}</p>
        </div>
      )}
      {acting ? (
        <Dialog open onClose={() => setActing(null)} title={itemName(acting.item, lng)} description={acting.action === 'waive' ? t('onboarding.waiveHelp') : acting.item.kind === 'CHECK' ? t('onboarding.checkHelp') : undefined} closeLabel={t('common.close')}>
          <form className="grid gap-4" onSubmit={(e) => void save(e)}>
            <Field label={acting.item.kind === 'CHECK' ? t('onboarding.dateSeen') : t('onboarding.dateDone')}>{(p) => <Input {...p} name="date" type="date" required max={today} defaultValue={today} />}</Field>
            {acting.action === 'waive' ? (
              <Field label={t('onboarding.reason')}>{(p) => <Input {...p} name="reason" required maxLength={300} />}</Field>
            ) : (
              <Field label={t('onboarding.note')} hint={t('onboarding.noteHint')}>{(p) => <Input {...p} name="note" maxLength={300} />}</Field>
            )}
            <Button type="submit" loading={busy === 'rec'}>{acting.action === 'waive' ? t('onboarding.waive') : t('onboarding.markDone')}</Button>
          </form>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-brand' : 'bg-line'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[1.125rem]' : 'left-0.5'}`} />
    </button>
  );
}

/** Which positions need which items: one switch per position and item, plus the minors set. */
function Requirements() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const data = useQuery<{ items: OnboardingItem[]; positions: Array<{ id: string; name: string; nameFr: string | null }>; minorsSet: string[] }>('/api/onboarding/items?all=1');
  const { run } = useAction();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<OnboardingItem | 'new' | null>(null);
  const [local, setLocal] = useState<typeof data.data>(null);
  useEffect(() => setLocal(data.data ?? null), [data.data]);
  const d = local;
  if (!d) return <Skeleton className="h-96" />;
  const pos = (p: { name: string; nameFr: string | null }) => (lng === 'fr-CA' && p.nameFr ? p.nameFr : p.name);
  const minorIds = d.items.filter((i) => i.key && d.minorsSet.includes(i.key)).map((i) => i.id);

  async function toggle(positionId: string, itemIds: string[], required: boolean) {
    const k = `${positionId}${itemIds.join()}`;
    setBusy(k);
    const ok = await run(k, () => api<{ ok: boolean; affected: number }>(`/api/onboarding/positions/${positionId}`, { method: 'PUT', body: { itemIds, required } }));
    if (ok?.affected) toast(t('onboarding.affected', { count: ok.affected }), 'warn');
    if (ok !== undefined) setLocal((cur) => cur && { ...cur, items: cur.items.map((i) => (itemIds.includes(i.id) ? { ...i, positionIds: required ? [...new Set([...i.positionIds, positionId])] : i.positionIds.filter((x) => x !== positionId) } : i)) });
    setBusy(null);
  }
  async function saveItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get('name')),
      description: String(f.get('description') || '') || null,
      owner: f.get('owner'),
      kind: f.get('kind'),
      allStaff: f.get('allStaff') === 'on',
      blocksScheduling: f.get('blocks') === 'on',
      validityMonths: f.get('validity') ? Number(f.get('validity')) : null,
      policyText: String(f.get('policy') || '') || null,
    };
    const cur = editing === 'new' ? null : editing;
    const ok = await run('item', () => (cur ? api(`/api/onboarding/items/${cur.id}`, { method: 'PATCH', body }) : api('/api/onboarding/items', { method: 'POST', body })), t('onboarding.saved'));
    if (ok !== undefined) {
      setEditing(null);
      await data.reload();
    }
  }
  const cur = editing === 'new' ? null : editing;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('onboarding.minorsTitle')} description={t('onboarding.minorsHelp')} />
        <CardBody className="pt-1">
          <ul className="divide-y divide-line">
            {d.positions.map((p) => {
              const on = minorIds.length > 0 && minorIds.every((id) => d.items.find((i) => i.id === id)!.positionIds.includes(p.id));
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-small">
                  <span className="flex items-center gap-2 font-semibold"><Baby className="h-4 w-4 text-muted" aria-hidden="true" />{pos(p)}</span>
                  <Switch on={on} disabled={busy !== null} label={t('onboarding.minorsSwitch', { position: pos(p) })} onChange={() => void toggle(p.id, minorIds, !on)} />
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t('onboarding.byPosition')}
          description={t('onboarding.byPositionHelp')}
          action={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setEditing('new')}>{t('onboarding.addItem')}</Button>}
        />
        <CardBody className="overflow-x-auto pt-1">
          <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-small">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-panel py-2 pr-4 text-left" />
                <th className="px-2 py-2 text-center text-caption font-semibold">{t('onboarding.everyoneCol')}</th>
                {d.positions.map((p) => <th key={p.id} className="min-w-[6rem] px-2 py-2 text-center text-caption font-semibold">{pos(p)}</th>)}
              </tr>
            </thead>
            <tbody>
              {OWNERS.flatMap((o) => [
                <tr key={o}><th colSpan={d.positions.length + 2} className="border-t border-line bg-surface/60 px-2 py-1.5 text-left text-label uppercase text-muted">{t(`onboarding.owner.${o}`)}</th></tr>,
                ...d.items.filter((i) => i.owner === o).map((i) => (
                  <tr key={i.id} className={i.archivedAt ? 'opacity-50' : ''}>
                    <th scope="row" className="sticky left-0 z-10 border-t border-line bg-panel py-2 pr-4 text-left font-normal">
                      <button type="button" className="text-left hover:underline" onClick={() => setEditing(i)}>
                        <span className="flex items-center gap-1.5 font-semibold">{i.blocksScheduling ? <Lock className="h-3.5 w-3.5 text-muted" aria-label={t('onboarding.blocks')} /> : null}{itemName(i, lng)}</span>
                        <span className="text-caption text-muted">{t(`onboarding.kind.${i.kind}`)}{i.validityMonths ? ` · ${t('onboarding.renewEvery', { count: i.validityMonths })}` : ''}</span>
                      </button>
                    </th>
                    <td className="border-t border-line px-2 py-2 text-center">{i.allStaff ? <CheckCircle2 className="mx-auto h-5 w-5 text-ok" aria-label={t('onboarding.everyoneCol')} /> : null}</td>
                    {d.positions.map((p) => {
                      const on = i.allStaff || i.positionIds.includes(p.id);
                      return (
                        <td key={p.id} className="border-t border-line px-2 py-2 text-center">
                          <div className="flex justify-center">
                            <Switch on={on} disabled={i.allStaff || busy !== null || !!i.archivedAt} label={t('onboarding.itemSwitch', { item: itemName(i, lng), position: pos(p) })} onChange={() => void toggle(p.id, [i.id], !on)} />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={cur ? itemName(cur, lng) : t('onboarding.addItem')} closeLabel={t('common.close')}>
        <form key={cur?.id ?? 'new'} className="grid gap-4" onSubmit={(e) => void saveItem(e)}>
          <Field label={t('onboarding.itemName')}>{(p) => <Input {...p} name="name" required minLength={2} maxLength={120} defaultValue={cur?.name ?? ''} />}</Field>
          <Field label={t('onboarding.itemDescription')}>{(p) => <Input {...p} name="description" maxLength={500} defaultValue={cur?.description ?? ''} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('onboarding.whoCompletes')}>{(p) => <Select {...p} name="owner" defaultValue={cur?.owner ?? 'HR'}>{OWNERS.map((o) => <option key={o} value={o}>{t(`onboarding.owner.${o}`)}</option>)}</Select>}</Field>
            <Field label={t('onboarding.type')}>{(p) => <Select {...p} name="kind" defaultValue={cur?.kind ?? 'TRAINING'}>{['CHECK', 'TRAINING', 'ACKNOWLEDGEMENT', 'DOCUMENT', 'TASK'].map((k) => <option key={k} value={k}>{t(`onboarding.kind.${k}`)}</option>)}</Select>}</Field>
            <Field label={t('onboarding.validity')} hint={t('onboarding.validityHint')}>{(p) => <Input {...p} name="validity" type="number" min={1} max={120} defaultValue={cur?.validityMonths ?? ''} />}</Field>
          </div>
          <Field label={t('onboarding.policyText')} hint={t('onboarding.policyTextHint')}>{(p) => <Textarea {...p} name="policy" maxLength={8000} defaultValue={cur?.policyText ?? ''} />}</Field>
          <label className="flex items-center gap-2 text-small font-semibold"><input type="checkbox" name="allStaff" defaultChecked={cur?.allStaff ?? false} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('onboarding.allStaffLabel')}</label>
          <label className="flex items-center gap-2 text-small font-semibold"><input type="checkbox" name="blocks" defaultChecked={cur?.blocksScheduling ?? false} className="h-5 w-5 accent-[rgb(var(--brand))]" />{t('onboarding.blocksLabel')}</label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={busy === 'item'}>{t('common.save')}</Button>
            {cur ? <Button type="button" variant="ghost" onClick={() => void run('arch', () => api(`/api/onboarding/items/${cur.id}`, { method: 'PATCH', body: { archived: !cur.archivedAt } })).then(() => { setEditing(null); void data.reload(); })}>{cur.archivedAt ? t('onboarding.restore') : t('onboarding.retire')}</Button> : null}
          </div>
        </form>
      </Dialog>
      <p className="flex gap-2 text-caption text-muted"><ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />{t('onboarding.legend')}</p>
    </div>
  );
}
