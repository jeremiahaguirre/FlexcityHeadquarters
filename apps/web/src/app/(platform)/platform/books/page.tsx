'use client';

import { Download, Plus, Undo2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/apiError';
import { cad } from '@/lib/billing';
import type { AccountType, BooksSetup, Entry } from '@/lib/books';
import { formatDate } from '@/lib/format';
import { papi, pdownload, usePlatformQuery } from '@/lib/platform';

type Tab = 'journal' | 'reports' | 'chart';
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

/** FH's own books for plan charges. */
export default function BooksPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('journal');
  const setup = usePlatformQuery<BooksSetup>('/books');
  return (
    <div className="grid gap-6">
      <PageHeader title={t('books.title')} description={t('books.description')} />
      <div className="overflow-x-auto"><Segmented label={t('books.title')} value={tab} onChange={setTab} options={(['journal', 'reports', 'chart'] as const).map((v) => ({ value: v, label: t(`books.tabs.${v}`) }))} /></div>
      {!setup.data ? <Skeleton className="h-64" /> : tab === 'journal' ? <Journal setup={setup.data} /> : tab === 'reports' ? <Reports /> : <Chart setup={setup.data} reload={setup.reload} />}
    </div>
  );
}

function useRun() {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok, 'ok');
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('common.error'), 'warn');
      return false;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy };
}

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <div className="w-44"><Input aria-label={t('books.from')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div className="w-44"><Input aria-label={t('books.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
    </div>
  );
}

function Journal({ setup }: { setup: BooksSetup }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const data = usePlatformQuery<{ entries: Entry[]; manual: Array<{ id: string; reference: string | null }> }>(`/books/journal?from=${from}&to=${to}`);
  const [adding, setAdding] = useState(false);
  const [lines, setLines] = useState([{ account: '', debit: '', credit: '' }, { account: '', debit: '', credit: '' }]);
  const { run, busy } = useRun();
  const name = (code: string) => setup.accounts.find((a) => a.code === code)?.name ?? code;
  const cents = (s: string) => Math.round(Number(s.replace(',', '.') || 0) * 100);
  const dr = lines.reduce((s, l) => s + cents(l.debit), 0);
  const cr = lines.reduce((s, l) => s + cents(l.credit), 0);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { date: String(f.get('date')), memo: String(f.get('memo')).trim(), reference: String(f.get('ref') ?? '').trim() || null, lines: lines.filter((l) => l.account).map((l) => ({ account: l.account, debitCents: cents(l.debit), creditCents: cents(l.credit) })) };
    if (await run('add', () => papi('/books/entries', { method: 'POST', body }), t('books.entryAdded'))) {
      setAdding(false);
      setLines([{ account: '', debit: '', credit: '' }, { account: '', debit: '', credit: '' }]);
      await data.reload();
    }
  }
  const manualId = (ref: string) => data.data?.manual.find((m) => (m.reference ?? `JE-${m.id.slice(0, 6)}`) === ref)?.id;
  return (
    <Card>
      <CardHeader
        title={t('books.journal')}
        description={t('books.journalHelp')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} loading={busy === 'csv'} onClick={() => void run('csv', () => pdownload(`/books/journal.csv?from=${from}&to=${to}`, 'fh-journal.csv'))}>{t('books.csv')}</Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setAdding(true)}>{t('books.addEntry')}</Button>
          </div>
        }
      />
      <CardBody className="pt-2">
        {!data.data ? (
          <Skeleton className="h-40" />
        ) : !data.data.entries.length ? (
          <p className="text-small text-muted">{t('books.noEntries')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-small">
              <thead><tr className="text-left text-caption text-muted"><th className="py-2 pr-3">{t('books.date')}</th><th className="py-2 pr-3">{t('books.account')}</th><th className="py-2 pr-3 text-right">{t('books.debit')}</th><th className="py-2 pr-3 text-right">{t('books.credit')}</th></tr></thead>
              {data.data.entries.map((e, n) => (
                <tbody key={`${e.reference}-${e.kind}-${n}`} className="border-t border-line">
                  <tr>
                    <td colSpan={4} className="pb-1 pt-3">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{formatDate(e.date, lng, 'dated')}</span>
                        <StatusPill tone={e.kind === 'MANUAL' ? 'brand' : e.kind === 'VOID' || e.kind === 'PAD_RETURN' || e.kind === 'WRITE_OFF' ? 'warn' : 'neutral'}>{t(`books.kinds.${e.kind}`)}</StatusPill>
                        <span className="text-muted">{e.memo}{e.organization ? ` · ${e.organization}` : ''}</span>
                        {e.kind === 'MANUAL' && manualId(e.reference) && !e.reference.startsWith('REV-') ? <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} loading={busy === `rev${e.reference}`} onClick={() => void run(`rev${e.reference}`, () => papi(`/books/entries/${manualId(e.reference)}/reverse`, { method: 'POST', body: { date: today() } }), t('books.reversed')).then(() => data.reload())}>{t('books.reverse')}</Button> : null}
                      </span>
                    </td>
                  </tr>
                  {e.lines.map((l) => (
                    <tr key={l.account}>
                      <td className="py-0.5 pr-3" />
                      <td className={`py-0.5 pr-3 ${l.creditCents ? 'pl-6' : ''}`}>{l.account} {name(l.account)}</td>
                      <td className="py-0.5 pr-3 text-right tabular-nums">{l.debitCents ? cad(l.debitCents, lng) : ''}</td>
                      <td className="py-0.5 pr-3 text-right tabular-nums">{l.creditCents ? cad(l.creditCents, lng) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </CardBody>
      <Dialog open={adding} onClose={() => setAdding(false)} title={t('books.addEntry')} description={t('books.addEntryHelp')} closeLabel={t('common.close')}>
        <form onSubmit={(e) => void add(e)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label={t('books.date')}>{(p) => <Input {...p} name="date" type="date" required defaultValue={today()} />}</Field>
            <Field label={t('books.memo')}>{(p) => <Input {...p} name="memo" required minLength={2} maxLength={200} />}</Field>
          </div>
          <Field label={t('books.reference')}>{(p) => <Input {...p} name="ref" maxLength={40} />}</Field>
          <div className="grid gap-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] gap-2">
                <Select aria-label={t('books.account')} value={l.account} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))}>
                  <option value="">{t('books.pickAccount')}</option>
                  {setup.accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                </Select>
                <Input aria-label={t('books.debit')} placeholder={t('books.debit')} inputMode="decimal" value={l.debit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: e.target.value ? '' : x.credit } : x)))} />
                <Input aria-label={t('books.credit')} placeholder={t('books.credit')} inputMode="decimal" value={l.credit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: e.target.value ? '' : x.debit } : x)))} />
              </div>
            ))}
            <div><Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setLines([...lines, { account: '', debit: '', credit: '' }])}>{t('books.addLine')}</Button></div>
          </div>
          <p className={`text-small ${dr === cr && dr > 0 ? 'text-ok' : 'text-warn'}`}>{t('books.totals', { debit: cad(dr, lng), credit: cad(cr, lng) })}</p>
          <div><Button type="submit" disabled={dr !== cr || !dr} loading={busy === 'add'}>{t('books.post')}</Button></div>
        </form>
      </Dialog>
    </Card>
  );
}

function Reports() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const year = Number(to.slice(0, 4));
  const tb = usePlatformQuery<{ rows: Array<{ code: string; name: string; debitCents: number; creditCents: number }>; debitCents: number; creditCents: number; balanced: boolean }>(`/books/trial-balance?asOf=${to}`);
  const is = usePlatformQuery<{ revenue: Array<{ code: string; name: string; cents: number }>; expenses: Array<{ code: string; name: string; cents: number }>; revenueCents: number; expenseCents: number; netIncomeCents: number }>(`/books/income-statement?from=${from}&to=${to}`);
  const aging = usePlatformQuery<{ rows: Array<{ tenantId: string; organization: string; current: number; d1_30: number; d31_60: number; d61_90: number; over90: number; totalCents: number }>; totals: Record<string, number> }>(`/books/aging?asOf=${to}`);
  const tax = usePlatformQuery<{ taxes: Array<{ key: string; account: string; chargedCents: number; adjustmentsCents: number; netCents: number }>; byProvince: Array<{ province: string; salesCents: number; taxes: Record<string, number> }>; note: string }>(`/books/sales-tax?from=${from}&to=${to}`);
  const rev = usePlatformQuery<{ months: number[]; totalCents: number; mrrCents: number; arrCents: number; organizations: Array<{ tenantId: string; organization: string; months: number[]; totalCents: number }> }>(`/books/revenue?year=${year}`);
  const money = (c: number) => cad(c, lng);
  const monthName = (m: number) => new Intl.DateTimeFormat(lng, { month: 'short' }).format(new Date(Date.UTC(year, m, 15)));
  const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3"><Range from={from} to={to} setFrom={setFrom} setTo={setTo} /><span className="text-small text-muted">{t('books.rangeHelp')}</span></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('books.income')} description={t('books.incomeHelp', { from: formatDate(from, lng, 'dated'), to: formatDate(to, lng, 'dated') })} />
          <CardBody className="pt-2 text-small">
            {!is.data ? <Skeleton className="h-32" /> : (
              <dl className="grid gap-1">
                {is.data.revenue.map((r) => <div key={r.code} className="flex justify-between gap-3"><dt>{r.code} {r.name}</dt><dd className="tabular-nums">{money(r.cents)}</dd></div>)}
                <div className="flex justify-between gap-3 border-t border-line pt-1 font-semibold"><dt>{t('books.totalRevenue')}</dt><dd className="tabular-nums">{money(is.data.revenueCents)}</dd></div>
                {is.data.expenses.map((r) => <div key={r.code} className="flex justify-between gap-3"><dt>{r.code} {r.name}</dt><dd className="tabular-nums">({money(r.cents)})</dd></div>)}
                <div className="flex justify-between gap-3 border-t border-line pt-1 text-body-strong"><dt>{t('books.netIncome')}</dt><dd className="tabular-nums">{money(is.data.netIncomeCents)}</dd></div>
              </dl>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t('books.trial')} description={t('books.asOf', { date: formatDate(to, lng, 'dated') })} action={tb.data ? <StatusPill tone={tb.data.balanced ? 'ok' : 'danger'}>{tb.data.balanced ? t('books.balanced') : t('books.unbalanced')}</StatusPill> : undefined} />
          <CardBody className="pt-2">
            {!tb.data ? <Skeleton className="h-32" /> : (
              <table className="w-full text-small">
                <tbody className="divide-y divide-line">
                  {tb.data.rows.map((r) => <tr key={r.code}><td className="py-1 pr-3">{r.code} {r.name}</td><td className="py-1 pr-3 text-right tabular-nums">{r.debitCents ? money(r.debitCents) : ''}</td><td className="py-1 text-right tabular-nums">{r.creditCents ? money(r.creditCents) : ''}</td></tr>)}
                  <tr className="font-semibold"><td className="py-1 pr-3">{t('books.total')}</td><td className="py-1 pr-3 text-right tabular-nums">{money(tb.data.debitCents)}</td><td className="py-1 text-right tabular-nums">{money(tb.data.creditCents)}</td></tr>
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title={t('books.aging')} description={t('books.asOf', { date: formatDate(to, lng, 'dated') })} />
        <CardBody className="overflow-x-auto pt-2">
          {!aging.data ? <Skeleton className="h-24" /> : !aging.data.rows.length ? <p className="text-small text-muted">{t('books.nothingOwing')}</p> : (
            <table className="w-full text-small">
              <thead><tr className="text-left text-caption text-muted"><th className="py-2 pr-3">{t('books.organization')}</th>{BUCKETS.map((b) => <th key={b} className="py-2 pr-3 text-right">{t(`books.buckets.${b}`)}</th>)}<th className="py-2 text-right">{t('books.total')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {aging.data.rows.map((r) => <tr key={r.tenantId}><td className="py-1 pr-3">{r.organization}</td>{BUCKETS.map((b) => <td key={b} className={`py-1 pr-3 text-right tabular-nums ${b !== 'current' && r[b] ? 'text-danger' : ''}`}>{r[b] ? money(r[b]) : ''}</td>)}<td className="py-1 text-right font-semibold tabular-nums">{money(r.totalCents)}</td></tr>)}
                <tr className="font-semibold"><td className="py-1 pr-3">{t('books.total')}</td>{BUCKETS.map((b) => <td key={b} className="py-1 pr-3 text-right tabular-nums">{money(aging.data!.totals[b] ?? 0)}</td>)}<td className="py-1 text-right tabular-nums">{money(aging.data.totals.totalCents ?? 0)}</td></tr>
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('books.salesTax')} description={t('books.salesTaxHelp')} />
        <CardBody className="grid gap-4 pt-2 text-small">
          {!tax.data ? <Skeleton className="h-24" /> : (
            <>
              <table className="w-full">
                <thead><tr className="text-left text-caption text-muted"><th className="py-1 pr-3">{t('books.tax')}</th><th className="py-1 pr-3 text-right">{t('books.charged')}</th><th className="py-1 pr-3 text-right">{t('books.adjustments')}</th><th className="py-1 text-right">{t('books.toRemit')}</th></tr></thead>
                <tbody className="divide-y divide-line">{tax.data.taxes.map((x) => <tr key={x.key}><td className="py-1 pr-3">{t(`books.taxes.${x.key}`)}</td><td className="py-1 pr-3 text-right tabular-nums">{money(x.chargedCents)}</td><td className="py-1 pr-3 text-right tabular-nums">{money(x.adjustmentsCents)}</td><td className="py-1 text-right font-semibold tabular-nums">{money(x.netCents)}</td></tr>)}</tbody>
              </table>
              {tax.data.byProvince.length ? <p className="text-muted">{tax.data.byProvince.map((p) => `${p.province}: ${t('books.sales')} ${money(p.salesCents)} · ${Object.entries(p.taxes).map(([k, v]) => `${k} ${money(v)}`).join(' · ')}`).join(' | ')}</p> : null}
              <p className="text-caption text-muted">{t('books.itcNote')}</p>
            </>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('books.revenue', { year })} description={rev.data ? t('books.mrr', { mrr: money(rev.data.mrrCents), arr: money(rev.data.arrCents), total: money(rev.data.totalCents) }) : undefined} />
        <CardBody className="overflow-x-auto pt-2">
          {!rev.data ? <Skeleton className="h-24" /> : (
            <table className="w-full text-small">
              <thead><tr className="text-left text-caption text-muted"><th className="py-1 pr-3">{t('books.organization')}</th>{rev.data.months.map((_, m) => <th key={m} className="py-1 pr-2 text-right">{monthName(m)}</th>)}<th className="py-1 text-right">{t('books.total')}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {rev.data.organizations.map((o) => <tr key={o.tenantId}><td className="py-1 pr-3">{o.organization}</td>{o.months.map((c, m) => <td key={m} className="py-1 pr-2 text-right tabular-nums">{c ? money(c) : ''}</td>)}<td className="py-1 text-right font-semibold tabular-nums">{money(o.totalCents)}</td></tr>)}
                <tr className="font-semibold"><td className="py-1 pr-3">{t('books.total')}</td>{rev.data.months.map((c, m) => <td key={m} className="py-1 pr-2 text-right tabular-nums">{c ? money(c) : ''}</td>)}<td className="py-1 text-right tabular-nums">{money(rev.data.totalCents)}</td></tr>
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

const TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

function Chart({ setup, reload }: { setup: BooksSetup; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useRun();
  const [codes, setCodes] = useState<Record<string, string>>(setup.byKey);
  const [custom, setCustom] = useState(setup.custom);
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t('books.chart')} description={t('books.chartHelp')} />
        <CardBody className="grid gap-4 pt-2">
          <div className="grid gap-2">
            {setup.accounts.filter((a) => a.key).map((a) => (
              <div key={a.key} className="grid grid-cols-[6rem_minmax(0,1fr)_6rem] items-center gap-3 text-small">
                <Input aria-label={t('books.code')} value={codes[a.key!] ?? ''} onChange={(e) => setCodes({ ...codes, [a.key!]: e.target.value })} />
                <span>{a.name}</span>
                <span className="text-muted">{t(`books.types.${a.type}`)}</span>
              </div>
            ))}
          </div>
          <p className="font-semibold">{t('books.custom')}</p>
          {custom.map((c, i) => (
            <div key={i} className="grid grid-cols-[6rem_minmax(0,1fr)_9rem] gap-3">
              <Input aria-label={t('books.code')} value={c.code} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
              <Input aria-label={t('books.accountName')} value={c.name} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Select aria-label={t('books.type')} value={c.type} onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, type: e.target.value as AccountType } : x)))}>{TYPES.map((ty) => <option key={ty} value={ty}>{t(`books.types.${ty}`)}</option>)}</Select>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setCustom([...custom, { code: '', name: '', type: 'EXPENSE' }])}>{t('books.addAccount')}</Button>
            <Button size="sm" loading={busy === 'chart'} onClick={() => void run('chart', () => papi('/books/chart', { method: 'PUT', body: { codes, custom: custom.filter((c) => c.code && c.name) } }), t('books.chartSaved')).then(() => reload())}>{t('common.save')}</Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('books.period')} description={t('books.periodHelp')} />
        <CardBody className="pt-2">
          <form className="flex flex-wrap items-end gap-4" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void run('settings', () => papi('/books/settings', { method: 'PUT', body: { fiscalYearStart: Number(f.get('fy')), closedThrough: String(f.get('closed') || '') || null } }), t('books.periodSaved')).then(() => reload()); }}>
            <Field label={t('books.fiscalStart')}>{(p) => <Select {...p} name="fy" defaultValue={setup.fiscalYearStart}>{Array.from({ length: 12 }, (_, m) => <option key={m} value={m + 1}>{new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(Date.UTC(2026, m, 15)))}</option>)}</Select>}</Field>
            <Field label={t('books.closedThrough')} hint={t('books.closedHint')}>{(p) => <Input {...p} name="closed" type="date" defaultValue={setup.closedThrough ?? ''} />}</Field>
            <Button type="submit" loading={busy === 'settings'}>{t('common.save')}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
