'use client';

import { ChevronLeft, ChevronRight, Handshake, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Timeline } from '@/components/platform/trust/charts';
import { useParam, usePeople, useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, Facts, TrustTabs, errorText, useDate } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { papi, usePlatformQuery, type CitySummary } from '@/lib/platform';
import { daysLeft } from '@/lib/trust';

interface Commitment { id: string; tenantId: string | null; customer: string; kind: string; title: string; detail: string | null; source: string | null; dueAt: string | null; recurrence: string; ownerId: string | null; owner: string | null; status: 'OPEN' | 'MET' | 'WAIVED'; controlKeys: string[]; fulfilments: Array<{ id: string; dueAt: string | null; metAt: string; note: string | null }> }

const stateOf = (c: Commitment): { key: string; tone: Tone } => {
  if (c.status !== 'OPEN') return { key: c.status, tone: c.status === 'MET' ? 'ok' : 'neutral' };
  if (!c.dueAt) return { key: 'OPEN', tone: 'brand' };
  const left = daysLeft(c.dueAt);
  return left < 0 ? { key: 'OVERDUE', tone: 'danger' } : left <= 30 ? { key: 'SOON', tone: 'warn' } : { key: 'OPEN', tone: 'brand' };
};

/** Trust: every promise made to a customer, with an owner, a due date and reminders before it is due. */
export default function CommitmentsPage() {
  const { t } = useTranslation();
  const date = useDate();
  const { canManage } = useTrustAccess();
  const data = usePlatformQuery<{ kinds: string[]; commitments: Commitment[] }>('/trust/commitments');
  const cities = usePlatformQuery<CitySummary[]>('/tenants').data ?? [];
  const id = useParam('id');
  const [open, setOpen] = useState<Commitment | 'new' | null>(null);
  const [view, setView] = useState<'table' | 'calendar'>('table');
  useEffect(() => {
    if (id && data.data) setOpen(data.data.commitments.find((c) => c.id === id) ?? null);
  }, [id, data.data]);
  const list = data.data?.commitments ?? [];
  const upcoming = list.filter((c) => c.status === 'OPEN' && c.dueAt && daysLeft(c.dueAt) <= 90).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!)) as Array<Commitment & { dueAt: string }>;
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.commitments')} description={t('trust.commitments.description')}
        actions={canManage ? <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen('new')}>{t('trust.commitments.add')}</Button> : undefined} />
      <TrustTabs />
      {!data.data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-4">
          <Card>
            <CardHeader title={t('trust.timeline.title')} description={t('trust.timeline.help')} />
            <CardBody><Timeline items={upcoming} onOpen={(cid) => setOpen(list.find((c) => c.id === cid) ?? null)} /></CardBody>
          </Card>
          <Segmented label={t('trust.commitments.view')} value={view} onChange={setView} options={[{ value: 'table', label: t('trust.commitments.table') }, { value: 'calendar', label: t('trust.commitments.calendar') }]} />
          {view === 'calendar' ? <Calendar items={list.filter((c) => c.status === 'OPEN' && c.dueAt) as Array<Commitment & { dueAt: string }>} onOpen={setOpen} /> : (
            <DataTable<Commitment>
              label={t('trust.section.commitments')}
              rows={list}
              rowKey={(c) => c.id}
              onOpen={setOpen}
              emptyIcon={Handshake}
              emptyTitle={t('trust.commitments.none')}
              initialSort={{ key: 'due', dir: 'asc' }}
              filters={[
                { key: 'state', label: t('trust.table.status'), options: (['OVERDUE', 'SOON', 'OPEN', 'MET', 'WAIVED'] as const).map((s) => ({ value: s, label: t(`trust.commitState.${s}`) })), value: (c) => stateOf(c).key },
                { key: 'kind', label: t('trust.commitments.kind'), options: (data.data.kinds ?? []).map((k) => ({ value: k, label: t(`trust.kind.${k}`) })), value: (c) => c.kind },
                { key: 'customer', label: t('trust.commitments.customer'), options: [...new Set(list.map((c) => c.customer))].sort().map((c) => ({ value: c, label: c })), value: (c) => c.customer },
              ]}
              columns={[
                { key: 'title', label: t('trust.table.title'), value: (c) => c.title },
                { key: 'customer', label: t('trust.commitments.customer'), value: (c) => c.customer },
                { key: 'kind', label: t('trust.commitments.kind'), value: (c) => t(`trust.kind.${c.kind}`), wide: true },
                { key: 'due', label: t('trust.table.due'), value: (c) => (c.status === 'OPEN' ? c.dueAt ?? '' : ''), render: (c) => <span>{date(c.dueAt)}{c.recurrence !== 'NONE' ? <span className="text-muted"> · {t(`trust.recurrence.${c.recurrence}`)}</span> : null}</span> },
                { key: 'owner', label: t('trust.table.owner'), value: (c) => c.owner ?? '', render: (c) => c.owner ?? <span className="text-muted">{t('trust.unassigned')}</span>, wide: true },
                { key: 'state', label: t('trust.table.status'), value: (c) => stateOf(c).key, render: (c) => <StatusPill tone={stateOf(c).tone}>{t(`trust.commitState.${stateOf(c).key}`)}</StatusPill> },
              ]}
            />
          )}
        </div>
      )}
      <CommitmentDrawer commitment={open} kinds={data.data?.kinds ?? []} cities={cities} onClose={() => setOpen(null)} onSaved={() => void data.reload()} canManage={canManage} />
    </div>
  );
}

/** A month grid; days with commitments show them, overdue in red and the next 7 days in amber. */
function Calendar({ items, onOpen }: { items: Array<Commitment & { dueAt: string }>; onOpen: (c: Commitment) => void }) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
  });
  const days = useMemo(() => {
    const first = (month.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), i + 1)))] as Array<Date | null>;
  }, [month]);
  const on = (d: Date) => items.filter((c) => c.dueAt.slice(0, 10) === d.toISOString().slice(0, 10));
  const shift = (n: number) => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1)));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' }));
  const monthItems = items.filter((c) => c.dueAt.slice(0, 7) === month.toISOString().slice(0, 7));
  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <Button variant="ghost" size="sm" aria-label={t('trust.commitments.prevMonth')} onClick={() => shift(-1)}><ChevronLeft className="h-5 w-5" aria-hidden="true" /></Button>
          <h2 className="text-subheading capitalize" aria-live="polite">{month.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
          <Button variant="ghost" size="sm" aria-label={t('trust.commitments.nextMonth')} onClick={() => shift(1)}><ChevronRight className="h-5 w-5" aria-hidden="true" /></Button>
        </div>
        <div className="hidden grid-cols-7 gap-1 sm:grid" aria-hidden="true">
          {weekdays.map((w) => <span key={w} className="px-1 text-caption text-muted">{w}</span>)}
          {days.map((d, i) => (
            <div key={i} className={cn('min-h-[5rem] rounded-lg p-1 text-caption', d ? 'bg-surface/50' : '')}>
              {d ? <span className="text-muted">{d.getUTCDate()}</span> : null}
              {d ? on(d).map((c) => <button key={c.id} type="button" tabIndex={-1} onClick={() => onOpen(c)} className={cn('mt-0.5 block w-full truncate rounded px-1 text-left font-semibold', daysLeft(c.dueAt) < 0 ? 'bg-danger-bg text-danger' : daysLeft(c.dueAt) <= 7 ? 'bg-warn-bg text-warn' : 'bg-brand/10 text-brand-text')}>{c.customer}</button>) : null}
            </div>
          ))}
        </div>
        <ul className="mt-3 grid gap-1 text-small sm:mt-4">
          {monthItems.length ? monthItems.map((c) => (
            <li key={c.id}><button type="button" onClick={() => onOpen(c)} className="flex min-h-[44px] w-full items-center gap-3 text-left hover:underline"><time className="w-16 shrink-0 tabular-nums text-muted" dateTime={c.dueAt}>{new Date(c.dueAt).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</time><span className="min-w-0 truncate"><span className="font-semibold">{c.customer}</span> · {c.title}</span></button></li>
          )) : <li className="text-muted">{t('trust.commitments.noneThisMonth')}</li>}
        </ul>
      </CardBody>
    </Card>
  );
}

const blank = { tenantId: '', customer: '', kind: 'SECURITY_CLAUSE', title: '', detail: '', source: '', dueAt: '', recurrence: 'NONE', ownerId: '', status: 'OPEN' };

function CommitmentDrawer({ commitment, kinds, cities, onClose, onSaved, canManage }: { commitment: Commitment | 'new' | null; kinds: string[]; cities: CitySummary[]; onClose: () => void; onSaved: () => void; canManage: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const date = useDate();
  const people = usePeople();
  const [f, setF] = useState(blank);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const c = commitment && commitment !== 'new' ? commitment : null;
  useEffect(() => {
    setNote('');
    if (commitment === 'new') setF(blank);
    else if (commitment) setF({ tenantId: commitment.tenantId ?? '', customer: commitment.customer, kind: commitment.kind, title: commitment.title, detail: commitment.detail ?? '', source: commitment.source ?? '', dueAt: commitment.dueAt?.slice(0, 10) ?? '', recurrence: commitment.recurrence, ownerId: commitment.ownerId ?? '', status: commitment.status });
  }, [commitment]);
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, tenantId: f.tenantId || null, detail: f.detail || null, source: f.source || null, dueAt: f.dueAt || null, ownerId: f.ownerId || null };
      await papi(c ? `/trust/commitments/${c.id}` : '/trust/commitments', { method: c ? 'PATCH' : 'POST', body });
      toast(t('trust.saved'), 'ok');
      onSaved();
      onClose();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  }
  async function fulfil() {
    if (!c) return;
    setBusy(true);
    try {
      await papi(`/trust/commitments/${c.id}/fulfil`, { method: 'POST', body: { note: note || null } });
      toast(c.recurrence !== 'NONE' ? t('trust.commitments.metNext') : t('trust.commitments.met'), 'ok');
      onSaved();
      onClose();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer open={!!commitment} onClose={onClose} title={c ? c.title : t('trust.commitments.add')} subtitle={c ? <StatusPill tone={stateOf(c).tone}>{t(`trust.commitState.${stateOf(c).key}`)}</StatusPill> : null}
      footer={canManage ? <><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={!f.customer || !f.title} onClick={() => void save()}>{t('common.save')}</Button></> : undefined}>
      {c && c.status === 'OPEN' && canManage ? (
        <Card className="bg-surface/40">
          <CardBody className="grid gap-2">
            <Field label={t('trust.commitments.fulfilNote')}>{(p) => <Textarea {...p} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
            <div><Button loading={busy} onClick={() => void fulfil()}>{t('trust.commitments.markMet')}</Button></div>
          </CardBody>
        </Card>
      ) : null}
      <fieldset disabled={!canManage} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('trust.commitments.organization')} hint={t('trust.commitments.organizationHint')}>{(p) => <Select {...p} value={f.tenantId} onChange={(e) => { const city = cities.find((x) => x.id === e.target.value); setF({ ...f, tenantId: e.target.value, customer: city ? city.name : f.customer }); }}><option value="">—</option>{cities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          <Field label={t('trust.commitments.customer')}>{(p) => <Input {...p} maxLength={160} value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} />}</Field>
          <Field label={t('trust.commitments.kind')}>{(p) => <Select {...p} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{t(`trust.kind.${k}`)}</option>)}</Select>}</Field>
          <Field label={t('trust.table.owner')}>{(p) => <Select {...p} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">{t('trust.unassigned')}</option>{people.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
        </div>
        <Field label={t('trust.table.title')}>{(p) => <Input {...p} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label={t('trust.commitments.detail')}>{(p) => <Textarea {...p} rows={3} maxLength={4000} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('trust.commitments.source')} hint={t('trust.commitments.sourceHint')}>{(p) => <Input {...p} maxLength={300} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />}</Field>
          <Field label={t('trust.table.due')}>{(p) => <Input {...p} type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />}</Field>
          <Field label={t('trust.commitments.recurrence')}>{(p) => <Select {...p} value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value })}>{(['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const).map((r) => <option key={r} value={r}>{t(`trust.recurrence.${r}`)}</option>)}</Select>}</Field>
          <Field label={t('trust.table.status')}>{(p) => <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{(['OPEN', 'MET', 'WAIVED'] as const).map((s) => <option key={s} value={s}>{t(`trust.commitState.${s}`)}</option>)}</Select>}</Field>
        </div>
        <p className="text-caption text-muted">{t('trust.commitments.reminders')}</p>
      </fieldset>
      {c?.fulfilments.length ? (
        <div>
          <h3 className="text-small font-semibold">{t('trust.commitments.history')}</h3>
          <Facts items={c.fulfilments.map((x) => [t('trust.commitments.metOn', { date: date(x.metAt) }), `${x.dueAt ? t('trust.commitments.wasDue', { date: date(x.dueAt) }) : ''}${x.note ? ` · ${x.note}` : ''}`])} />
        </div>
      ) : null}
    </Drawer>
  );
}
