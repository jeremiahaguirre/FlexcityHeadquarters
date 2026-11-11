'use client';

import { Activity, Play } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgo, useParam, usePeople, useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, Facts, TrustTabs, errorText } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { papi, usePlatformQuery } from '@/lib/platform';
import { colon, pick, testTone, type TestStatus } from '@/lib/trust';
import { detailRows } from '@/lib/trustDetails';

interface TestRow { key: string; title: string; titleFr: string; everyMinutes: number; enabled: boolean; ownerId: string | null; owner: string | null; status: TestStatus | null; lastRunAt: string | null; summary: string | null; details: Record<string, unknown> | null; controls: string[] }
interface Run { id: string; status: TestStatus; summary: string; details: Record<string, unknown> | null; at: string; trigger: string; durationMs: number }

const summaryOf = (r: { summary: string | null; details: Record<string, unknown> | null }, lang: string) => (lang.startsWith('fr') && typeof r.details?.summaryFr === 'string' ? r.details.summaryFr : r.summary) ?? '';

/** Trust: automated checks of the platform's real state. The worker runs them on a schedule; a failure alerts the owner. */
export default function TestsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { canManage } = useTrustAccess();
  const data = usePlatformQuery<TestRow[]>('/trust/tests');
  const want = useParam('test');
  const status = useParam('status');
  const [open, setOpen] = useState<TestRow | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (want && data.data) setOpen(data.data.find((x) => x.key === want) ?? null);
  }, [want, data.data]);
  async function runAll() {
    setRunning(true);
    try {
      await papi('/trust/tests/run', { method: 'POST', body: {} });
      await data.reload();
      toast(t('trust.tests.ran'), 'ok');
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setRunning(false);
    }
  }
  const rows = (data.data ?? []).filter((x) => !status || (status === 'FAIL' ? x.status === 'FAIL' || x.status === 'ERROR' : x.status === status));
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.tests')} description={t('trust.tests.description')}
        actions={canManage ? <Button size="sm" icon={<Play className="h-4 w-4" aria-hidden="true" />} loading={running} onClick={() => void runAll()}>{t('trust.tests.runAll')}</Button> : undefined} />
      <TrustTabs />
      {!data.data ? <Skeleton className="h-96" /> : (
        <DataTable<TestRow>
          label={t('trust.section.tests')}
          rows={rows}
          rowKey={(x) => x.key}
          onOpen={setOpen}
          emptyIcon={Activity}
          emptyTitle={t('trust.table.none')}
          initialSort={{ key: 'status', dir: 'asc' }}
          filters={[{ key: 'status', label: t('trust.table.status'), options: (['PASS', 'WARN', 'FAIL', 'ERROR'] as const).map((s) => ({ value: s, label: t(`trust.testStatus.${s}`) })), value: (x) => x.status ?? '' }]}
          columns={[
            { key: 'title', label: t('trust.tests.test'), value: (x) => pick(x, 'title', i18n.language) },
            { key: 'summary', label: t('trust.tests.result'), value: (x) => summaryOf(x, i18n.language), render: (x) => <span className="text-muted">{summaryOf(x, i18n.language)}</span>, wide: true },
            { key: 'status', label: t('trust.table.status'), value: (x) => ({ FAIL: 0, ERROR: 1, WARN: 2, PASS: 3 })[x.status ?? 'PASS'] ?? 4, render: (x) => <StatusPill tone={testTone(x.status)}>{t(`trust.testStatus.${x.status ?? 'NONE'}`)}</StatusPill> },
            { key: 'last', label: t('trust.tests.lastRun'), value: (x) => x.lastRunAt ?? '', render: (x) => <Ago ts={x.lastRunAt} /> },
            { key: 'every', label: t('trust.tests.every'), value: (x) => x.everyMinutes, render: (x) => t('trust.tests.minutes', { count: x.everyMinutes }) },
            { key: 'owner', label: t('trust.table.owner'), value: (x) => x.owner ?? '', render: (x) => x.owner ?? <span className="text-muted">{t('trust.unassigned')}</span> },
          ]}
        />
      )}
      <TestDrawer test={open} onClose={() => setOpen(null)} onChanged={() => void data.reload()} />
    </div>
  );
}

function Ago({ ts }: { ts: string | null }) {
  return <>{useAgo(ts)}</>;
}

function TestDrawer({ test: x, onClose, onChanged }: { test: TestRow | null; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { canManage } = useTrustAccess();
  const people = usePeople();
  const history = usePlatformQuery<Run[]>(x ? `/trust/tests/${x.key}/history?days=90` : null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!x) return;
    setBusy(true);
    try {
      await papi('/trust/tests/run', { method: 'POST', body: { keys: [x.key] } });
      onChanged();
      await history.reload();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  }
  async function patch(body: object) {
    if (!x) return;
    try {
      await papi(`/trust/tests/${x.key}`, { method: 'PATCH', body });
      toast(t('trust.saved'), 'ok');
      onChanged();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    }
  }
  const details = detailRows(x?.details, t, i18n.language);
  return (
    <Drawer open={!!x} onClose={onClose} title={x ? pick(x, 'title', i18n.language) : ''} subtitle={x ? <StatusPill tone={testTone(x.status)}>{t(`trust.testStatus.${x.status ?? 'NONE'}`)}</StatusPill> : null}
      footer={canManage ? <Button loading={busy} icon={<Play className="h-4 w-4" aria-hidden="true" />} onClick={() => void run()}>{t('trust.tests.runNow')}</Button> : undefined}>
      {x ? (
        <>
          <p className="text-body">{summaryOf(x, i18n.language)}</p>
          {details.length ? (
            <section aria-label={t('trust.testDetails.heading')}>
              <Facts items={details.map((d) => [d.label, Array.isArray(d.value) ? (
                <ul className="grid gap-0.5">{d.value.map((v, i) => <li key={i}>{v}</li>)}</ul>
              ) : d.value])} />
            </section>
          ) : null}
          <p className="text-small">{t('trust.tests.controls')}{colon(i18n.language)}{x.controls.map((k, i) => <span key={k}>{i ? ', ' : ''}<Link href={`/platform/trust/controls?id=${k}`} className="font-semibold text-brand-text hover:underline">{k}</Link></span>)}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('trust.table.owner')} hint={t('trust.tests.ownerHint')}>{(p) => <Select {...p} disabled={!canManage} value={x.ownerId ?? ''} onChange={(e) => void patch({ ownerId: e.target.value || null })}><option value="">{t('trust.unassigned')}</option>{people.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
            <Field label={t('trust.tests.enabled')}>{(p) => <Select {...p} disabled={!canManage} value={x.enabled ? 'on' : 'off'} onChange={(e) => void patch({ enabled: e.target.value === 'on' })}><option value="on">{t('trust.tests.on')}</option><option value="off">{t('trust.tests.off')}</option></Select>}</Field>
          </div>
          <div>
            <h3 className="text-small font-semibold">{t('trust.tests.history')}</h3>
            <p className="text-caption text-muted">{t('trust.tests.historyHelp')}</p>
            {!history.data ? <Skeleton className="mt-2 h-24" /> : (
              <ol className="mt-2 grid gap-1.5">
                {history.data.slice(0, 40).map((r) => (
                  <li key={r.id} className="flex items-start gap-2 text-small">
                    <StatusPill tone={testTone(r.status)}>{t(`trust.testStatus.${r.status}`)}</StatusPill>
                    <span className="min-w-0 flex-1"><time dateTime={r.at} className="text-muted">{new Date(r.at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}</time> · {summaryOf(r, i18n.language)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
