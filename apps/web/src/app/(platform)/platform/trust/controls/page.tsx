'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParam, usePeople, useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, Facts, TrustTabs, errorText, useDate } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { papi, usePlatformQuery } from '@/lib/platform';
import { FRAMEWORK_KEYS, controlTone, pick, testTone, type ControlStatus, type TestStatus } from '@/lib/trust';

export interface ControlRow {
  key: string; category: string; title: string; titleFr: string; description: string; descriptionFr: string; tests: string[]; evidenceDays?: number; evidenceHint?: string; evidenceHintFr?: string; inherited?: boolean; maps: string[];
  status: ControlStatus; frameworks: string[]; ownerId: string | null; owner: string | null; manualStatus: ControlStatus | null; justification: string | null; notes: string | null; evidenceCount: number; lastEvidenceAt: string | null;
  testResults: Array<{ key: string; title: string; titleFr: string; status: TestStatus | null }>;
}

/** Trust: FH's controls, how each is proven (live tests, evidence) and who owns it. */
export default function ControlsPage() {
  const { t, i18n } = useTranslation();
  const L = i18n.language;
  const date = useDate();
  const data = usePlatformQuery<ControlRow[]>('/trust/controls');
  const id = useParam('id');
  const status = useParam('status');
  const [open, setOpen] = useState<ControlRow | null>(null);
  useEffect(() => {
    if (id && data.data) setOpen(data.data.find((c) => c.key === id) ?? null);
  }, [id, data.data]);
  const rows = (data.data ?? []).filter((c) => !status || c.status === status);
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.controls')} description={t('trust.controls.description')} />
      <TrustTabs />
      {status ? <p className="mb-3 text-small">{t('trust.controls.filtered', { status: t(`trust.status.${status}`) })} <Link href="/platform/trust/controls" className="font-semibold text-brand-text hover:underline">{t('trust.table.clear')}</Link></p> : null}
      {!data.data ? <Skeleton className="h-96" /> : (
        <DataTable<ControlRow>
          label={t('trust.section.controls')}
          rows={rows}
          rowKey={(c) => c.key}
          onOpen={setOpen}
          emptyIcon={ShieldCheck}
          emptyTitle={t('trust.table.none')}
          filters={[
            { key: 'status', label: t('trust.table.status'), options: (['PASSING', 'NEEDS_EVIDENCE', 'FAILING', 'NOT_APPLICABLE'] as const).map((s) => ({ value: s, label: t(`trust.status.${s}`) })), value: (c) => c.status },
            { key: 'fw', label: t('trust.table.framework'), options: FRAMEWORK_KEYS.map((k) => ({ value: k, label: t(`trust.fw.${k}`) })), value: (c) => c.frameworks },
            { key: 'cat', label: t('trust.table.category'), options: [...new Set((data.data ?? []).map((c) => c.category))].map((k) => ({ value: k, label: t(`trust.category.${k}`) })), value: (c) => c.category },
          ]}
          columns={[
            { key: 'key', label: t('trust.table.id'), value: (c) => c.key, className: 'whitespace-nowrap' },
            { key: 'title', label: t('trust.table.title'), value: (c) => pick(c, 'title', L) },
            { key: 'category', label: t('trust.table.category'), value: (c) => t(`trust.category.${c.category}`), wide: true },
            { key: 'fw', label: t('trust.table.framework'), value: (c) => c.frameworks.map((k) => t(`trust.fw.${k}`)).join(', '), render: (c) => <span className="flex flex-wrap gap-1">{c.frameworks.map((k) => <span key={k} className="rounded-md bg-surface px-1.5 py-0.5 text-caption">{t(`trust.fw.${k}`)}</span>)}</span>, wide: true },
            { key: 'owner', label: t('trust.table.owner'), value: (c) => c.owner ?? '' , render: (c) => c.owner ?? <span className="text-muted">{t('trust.unassigned')}</span> },
            { key: 'proof', label: t('trust.controls.proof'), value: (c) => c.tests.length, render: (c) => <span className="text-muted">{c.tests.length ? t('trust.controls.tests', { count: c.tests.length }) : ''}{c.tests.length && c.evidenceDays ? ' · ' : ''}{c.evidenceDays ? t('trust.controls.evidenceEvery', { count: c.evidenceDays }) : ''}{c.inherited ? ` · ${t('trust.controls.inherited')}` : ''}</span>, wide: true },
            { key: 'status', label: t('trust.table.status'), value: (c) => c.status, render: (c) => <StatusPill tone={controlTone[c.status]}>{t(`trust.status.${c.status}`)}</StatusPill> },
          ]}
        />
      )}
      <ControlDrawer control={open} onClose={() => setOpen(null)} onSaved={() => void data.reload()} date={date} />
    </div>
  );
}

function ControlDrawer({ control: c, onClose, onSaved, date }: { control: ControlRow | null; onClose: () => void; onSaved: () => void; date: (d: string | null) => string }) {
  const { t, i18n } = useTranslation();
  const L = i18n.language;
  const toast = useToast();
  const { canManage } = useTrustAccess();
  const people = usePeople();
  const [form, setForm] = useState({ ownerId: '', manualStatus: '', justification: '', notes: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c) setForm({ ownerId: c.ownerId ?? '', manualStatus: c.manualStatus ?? '', justification: c.justification ?? '', notes: c.notes ?? '' });
  }, [c]);
  async function save() {
    if (!c) return;
    setBusy(true);
    try {
      await papi(`/trust/controls/${c.key}`, { method: 'PATCH', body: { ownerId: form.ownerId || null, manualStatus: form.manualStatus || null, justification: form.justification || null, notes: form.notes || null } });
      toast(t('trust.saved'), 'ok');
      onSaved();
      onClose();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer open={!!c} onClose={onClose} title={c ? `${c.key} · ${pick(c, 'title', L)}` : ''} subtitle={c ? <StatusPill tone={controlTone[c.status]}>{t(`trust.status.${c.status}`)}</StatusPill> : null}
      footer={canManage ? <><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={() => void save()}>{t('common.save')}</Button></> : undefined}>
      {c ? (
        <>
          <p className="text-small">{pick(c, 'description', L)}</p>
          <Facts items={[
            [t('trust.table.category'), t(`trust.category.${c.category}`)],
            [t('trust.controls.evidence'), c.evidenceCount ? t('trust.controls.evidenceCount', { count: c.evidenceCount, date: date(c.lastEvidenceAt) }) : t('trust.controls.noEvidence')],
            [t('trust.controls.renew'), c.evidenceDays ? t('trust.controls.evidenceEvery', { count: c.evidenceDays }) : t('trust.controls.byTests')],
            [t('trust.controls.hint'), pick(c, 'evidenceHint', L) || '—'],
          ]} />
          {c.testResults.length ? (
            <div>
              <h3 className="text-small font-semibold">{t('trust.section.tests')}</h3>
              <ul className="mt-2 grid gap-1.5">{c.testResults.map((r) => <li key={r.key}><Link href={`/platform/trust/tests?test=${r.key}`} className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-line px-3 text-small hover:bg-surface"><span>{pick(r, 'title', L)}</span><StatusPill tone={testTone(r.status)}>{t(`trust.testStatus.${r.status ?? 'NONE'}`)}</StatusPill></Link></li>)}</ul>
            </div>
          ) : null}
          <div>
            <h3 className="text-small font-semibold">{t('trust.controls.mapsTo')}</h3>
            <p className="mt-1 flex flex-wrap gap-1">{c.maps.map((m) => <span key={m} className="rounded-md bg-surface px-1.5 py-0.5 text-caption">{t(`trust.fw.${m.split(':')[0]}`)} {m.split(':')[1]}</span>)}</p>
          </div>
          <p><Link href={`/platform/trust/evidence?control=${c.key}`} className="text-small font-semibold text-brand-text hover:underline">{t('trust.controls.addEvidence')}</Link></p>
          <fieldset disabled={!canManage} className="grid gap-3">
            <Field label={t('trust.table.owner')}>{(p) => <Select {...p} value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}><option value="">{t('trust.unassigned')}</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
            <Field label={t('trust.controls.manual')} hint={t('trust.controls.manualHint')}>{(p) => <Select {...p} value={form.manualStatus} onChange={(e) => setForm({ ...form, manualStatus: e.target.value })}><option value="">{t('trust.controls.automatic')}</option>{(['NOT_APPLICABLE', 'PASSING', 'FAILING', 'NEEDS_EVIDENCE'] as const).map((s) => <option key={s} value={s}>{t(`trust.status.${s}`)}</option>)}</Select>}</Field>
            <Field label={t('trust.controls.justification')}>{(p) => <Textarea {...p} rows={2} maxLength={1000} value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} />}</Field>
            <Field label={t('trust.notes')}>{(p) => <Textarea {...p} rows={3} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
          </fieldset>
        </>
      ) : null}
    </Drawer>
  );
}
