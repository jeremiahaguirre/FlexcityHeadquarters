'use client';

import { Plus, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeatMap, levelStyle } from '@/components/platform/trust/charts';
import { useParam, usePeople, useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, TrustTabs, errorText, useDate } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { papi, usePlatformQuery } from '@/lib/platform';
import { daysLeft, pick } from '@/lib/trust';

interface Risk { id: string; ref: string; title: string; titleFr: string | null; category: string; description: string; likelihood: number; impact: number; residualLikelihood: number; residualImpact: number; treatment: string; treatmentPlan: string | null; ownerId: string | null; owner: string | null; controlKeys: string[]; dueAt: string | null; reviewEveryDays: number; lastReviewedAt: string | null; status: 'OPEN' | 'CLOSED'; inherent: number; residual: number; level: 'low' | 'medium' | 'high'; reviewDue: string }
const CATS = ['tenant', 'access', 'continuity', 'vendor', 'logging', 'crypto', 'governance', 'privacy', 'people'] as const;
const blank = { title: '', category: 'access', description: '', likelihood: 3, impact: 3, residualLikelihood: 2, residualImpact: 3, treatment: 'MITIGATE', treatmentPlan: '', ownerId: '', controlKeys: '', dueAt: '', reviewEveryDays: 90, status: 'OPEN' };

/** Trust: the risk register as a heat map and a table: how likely, how bad, and what is being done. */
export default function RisksPage() {
  const { t, i18n } = useTranslation();
  const date = useDate();
  const { canManage } = useTrustAccess();
  const data = usePlatformQuery<{ riskAppetite: number; risks: Risk[] }>('/trust/risks');
  const id = useParam('id');
  const [open, setOpen] = useState<Risk | 'new' | null>(null);
  const [mode, setMode] = useState<'residual' | 'inherent'>('residual');
  const [cell, setCell] = useState<{ likelihood: number; impact: number } | null>(null);
  useEffect(() => {
    if (id && data.data) setOpen(data.data.risks.find((r) => r.id === id) ?? null);
  }, [id, data.data]);
  const openRisks = (data.data?.risks ?? []).filter((r) => r.status === 'OPEN');
  const rows = (data.data?.risks ?? []).filter((r) => !cell || (mode === 'residual' ? r.residualLikelihood === cell.likelihood && r.residualImpact === cell.impact : r.likelihood === cell.likelihood && r.impact === cell.impact));
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.risks')} description={t('trust.risks.description')}
        actions={canManage ? <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen('new')}>{t('trust.risks.add')}</Button> : undefined} />
      <TrustTabs />
      {!data.data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-4">
          <Card>
            <CardHeader title={t('trust.heat.title')} description={t('trust.risks.appetite', { score: data.data.riskAppetite })} action={<Segmented label={t('trust.heat.mode')} value={mode} onChange={(v) => (setMode(v), setCell(null))} options={[{ value: 'residual', label: t('trust.risk.residual') }, { value: 'inherent', label: t('trust.risk.inherent') }]} />} />
            <CardBody className="max-w-xl">
              <HeatMap risks={openRisks.map((r) => ({ ...r, score: r.residual }))} appetite={data.data.riskAppetite} mode={mode} selected={cell} onCell={(c) => setCell(cell && cell.likelihood === c.likelihood && cell.impact === c.impact ? null : c)} />
              {cell ? <p className="mt-3 text-small">{t('trust.heat.selected', { likelihood: cell.likelihood, impact: cell.impact })} · <button type="button" className="font-semibold text-brand-text hover:underline" onClick={() => setCell(null)}>{t('trust.table.clear')}</button></p> : null}
            </CardBody>
          </Card>
          <DataTable<Risk>
            label={t('trust.section.risks')}
            rows={rows}
            rowKey={(r) => r.id}
            onOpen={setOpen}
            emptyIcon={ShieldAlert}
            emptyTitle={t('trust.table.none')}
            initialSort={{ key: 'residual', dir: 'desc' }}
            filters={[
              { key: 'level', label: t('trust.risks.level'), options: (['high', 'medium', 'low'] as const).map((l) => ({ value: l, label: t(`trust.level.${l}`) })), value: (r) => r.level },
              { key: 'treatment', label: t('trust.risks.treatment'), options: (['MITIGATE', 'ACCEPT', 'TRANSFER', 'AVOID'] as const).map((x) => ({ value: x, label: t(`trust.treatment.${x}`) })), value: (r) => r.treatment },
              { key: 'status', label: t('trust.table.status'), options: [{ value: 'OPEN', label: t('trust.risks.open') }, { value: 'CLOSED', label: t('trust.risks.closed') }], value: (r) => r.status },
            ]}
            columns={[
              { key: 'ref', label: t('trust.table.id'), value: (r) => r.ref, className: 'whitespace-nowrap' },
              { key: 'title', label: t('trust.table.title'), value: (r) => pick(r, 'title', i18n.language) },
              { key: 'inherent', label: t('trust.risk.inherent'), value: (r) => r.inherent, render: (r) => <span className="tabular-nums">{r.likelihood}×{r.impact} = {r.inherent}</span>, wide: true },
              { key: 'residual', label: t('trust.risk.residual'), value: (r) => r.residual, render: (r) => <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums', levelStyle[r.level])}>{r.residual} · {t(`trust.level.${r.level}`)}</span> },
              { key: 'treatment', label: t('trust.risks.treatment'), value: (r) => t(`trust.treatment.${r.treatment}`) },
              { key: 'owner', label: t('trust.table.owner'), value: (r) => r.owner ?? '', render: (r) => r.owner ?? <span className="text-muted">{t('trust.unassigned')}</span>, wide: true },
              { key: 'due', label: t('trust.table.due'), value: (r) => r.dueAt ?? '', render: (r) => (r.dueAt ? <span className={cn(daysLeft(r.dueAt) < 0 && r.status === 'OPEN' && 'font-semibold text-danger')}>{date(r.dueAt)}</span> : '—') },
            ]}
          />
        </div>
      )}
      <RiskDrawer risk={open} onClose={() => setOpen(null)} onSaved={() => void data.reload()} canManage={canManage} />
    </div>
  );
}

function RiskDrawer({ risk, onClose, onSaved, canManage }: { risk: Risk | 'new' | null; onClose: () => void; onSaved: () => void; canManage: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const date = useDate();
  const people = usePeople();
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const r = risk && risk !== 'new' ? risk : null;
  useEffect(() => {
    if (risk === 'new') setF(blank);
    else if (risk) setF({ title: risk.title, category: risk.category, description: risk.description, likelihood: risk.likelihood, impact: risk.impact, residualLikelihood: risk.residualLikelihood, residualImpact: risk.residualImpact, treatment: risk.treatment, treatmentPlan: risk.treatmentPlan ?? '', ownerId: risk.ownerId ?? '', controlKeys: risk.controlKeys.join(', '), dueAt: risk.dueAt?.slice(0, 10) ?? '', reviewEveryDays: risk.reviewEveryDays, status: risk.status });
  }, [risk]);
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, ownerId: f.ownerId || null, treatmentPlan: f.treatmentPlan || null, dueAt: f.dueAt || null, controlKeys: f.controlKeys.split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase()) };
      await papi(r ? `/trust/risks/${r.id}` : '/trust/risks', { method: r ? 'PATCH' : 'POST', body });
      toast(t('trust.saved'), 'ok');
      onSaved();
      onClose();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  }
  async function reviewed() {
    if (!r) return;
    await papi(`/trust/risks/${r.id}/review`, { method: 'POST' }).then(() => (toast(t('trust.saved'), 'ok'), onSaved())).catch((e) => toast(errorText(e, t), 'warn'));
  }
  const lvl = (k: 'likelihood' | 'impact' | 'residualLikelihood' | 'residualImpact') => (
    <Field label={t(`trust.risks.${k}`)}>{(p) => <Select {...p} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} · {t(`trust.scale.${k.toLowerCase().includes('impact') ? 'impact' : 'likelihood'}.${n}`)}</option>)}</Select>}</Field>
  );
  return (
    <Drawer open={!!risk} onClose={onClose} title={r ? `${r.ref} · ${r.title}` : t('trust.risks.add')} subtitle={r ? t('trust.risks.reviewed', { date: date(r.lastReviewedAt), next: date(r.reviewDue) }) : null}
      footer={canManage ? <>{r ? <Button variant="ghost" onClick={() => void reviewed()}>{t('trust.risks.markReviewed')}</Button> : null}<Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={f.title.length < 1 || f.description.length < 1} onClick={() => void save()}>{t('common.save')}</Button></> : undefined}>
      <fieldset disabled={!canManage} className="grid gap-3">
        <Field label={t('trust.table.title')}>{(p) => <Input {...p} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label={t('trust.risks.descriptionLabel')}>{(p) => <Textarea {...p} rows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('trust.table.category')}>{(p) => <Select {...p} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{t(`trust.riskCategory.${c}`)}</option>)}</Select>}</Field>
          <Field label={t('trust.risks.treatment')}>{(p) => <Select {...p} value={f.treatment} onChange={(e) => setF({ ...f, treatment: e.target.value })}>{(['MITIGATE', 'ACCEPT', 'TRANSFER', 'AVOID'] as const).map((x) => <option key={x} value={x}>{t(`trust.treatment.${x}`)}</option>)}</Select>}</Field>
          {lvl('likelihood')}{lvl('impact')}{lvl('residualLikelihood')}{lvl('residualImpact')}
        </div>
        <p className="text-small text-muted">{t('trust.risks.scores', { inherent: f.likelihood * f.impact, residual: f.residualLikelihood * f.residualImpact })}</p>
        <Field label={t('trust.risks.plan')}>{(p) => <Textarea {...p} rows={3} maxLength={4000} value={f.treatmentPlan} onChange={(e) => setF({ ...f, treatmentPlan: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('trust.table.owner')}>{(p) => <Select {...p} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">{t('trust.unassigned')}</option>{people.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
          <Field label={t('trust.table.due')}>{(p) => <Input {...p} type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} />}</Field>
          <Field label={t('trust.risks.controls')} hint={t('trust.risks.controlsHint')}>{(p) => <Input {...p} value={f.controlKeys} onChange={(e) => setF({ ...f, controlKeys: e.target.value })} autoCapitalize="characters" />}</Field>
          <Field label={t('trust.risks.reviewEvery')}>{(p) => <Select {...p} value={String(f.reviewEveryDays)} onChange={(e) => setF({ ...f, reviewEveryDays: Number(e.target.value) })}>{[30, 90, 180, 365].map((d) => <option key={d} value={d}>{t('trust.days', { count: d })}</option>)}</Select>}</Field>
          <Field label={t('trust.table.status')}>{(p) => <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="OPEN">{t('trust.risks.open')}</option><option value="CLOSED">{t('trust.risks.closed')}</option></Select>}</Field>
        </div>
        {r ? <p className="text-caption text-muted"><StatusPill tone={r.level === 'high' ? 'danger' : r.level === 'medium' ? 'warn' : 'ok'}>{t(`trust.level.${r.level}`)}</StatusPill></p> : null}
      </fieldset>
    </Drawer>
  );
}
