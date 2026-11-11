'use client';

import { Download, Info, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trustDownload, useParam, useTrustAccess } from '@/components/platform/trust/hooks';
import { DataTable, Drawer, TrustTabs, errorText } from '@/components/platform/trust/ui';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { usePlatformQuery } from '@/lib/platform';
import { controlTone, fr, pick, type ControlStatus, type FrameworkKey } from '@/lib/trust';

interface Req { id: string; title: string; titleFr: string; group: string; na?: string; controls: Array<{ key: string; status: ControlStatus }> }
interface Fw { key: FrameworkKey; name: string; nameFr: string; description: string; descriptionFr: string; note: string | null; noteFr: string | null; optional: boolean; readiness: number; met: number; partial: number; gaps: number; uncovered: number; notApplicable: number; total: number; requirements: Req[] }
type ReqState = 'met' | 'partial' | 'gap' | 'na';
const stateOf = (r: Req): ReqState => {
  if (r.na) return 'na';
  const app = r.controls.filter((c) => c.status !== 'NOT_APPLICABLE');
  if (r.controls.length && !app.length) return 'na';
  const pass = app.filter((c) => c.status === 'PASSING').length;
  return app.length && pass === app.length ? 'met' : pass ? 'partial' : 'gap';
};
const TONE = { met: 'ok', partial: 'warn', gap: 'danger', na: 'neutral' } as const;

export default function FrameworksPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { canManage } = useTrustAccess();
  const data = usePlatformQuery<Fw[]>('/trust/frameworks');
  const param = useParam('f');
  const [sel, setSel] = useState<FrameworkKey>('soc2');
  const [open, setOpen] = useState<Req | null>(null);
  useEffect(() => {
    if (param) setSel(param as FrameworkKey);
  }, [param]);
  const fw = data.data?.find((f) => f.key === sel);
  const L = i18n.language;
  async function exportZip() {
    try {
      await trustDownload(`/trust/export/${sel}.zip`, `fh-${sel}-evidence.zip`);
    } catch (e) {
      toast(errorText(e, t), 'warn');
    }
  }
  return (
    <div>
      <PageHeader eyebrow={t('trust.nav')} title={t('trust.section.frameworks')} description={t('trust.frameworks.description')} />
      <TrustTabs />
      {!data.data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((f) => (
              <button key={f.key} type="button" aria-pressed={sel === f.key} onClick={() => setSel(f.key)} className={cn('rounded-xl2 border bg-panel p-4 text-left shadow-card transition-colors', sel === f.key ? 'border-brand-text ring-1 ring-brand-text' : 'border-line hover:border-ink/30')}>
                <span className="flex items-baseline justify-between gap-2"><span className="text-body-strong">{fr(L) ? f.nameFr : f.name}</span><span className="text-heading tabular-nums">{f.readiness}%</span></span>
                <span className="mt-2 block h-2 overflow-hidden rounded-full bg-surface"><span className="block h-full rounded-full bg-brand-text" style={{ width: `${f.readiness}%` }} /></span>
                <span className="mt-2 block text-caption text-muted">{t('trust.frameworks.counts', { met: f.met, partial: f.partial, gaps: f.gaps, na: f.notApplicable })}</span>
                {f.optional ? <span className="mt-2 inline-block"><StatusPill tone="neutral">{t('trust.frameworks.optional')}</StatusPill></span> : null}
              </button>
            ))}
          </div>
          {fw ? (
            <>
              <Card>
                <CardBody className="grid gap-3">
                  <p className="text-small">{pick(fw, 'description', L)}</p>
                  {fw.note ? <p className="flex gap-2 rounded-xl bg-surface p-3 text-small"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden="true" /><span>{pick(fw, 'note', L)}</span></p> : null}
                  <p className="text-caption text-muted">{t('trust.frameworks.notCertified')}</p>
                  {canManage ? <div><Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void exportZip()}>{t('trust.frameworks.export')}</Button></div> : null}
                </CardBody>
              </Card>
              <DataTable<Req>
                key={fw.key}
                label={t('trust.frameworks.requirements', { name: fw.name })}
                rows={fw.requirements}
                rowKey={(r) => r.id}
                onOpen={setOpen}
                emptyIcon={ListChecks}
                emptyTitle={t('trust.table.none')}
                filters={[
                  { key: 'state', label: t('trust.frameworks.state'), options: (['met', 'partial', 'gap', 'na'] as const).map((s) => ({ value: s, label: t(`trust.req.${s}`) })), value: stateOf },
                  { key: 'group', label: t('trust.frameworks.group'), options: [...new Set(fw.requirements.map((r) => r.group))].map((g) => ({ value: g, label: g })), value: (r) => r.group },
                ]}
                columns={[
                  { key: 'id', label: t('trust.frameworks.requirement'), value: (r) => r.id, className: 'whitespace-nowrap' },
                  { key: 'title', label: t('trust.table.title'), value: (r) => pick(r, 'title', L), wide: true },
                  { key: 'group', label: t('trust.frameworks.group'), value: (r) => r.group, wide: true },
                  { key: 'controls', label: t('trust.section.controls'), value: (r) => r.controls.map((c) => c.key).join(' '), render: (r) => <span className="flex flex-wrap gap-1">{r.controls.map((c) => <StatusPill key={c.key} tone={controlTone[c.status]}>{c.key}</StatusPill>)}</span> },
                  { key: 'state', label: t('trust.table.status'), value: (r) => stateOf(r), render: (r) => <StatusPill tone={TONE[stateOf(r)]}>{t(`trust.req.${stateOf(r)}`)}</StatusPill> },
                ]}
              />
            </>
          ) : null}
        </div>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${open.id} · ${pick(open, 'title', L)}` : ''} subtitle={open?.group}>
        {open ? (
          <>
            {open.na ? <p className="text-small">{t('trust.frameworks.na')}: {open.na}</p> : null}
            <h3 className="text-small font-semibold">{t('trust.frameworks.mappedControls')}</h3>
            {open.controls.length ? (
              <ul className="grid gap-2">{open.controls.map((c) => <li key={c.key}><Link href={`/platform/trust/controls?id=${c.key}`} className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-line px-3 hover:bg-surface"><span className="font-semibold">{c.key}</span><StatusPill tone={controlTone[c.status]}>{t(`trust.status.${c.status}`)}</StatusPill></Link></li>)}</ul>
            ) : <p className="text-small text-warn">{t('trust.frameworks.uncovered')}</p>}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}
