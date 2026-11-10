'use client';

import { Check, Paperclip, Plus, ReceiptText, Trash2, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { api, apiDownload, saveBlob } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useAction, useQuery, todayIso } from '@/lib/useQuery';

const CATEGORIES = ['MILEAGE', 'MEALS', 'TRAVEL', 'PARKING', 'SUPPLIES', 'TRAINING', 'OTHER'] as const;
type Category = (typeof CATEGORIES)[number];
type Status = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID' | 'WITHDRAWN';
interface Item { id: string; date: string; category: Category; description: string; amount: number; km: number | null; centsPerKm: number | null; salesTax: number | null; receiptId: string | null }
export interface Claim { id: string; name?: string; title: string; status: Status; total: number; submittedAt: string; decisionNote: string | null; paid: boolean; items: Item[] }
interface Policy { centsPerKm: number; centsAfter: number; tierKm: number; receiptOver: number }
const TONE: Record<Status, Tone> = { SUBMITTED: 'new', APPROVED: 'brand', PAID: 'ok', REJECTED: 'danger', WITHDRAWN: 'neutral' };

/** Receipts are encrypted documents: fetched with the person's session, then saved. */
async function receipt(id: string) {
  const r = await apiDownload(`/api/documents/${id}/file`);
  if (r.ok) saveBlob(r.blob, `receipt-${id.slice(0, 8)}`);
}

function ItemsTable({ items }: { items: Item[] }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  return (
    <ul className="divide-y divide-line text-small">
      {items.map((i) => (
        <li key={i.id} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-ink">{t(`expenses.categories.${i.category}`)} · {i.description}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-muted">
              <span>{formatDate(`${i.date}T12:00:00`, lng)}</span>
              {i.km ? <span>· {t('expenses.kmAt', { km: i.km, cents: i.centsPerKm })}</span> : null}
              {i.receiptId ? <button type="button" onClick={() => void receipt(i.receiptId!)} className="inline-flex min-h-8 items-center gap-1 font-semibold text-brand-text hover:underline"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" />{t('expenses.receipt')}</button> : null}
            </p>
          </div>
          <span className="shrink-0 tabular-nums text-ink">{formatMoney(i.amount, lng)}</span>
        </li>
      ))}
    </ul>
  );
}

interface Line { category: Category; date: string; description: string; amount: string; km: string; salesTax: string; receipt: { fileName: string; data: string } | null }
const blank = (): Line => ({ category: 'MILEAGE', date: todayIso(), description: '', amount: '', km: '', salesTax: '', receipt: null });

/** The person's own claims, and a form for a new one. */
export function MyExpenses() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const q = useQuery<{ policy: Policy; kmThisYear: number; claims: Claim[] }>('/api/me/expenses');
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const attach = (i: number, f: File | undefined) => {
    if (!f) return set(i, { receipt: null });
    const r = new FileReader();
    r.onload = () => set(i, { receipt: { fileName: f.name, data: String(r.result) } });
    r.readAsDataURL(f);
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const title = String(new FormData(e.currentTarget).get('title'));
    const items = lines.map((l) => ({ date: l.date, category: l.category, description: l.description.trim(), ...(l.category === 'MILEAGE' ? { km: Number(l.km) } : { amount: Number(l.amount), salesTax: l.salesTax ? Number(l.salesTax) : null, receipt: l.receipt }) }));
    const r = await run('submit', () => api('/api/me/expenses', { method: 'POST', body: { title, items } }), t('expenses.submitted'));
    if (r !== undefined) { setOpen(false); setLines([blank()]); await q.reload(); }
  }
  const p = q.data?.policy;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {p ? <p className="text-small text-muted">{t('expenses.rateLine', { first: p.centsPerKm, after: p.centsAfter, tier: p.tierKm.toLocaleString(lng), km: q.data!.kmThisYear.toLocaleString(lng) })}</p> : <span />}
        <Button icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen(true)}>{t('expenses.new')}</Button>
      </div>
      {q.loading ? <ListSkeleton /> : !q.data?.claims.length ? (
        <EmptyState icon={ReceiptText} title={t('expenses.emptyTitle')}>{t('expenses.emptyBody')}</EmptyState>
      ) : (
        q.data.claims.map((c) => (
          <Card key={c.id}>
            <CardHeader title={c.title} description={`${formatDate(c.submittedAt, lng)} · ${formatMoney(c.total, lng)}`} action={<StatusPill tone={TONE[c.status]}>{t(`expenses.status.${c.status}`)}</StatusPill>} />
            <CardBody className="grid gap-3 pt-2">
              <ItemsTable items={c.items} />
              {c.decisionNote ? <p className="text-small text-muted">{t('expenses.note', { note: c.decisionNote })}</p> : null}
              {c.status === 'SUBMITTED' ? <Button size="sm" variant="ghost" className="justify-self-start" loading={busy === c.id} onClick={() => void run(c.id, () => api(`/api/me/expenses/${c.id}/withdraw`, { method: 'POST' }), t('expenses.withdrawn')).then(() => q.reload())}>{t('expenses.withdraw')}</Button> : null}
            </CardBody>
          </Card>
        ))
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('expenses.new')} description={t('expenses.newHelp', { over: p?.receiptOver ?? 25 })} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <Field label={t('expenses.title')}>{(f) => <Input {...f} name="title" required minLength={2} maxLength={120} placeholder={t('expenses.titlePlaceholder')} />}</Field>
          {lines.map((l, i) => (
            <fieldset key={i} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-2">
              <legend className="px-1 text-small font-semibold">{t('expenses.line', { n: i + 1 })}</legend>
              <Field label={t('expenses.category')}>{(f) => <Select {...f} value={l.category} onChange={(e) => set(i, { category: e.target.value as Category })}>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`expenses.categories.${c}`)}</option>)}</Select>}</Field>
              <Field label={t('expenses.date')}>{(f) => <Input {...f} type="date" value={l.date} max={todayIso()} onChange={(e) => set(i, { date: e.target.value })} required />}</Field>
              <Field label={t('expenses.description')}>{(f) => <Input {...f} value={l.description} onChange={(e) => set(i, { description: e.target.value })} required minLength={2} maxLength={160} placeholder={l.category === 'MILEAGE' ? t('expenses.tripPlaceholder') : undefined} />}</Field>
              {l.category === 'MILEAGE' ? (
                <Field label={t('expenses.km')}>{(f) => <Input {...f} type="number" min={0.1} step={0.1} value={l.km} onChange={(e) => set(i, { km: e.target.value })} required inputMode="decimal" />}</Field>
              ) : (
                <>
                  <Field label={t('expenses.amount')}>{(f) => <Input {...f} type="number" min={0.01} step={0.01} value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} required inputMode="decimal" />}</Field>
                  <Field label={t('expenses.salesTax')}>{(f) => <Input {...f} type="number" min={0} step={0.01} value={l.salesTax} onChange={(e) => set(i, { salesTax: e.target.value })} inputMode="decimal" />}</Field>
                  <Field label={t('expenses.receipt')} hint={l.receipt?.fileName}>{(f) => <Input {...f} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" capture="environment" onChange={(e) => attach(i, e.target.files?.[0])} />}</Field>
                </>
              )}
              {lines.length > 1 ? <Button size="sm" variant="ghost" className="justify-self-start sm:col-span-2" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>{t('expenses.removeLine')}</Button> : null}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setLines((ls) => [...ls, { ...blank(), category: 'OTHER' }])} disabled={lines.length >= 30}>{t('expenses.addLine')}</Button>
            <Button type="submit" loading={busy === 'submit'}>{t('expenses.submit')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Approvers: claims from their department, waiting or decided. */
export function ExpenseApprovals() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [status, setStatus] = useState<'SUBMITTED' | 'APPROVED' | 'PAID' | 'REJECTED'>('SUBMITTED');
  const q = useQuery<Claim[]>(`/api/expenses?status=${status}`);
  const { run, busy } = useAction();
  const [rejecting, setRejecting] = useState<Claim | null>(null);
  const decide = (id: string, decision: 'APPROVE' | 'REJECT', note?: string) => run(`${decision}${id}`, () => api(`/api/expenses/${id}/decision`, { method: 'POST', body: { decision, note: note ?? null } }), decision === 'APPROVE' ? t('expenses.approved') : t('expenses.rejected')).then(() => q.reload());
  return (
    <div className="grid gap-4">
      <Segmented label={t('expenses.show')} value={status} onChange={setStatus} options={(['SUBMITTED', 'APPROVED', 'PAID', 'REJECTED'] as const).map((s) => ({ value: s, label: t(`expenses.status.${s}`) }))} />
      {q.loading ? <ListSkeleton /> : !q.data?.length ? (
        <EmptyState icon={ReceiptText} title={t('expenses.noneHere')}>{status === 'SUBMITTED' ? t('expenses.noneWaiting') : null}</EmptyState>
      ) : (
        q.data.map((c) => (
          <Card key={c.id}>
            <CardHeader title={`${c.name} · ${c.title}`} description={`${formatDate(c.submittedAt, lng)} · ${formatMoney(c.total, lng)}`} />
            <CardBody className="grid gap-3 pt-2">
              <ItemsTable items={c.items} />
              {status === 'SUBMITTED' ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<Check className="h-4 w-4" aria-hidden="true" />} loading={busy === `APPROVE${c.id}`} onClick={() => void decide(c.id, 'APPROVE')}>{t('expenses.approve')}</Button>
                  <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={() => setRejecting(c)}>{t('expenses.reject')}</Button>
                </div>
              ) : null}
            </CardBody>
          </Card>
        ))
      )}
      <p className="text-caption text-muted">{t('expenses.paidHow')}</p>
      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title={t('expenses.rejectTitle')} closeLabel={t('common.cancel')}>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); const note = String(new FormData(e.currentTarget).get('note')); const c = rejecting!; setRejecting(null); void decide(c.id, 'REJECT', note); }}>
          <Field label={t('expenses.why')}>{(f) => <Input {...f} name="note" required minLength={3} maxLength={300} />}</Field>
          <Button type="submit" variant="danger" className="justify-self-start">{t('expenses.reject')}</Button>
        </form>
      </Dialog>
    </div>
  );
}
