'use client';

import { AlertTriangle, FilePlus2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InvoiceList } from '@/components/platform/InvoiceList';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { StatTile } from '@/components/ui/StatTile';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { type InvoiceRow, cad, recentMonths, thisMonth } from '@/lib/billing';
import { papi, usePlatformQuery } from '@/lib/platform';
import { dateFormat, formatInstant } from '@/lib/format';

interface Summary {
  month: string;
  cities: Array<{ tenantId: string; name: string; subdomain: string; hasAccount: boolean; monthlySubtotalCents: number; monthlyTotalCents: number }>;
  totals: { mrrCents: number; outstandingCents: number; overdueCents: number; overdueCount: number; outstandingCount?: number; paidThisMonthCents: number; paidThisMonthCount?: number };
  issuer: { legalName: string; gstNumberSet: boolean };
  tax: { verified: boolean; asOf: string };
}
type Filter = 'OPEN' | 'OVERDUE' | 'DRAFT' | 'PAID' | 'ALL';

/** Dev console billing: plans, invoices and payments for every organization. */
export default function BillingPage() {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const toast = useToast();
  const summary = usePlatformQuery<Summary>('/billing/summary');
  const [filter, setFilter] = useState<Filter>('OPEN');
  const invoices = usePlatformQuery<InvoiceRow[]>(`/billing/invoices${filter === 'ALL' ? '' : `?status=${filter}`}`);
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const s = summary.data;

  async function generate() {
    setBusy(true);
    try {
      const r = await papi<Record<string, number>>('/billing/invoices/generate', { method: 'POST', body: { month } });
      toast(t('billing.generated', { created: r.created ?? 0, exists: r.exists ?? 0 }), 'ok');
      setFilter('DRAFT');
      await Promise.all([summary.reload(), invoices.reload()]);
    } catch {
      toast(t('common.error'), 'warn');
    } finally {
      setBusy(false);
    }
  }

  const tiles = s
    ? [
        { label: t('billing.mrr'), value: cad(s.totals.mrrCents, lng), hint: t('billing.mrrHint') },
        { label: t('billing.outstanding'), value: cad(s.totals.outstandingCents, lng), hint: s.totals.outstandingCount != null ? t('billing.invoiceCount', { count: s.totals.outstandingCount }) : undefined },
        { label: t('billing.overdue'), value: cad(s.totals.overdueCents, lng), hint: t('billing.invoiceCount', { count: s.totals.overdueCount }), danger: s.totals.overdueCount > 0 },
        { label: t('billing.paidThisMonth'), value: cad(s.totals.paidThisMonthCents, lng), hint: s.totals.paidThisMonthCount != null ? t('billing.paymentCount', { count: s.totals.paidThisMonthCount }) : undefined },
      ]
    : [];

  return (
    <>
      <PageHeader title={t('billing.title')} description={t('billing.description')} />
      {s && (!s.tax.verified || !s.issuer.gstNumberSet) ? (
        <div className="mb-6 grid gap-2 rounded-xl bg-warn-bg px-4 py-3 text-small text-ink">
          {!s.tax.verified ? (
            <p className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              {t('billing.taxUnverified', { date: formatInstant(s.tax.asOf, lng) })}
            </p>
          ) : null}
          {!s.issuer.gstNumberSet ? (
            <p className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              {t('billing.noGstNumber')}
            </p>
          ) : null}
        </div>
      ) : null}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('billing.atAGlance')}>
        {!s
          ? Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl2 bg-surface" />)
          : tiles.map((x) => (
              <StatTile key={x.label} className="max-sm:p-4" label={x.label} value={x.value} hint={x.hint} tone={x.danger ? 'danger' : undefined} />
            ))}
      </section>

      {/* The invoice table takes the full width: seven columns of money and dates need it. */}
      <div className="grid items-start gap-6">
        <Card>
          <CardHeader title={t('billing.invoices')} />
          <CardBody className="grid gap-4 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label={t('staff.status')}
                value={filter}
                onChange={setFilter}
                options={(['OPEN', 'OVERDUE', 'DRAFT', 'PAID', 'ALL'] as const).map((f) => ({ value: f, label: t(`billing.filters.${f}`) }))}
              />
            </div>
            {invoices.loading && !invoices.data ? <ListSkeleton rows={3} /> : <InvoiceList invoices={invoices.data ?? []} />}
          </CardBody>
        </Card>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('billing.monthly')} description={t('billing.monthlyHelp')} />
            <CardBody className="grid gap-3 pt-3">
              <div className="flex flex-wrap gap-2">
                <div className="w-52">
                  <Select aria-label={t('billing.month')} value={month} onChange={(e) => setMonth(e.target.value)}>
                    {recentMonths().map((m) => (
                      <option key={m} value={m}>
                        {dateFormat(lng, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`))}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button icon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />} loading={busy} onClick={() => void generate()}>
                  {t('billing.generate')}
                </Button>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('billing.byCity')} />
            <CardBody className="pt-2">
              <ul className="divide-y divide-line">
                {s?.cities.map((c) => (
                  <li key={c.tenantId}>
                    <Link href={`/platform/city?id=${c.tenantId}&tab=billing`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg py-2.5 hover:bg-surface/60">
                      <span className="min-w-0">
                        <span className="block truncate text-small font-semibold">{c.name}</span>
                        <span className="text-caption text-muted">{c.hasAccount ? t('billing.perMonth', { amount: cad(c.monthlySubtotalCents, lng) }) : t('billing.notSetUp')}</span>
                      </span>
                      <span className="text-small font-semibold text-brand-text">{c.hasAccount ? t('billing.open') : t('billing.setUp')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
