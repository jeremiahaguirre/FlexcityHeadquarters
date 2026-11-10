'use client';

import { CheckCircle2, Landmark } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { papi, usePlatformQuery } from '@/lib/platform';
import { useAction } from '@/lib/useQuery';

interface Table { id: string; year: number; jurisdiction: string; data: unknown; verifiedAt: string | null; verifiedBy: string | null; note: string | null }

/**
 * CRA and provincial payroll tables used by every city's pay runs. Nothing is
 * paid with a table until someone here checks each number against CRA's T4127
 * and verifies it; editing a table clears the check.
 */
export default function PayrollTaxPage() {
  const { t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const data = usePlatformQuery<{ year: number; jurisdictions: string[]; tables: Table[] }>(`/payroll-tax?year=${year}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid gap-6">
      <PageHeader title={t('payTax.title')} description={t('payTax.description')} actions={<Input aria-label={t('payroll.year')} type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" />} />
      {!data.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4">
          {data.data.jurisdictions.map((j) => {
            const row = data.data!.tables.find((x) => x.jurisdiction === j);
            return (
              <Card key={j}>
                <CardHeader
                  title={j === 'CA' ? t('payTax.federal') : j}
                  description={row?.note ?? t('payTax.none')}
                  action={
                    <div className="flex items-center gap-2">
                      {row ? row.verifiedAt ? <StatusPill tone="ok">{t('payTax.verified')}</StatusPill> : <StatusPill tone="warn">{t('payTax.unverified')}</StatusPill> : <StatusPill tone="neutral">{t('payTax.missing')}</StatusPill>}
                      <Button size="sm" variant="secondary" onClick={() => setOpen(open === j ? null : j)}>{open === j ? t('common.close') : t('payTax.open')}</Button>
                    </div>
                  }
                />
                {open === j ? <CardBody className="pt-2"><Editor year={year} jurisdiction={j} row={row ?? null} reload={data.reload} /></CardBody> : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Editor({ year, jurisdiction, row, reload }: { year: number; jurisdiction: string; row: Table | null; reload: () => Promise<void> }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(f.get('data')));
    } catch {
      parsed = undefined;
    }
    const r = await run('save', () => papi(`/payroll-tax/${year}/${jurisdiction}`, { method: 'PUT', body: { data: parsed, note: String(f.get('note') ?? '') || null } }), t('payTax.saved'));
    if (r !== undefined) await reload();
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run('verify', () => papi(`/payroll-tax/${year}/${jurisdiction}/verify`, { method: 'POST', body: { attest: f.get('attest') === 'on', source: String(f.get('source')) } }), t('payTax.verifiedDone'));
    if (r !== undefined) await reload();
  }
  return (
    <div className="grid gap-5">
      <form onSubmit={(e) => void save(e)} className="grid gap-3">
        <Field label={t('payTax.data')} hint={t('payTax.dataHint')}>{(p) => <Textarea {...p} name="data" rows={14} className="font-mono text-caption" defaultValue={row ? JSON.stringify(row.data, null, 2) : ''} />}</Field>
        <Field label={t('payTax.note')}>{(p) => <Input {...p} name="note" defaultValue={row?.note ?? ''} />}</Field>
        <div><Button type="submit" size="sm" variant="secondary" icon={<Landmark className="h-4 w-4" aria-hidden="true" />} loading={busy === 'save'}>{t('payTax.save')}</Button></div>
      </form>
      {row && !row.verifiedAt ? (
        <form onSubmit={(e) => void verify(e)} className="grid gap-3 rounded-2xl border border-line p-4">
          <Field label={t('payTax.source')} hint={t('payTax.sourceHint')}>{(p) => <Input {...p} name="source" required minLength={5} placeholder="T4127 (January 2026), chapter 6 tables" />}</Field>
          <label className="flex items-start gap-2 text-small"><input type="checkbox" name="attest" required className="mt-0.5 h-5 w-5 accent-[rgb(var(--brand))]" />{t('payTax.attest')}</label>
          <div><Button type="submit" size="sm" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} loading={busy === 'verify'}>{t('payTax.verify')}</Button></div>
        </form>
      ) : row?.verifiedAt ? (
        <p className="text-small text-muted">{t('payTax.verifiedBy', { who: row.verifiedBy, when: row.verifiedAt.slice(0, 10) })}</p>
      ) : null}
    </div>
  );
}
