'use client';

import { Plus, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VendorBars } from '@/components/platform/trust/charts';
import { useParam, usePeople, useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, TrustTabs, errorText, useDate } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { papi, usePlatformQuery } from '@/lib/platform';
import { daysLeft, pick } from '@/lib/trust';

interface Vendor { id: string; name: string; purpose: string; purposeFr: string | null; criticality: string; dataAccessed: string; personalInfo: boolean; dataLocation: string; inCanada: boolean; website: string | null; dpaSignedAt: string | null; dpaExpiresAt: string | null; soc2ExpiresAt: string | null; isoExpiresAt: string | null; reviewEveryMonths: number; lastReviewedAt: string | null; nextReviewAt: string | null; status: string; questionnaire: Record<string, string> | null; score: number | null; ownerId: string | null; owner: string | null; notes: string | null; risk: 'low' | 'medium' | 'high'; risks: string[] }
const DATES = ['dpaSignedAt', 'dpaExpiresAt', 'soc2ExpiresAt', 'isoExpiresAt', 'nextReviewAt'] as const;
const d10 = (v: string | null) => v?.slice(0, 10) ?? '';

/** A date cell: red once past, amber within 30 days. */
function Due({ at }: { at: string | null }) {
  const date = useDate();
  if (!at) return <span className="text-muted">—</span>;
  const left = daysLeft(at);
  return <span className={cn('tabular-nums', left < 0 ? 'font-semibold text-danger' : left <= 30 ? 'font-semibold text-warn' : '')}>{date(at)}</span>;
}

export default function VendorsPage() {
  const { t, i18n } = useTranslation();
  const { canManage } = useTrustAccess();
  const data = usePlatformQuery<{ questions: string[]; vendors: Vendor[] }>('/trust/vendors');
  const id = useParam('id');
  const [open, setOpen] = useState<Vendor | 'new' | null>(null);
  useEffect(() => {
    if (id && data.data) setOpen(data.data.vendors.find((v) => v.id === id) ?? null);
  }, [id, data.data]);
  const vs = data.data?.vendors ?? [];
  const active = vs.filter((v) => v.status !== 'OFFBOARDED');
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.vendors')} description={t('trust.vendors.description')}
        actions={canManage ? <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen('new')}>{t('trust.vendors.add')}</Button> : undefined} />
      <TrustTabs />
      {!data.data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-4">
          <Card><CardBody className="grid gap-2"><h2 className="text-subheading">{t('trust.vendorRisk')}</h2><VendorBars dist={{ low: active.filter((v) => v.risk === 'low').length, medium: active.filter((v) => v.risk === 'medium').length, high: active.filter((v) => v.risk === 'high').length }} /></CardBody></Card>
          <DataTable<Vendor>
            label={t('trust.section.vendors')}
            rows={vs}
            rowKey={(v) => v.id}
            onOpen={setOpen}
            emptyIcon={Store}
            emptyTitle={t('trust.table.none')}
            filters={[
              { key: 'crit', label: t('trust.vendors.criticality'), options: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((c) => ({ value: c, label: t(`trust.crit.${c}`) })), value: (v) => v.criticality },
              { key: 'status', label: t('trust.table.status'), options: (['ACTIVE', 'PROPOSED', 'OFFBOARDED'] as const).map((s) => ({ value: s, label: t(`trust.vendorStatus.${s}`) })), value: (v) => v.status },
              { key: 'ca', label: t('trust.vendors.location'), options: [{ value: 'ca', label: t('trust.vendors.canada') }, { value: 'out', label: t('trust.vendors.outside') }], value: (v) => (v.inCanada ? 'ca' : 'out') },
            ]}
            columns={[
              { key: 'name', label: t('trust.vendors.vendor'), value: (v) => v.name },
              { key: 'crit', label: t('trust.vendors.criticality'), value: (v) => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 })[v.criticality] ?? 4, render: (v) => t(`trust.crit.${v.criticality}`) },
              { key: 'risk', label: t('trust.vendors.risk'), value: (v) => ({ high: 0, medium: 1, low: 2 })[v.risk], render: (v) => <StatusPill tone={v.risk === 'high' ? 'danger' : v.risk === 'medium' ? 'warn' : 'ok'}>{t(`trust.level.${v.risk}`)}</StatusPill> },
              { key: 'loc', label: t('trust.vendors.location'), value: (v) => v.dataLocation, render: (v) => <span>{v.dataLocation}{v.inCanada ? <span className="ml-1.5"><StatusPill tone="ok">{t('trust.vendors.canada')}</StatusPill></span> : null}</span>, wide: true },
              { key: 'score', label: t('trust.vendors.score'), value: (v) => v.score ?? -1, render: (v) => (v.score === null ? <span className="text-muted">—</span> : <span className="tabular-nums">{v.score}</span>) },
              { key: 'soc2', label: t('trust.vendors.soc2'), value: (v) => v.soc2ExpiresAt ?? '', render: (v) => <Due at={v.soc2ExpiresAt} />, wide: true },
              { key: 'review', label: t('trust.vendors.nextReview'), value: (v) => v.nextReviewAt ?? '', render: (v) => <Due at={v.nextReviewAt} /> },
              { key: 'status', label: t('trust.table.status'), value: (v) => v.status, render: (v) => t(`trust.vendorStatus.${v.status}`), wide: true },
            ]}
          />
        </div>
      )}
      <VendorDrawer vendor={open} questions={data.data?.questions ?? []} onClose={() => setOpen(null)} onSaved={() => void data.reload()} canManage={canManage} lang={i18n.language} />
    </div>
  );
}

const blank = { name: '', purpose: '', purposeFr: '', criticality: 'MEDIUM', dataAccessed: '', personalInfo: false, dataLocation: '', inCanada: false, reviewEveryMonths: 12, status: 'ACTIVE', ownerId: '', notes: '', dpaSignedAt: '', dpaExpiresAt: '', soc2ExpiresAt: '', isoExpiresAt: '', nextReviewAt: '', questionnaire: {} as Record<string, string> };

function VendorDrawer({ vendor, questions, onClose, onSaved, canManage, lang }: { vendor: Vendor | 'new' | null; questions: string[]; onClose: () => void; onSaved: () => void; canManage: boolean; lang: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const date = useDate();
  const people = usePeople();
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const v = vendor && vendor !== 'new' ? vendor : null;
  useEffect(() => {
    if (vendor === 'new') setF(blank);
    else if (vendor) setF({ name: vendor.name, purpose: vendor.purpose, purposeFr: vendor.purposeFr ?? '', criticality: vendor.criticality, dataAccessed: vendor.dataAccessed, personalInfo: vendor.personalInfo, dataLocation: vendor.dataLocation, inCanada: vendor.inCanada, reviewEveryMonths: vendor.reviewEveryMonths, status: vendor.status, ownerId: vendor.ownerId ?? '', notes: vendor.notes ?? '', dpaSignedAt: d10(vendor.dpaSignedAt), dpaExpiresAt: d10(vendor.dpaExpiresAt), soc2ExpiresAt: d10(vendor.soc2ExpiresAt), isoExpiresAt: d10(vendor.isoExpiresAt), nextReviewAt: d10(vendor.nextReviewAt), questionnaire: vendor.questionnaire ?? {} });
  }, [vendor]);
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, questionnaire: Object.fromEntries(Object.entries(f.questionnaire).filter(([, a]) => a)), purposeFr: f.purposeFr || null, ownerId: f.ownerId || null, notes: f.notes || null, ...Object.fromEntries(DATES.map((k) => [k, f[k] || null])) };
      await papi(v ? `/trust/vendors/${v.id}` : '/trust/vendors', { method: v ? 'PATCH' : 'POST', body });
      toast(t('trust.saved'), 'ok');
      onSaved();
      onClose();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setBusy(false);
    }
  }
  const reviewed = () => v && void papi(`/trust/vendors/${v.id}/review`, { method: 'POST' }).then(() => (toast(t('trust.saved'), 'ok'), onSaved(), onClose())).catch((e) => toast(errorText(e, t), 'warn'));
  const txt = (k: 'name' | 'purpose' | 'purposeFr' | 'dataAccessed' | 'dataLocation', max = 300) => <Field label={t(`trust.vendors.f.${k}`)}>{(p) => <Input {...p} maxLength={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>;
  return (
    <Drawer open={!!vendor} onClose={onClose} title={v ? v.name : t('trust.vendors.add')} subtitle={v ? `${pick(v, 'purpose', lang)} · ${t('trust.vendors.lastReview', { date: date(v.lastReviewedAt) })}` : null}
      footer={canManage ? <>{v ? <Button variant="ghost" onClick={reviewed}>{t('trust.vendors.markReviewed')}</Button> : null}<Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={!f.name || !f.purpose || !f.dataAccessed || !f.dataLocation} onClick={() => void save()}>{t('common.save')}</Button></> : undefined}>
      <fieldset disabled={!canManage} className="grid gap-3">
        {txt('name', 120)}{txt('purpose')}{txt('purposeFr')}{txt('dataAccessed')}
        <div className="grid gap-3 sm:grid-cols-2">
          {txt('dataLocation', 160)}
          <Field label={t('trust.vendors.criticality')}>{(p) => <Select {...p} value={f.criticality} onChange={(e) => setF({ ...f, criticality: e.target.value })}>{(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((c) => <option key={c} value={c}>{t(`trust.crit.${c}`)}</option>)}</Select>}</Field>
          <label className="flex min-h-[44px] items-center gap-2 text-small"><input type="checkbox" className="h-5 w-5" checked={f.inCanada} onChange={(e) => setF({ ...f, inCanada: e.target.checked })} />{t('trust.vendors.f.inCanada')}</label>
          <label className="flex min-h-[44px] items-center gap-2 text-small"><input type="checkbox" className="h-5 w-5" checked={f.personalInfo} onChange={(e) => setF({ ...f, personalInfo: e.target.checked })} />{t('trust.vendors.f.personalInfo')}</label>
          {DATES.map((k) => <Field key={k} label={t(`trust.vendors.f.${k}`)}>{(p) => <Input {...p} type="date" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>)}
          <Field label={t('trust.vendors.f.reviewEvery')}>{(p) => <Select {...p} value={String(f.reviewEveryMonths)} onChange={(e) => setF({ ...f, reviewEveryMonths: Number(e.target.value) })}>{[6, 12, 24].map((m) => <option key={m} value={m}>{t('trust.months', { count: m })}</option>)}</Select>}</Field>
          <Field label={t('trust.table.status')}>{(p) => <Select {...p} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{(['PROPOSED', 'ACTIVE', 'OFFBOARDED'] as const).map((s) => <option key={s} value={s}>{t(`trust.vendorStatus.${s}`)}</option>)}</Select>}</Field>
          <Field label={t('trust.table.owner')}>{(p) => <Select {...p} value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">{t('trust.unassigned')}</option>{people.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
        </div>
        <section className="grid gap-2">
          <h3 className="text-small font-semibold">{t('trust.vendors.questionnaire')}{v?.score !== null && v?.score !== undefined ? ` · ${t('trust.vendors.scoreOf', { score: v.score })}` : ''}</h3>
          {questions.map((q) => (
            <div key={q} className="grid items-center gap-1 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <label htmlFor={`q-${q}`} className="text-small">{t(`trust.vendors.q.${q}`)}</label>
              <Select id={`q-${q}`} value={f.questionnaire[q] ?? ''} onChange={(e) => setF({ ...f, questionnaire: { ...f.questionnaire, [q]: e.target.value } })}>
                <option value="">—</option>
                {(['yes', 'partial', 'no', 'na'] as const).map((a) => <option key={a} value={a}>{t(`trust.answer.${a}`)}</option>)}
              </Select>
            </div>
          ))}
        </section>
        <Field label={t('trust.notes')}>{(p) => <Textarea {...p} rows={3} maxLength={4000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        {v?.risks.length ? <p className="text-small">{t('trust.vendors.linkedRisks')}: {v.risks.join(', ')}</p> : null}
      </fieldset>
    </Drawer>
  );
}
