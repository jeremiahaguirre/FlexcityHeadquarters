'use client';

import { AlertTriangle, ClipboardCheck, FileWarning, Monitor, Play, ShieldAlert, Store, Timer } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeatMap, Progress, ReadinessBars, ScoreRing, Sparkline, Timeline, TrendChart, VendorBars } from '@/components/platform/trust/charts';
import { useAgo, useTrustAccess } from '@/components/platform/trust/hooks';
import { TrustTabs, errorText } from '@/components/platform/trust/ui';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ErrorNotice } from '@/components/ui/ErrorNotice';
import { PageHeader } from '@/components/ui/PageHeader';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { papi } from '@/lib/platform';
import { FRAMEWORK_KEYS, RANGE_STOPS, fr, pick, testTone, useLiveTrust, type FrameworkKey, type Kpis, type Overview } from '@/lib/trust';

/** Dev console › Trust › Overview: FH's security posture, live. */
export default function TrustOverviewPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const { canManage } = useTrustAccess();
  const [range, setRange] = useState(2);
  const [scope, setScope] = useState<FrameworkKey[] | null>(null);
  const days = RANGE_STOPS[range]!;
  const q = `/trust/overview?days=${days}${scope ? `&frameworks=${scope.join(',')}` : ''}`;
  const live = useLiveTrust<Overview>(q);
  const o = live.data;
  const ago = useAgo(live.changedAt ? o?.updatedAt ?? null : null);
  const [appetite, setAppetite] = useState<number | null>(null);
  const [mode, setMode] = useState<'tests' | 'score'>('tests');
  const [heatMode, setHeatMode] = useState<'residual' | 'inherent'>('residual');
  const [cell, setCell] = useState<{ likelihood: number; impact: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [pulse, setPulse] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (o && appetite === null) setAppetite(o.riskAppetite);
  }, [o, appetite]);
  useEffect(() => {
    if (!live.changedAt) return;
    setPulse(true);
    const id = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(id);
  }, [live.changedAt]);
  const shownScope = scope ?? o?.scope ?? [];
  const toggle = (k: FrameworkKey) => {
    const next = shownScope.includes(k) ? shownScope.filter((x) => x !== k) : [...shownScope, k];
    setScope(FRAMEWORK_KEYS.filter((x) => next.includes(x)));
  };
  const saveAppetite = (v: number) => {
    setAppetite(v);
    if (!canManage) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void papi('/trust/settings', { method: 'PATCH', body: { riskAppetite: v } }).catch(() => toast(t('common.error'), 'warn')), 700);
  };
  async function runAll() {
    setRunning(true);
    try {
      await papi('/trust/tests/run', { method: 'POST', body: {} });
      await live.reload();
      toast(t('trust.tests.ran'), 'ok');
    } catch (e) {
      toast(errorText(e, t), 'warn');
    } finally {
      setRunning(false);
    }
  }
  async function saveScope() {
    try {
      await papi('/trust/settings', { method: 'PATCH', body: { frameworks: shownScope } });
      toast(t('trust.scope.saved'), 'ok');
      await live.reload();
    } catch (e) {
      toast(errorText(e, t), 'warn');
    }
  }
  const spark = (k: keyof Kpis) => (o?.trend ?? []).map((p) => Number(p.kpis[k] ?? 0));
  const failing = (o?.tests ?? []).filter((x) => x.status === 'FAIL' || x.status === 'ERROR');
  const cellRisks = useMemo(() => (o && cell ? o.risks.filter((r) => (heatMode === 'residual' ? r.residualLikelihood === cell.likelihood && r.residualImpact === cell.impact : r.likelihood === cell.likelihood && r.impact === cell.impact)) : []), [o, cell, heatMode]);
  const rangeLabel = (d: number) => (d >= 365 ? t('trust.range.months', { count: 12 }) : d >= 60 ? t('trust.range.months', { count: Math.round(d / 30) }) : t('trust.range.days', { count: d }));

  return (
    <div>
      <PageHeader
        eyebrow={t('trust.nav')}
        title={t('trust.overview.title')}
        description={t('trust.overview.description')}
        actions={
          <>
            <span className="inline-flex items-center gap-2 text-small text-muted" aria-live="polite">
              <span className={cn('h-2 w-2 rounded-full bg-ok', pulse && 'motion-safe:animate-ping')} aria-hidden="true" />
              {t('trust.updated', { ago })}
            </span>
            {canManage ? <Button variant="secondary" size="sm" icon={<Play className="h-4 w-4" aria-hidden="true" />} loading={running} onClick={() => void runAll()}>{t('trust.tests.runAll')}</Button> : null}
            <ButtonLink href="/platform/trust/present" size="sm" icon={<Monitor className="h-4 w-4" aria-hidden="true" />}>{t('trust.section.present')}</ButtonLink>
          </>
        }
      />
      <TrustTabs />
      {live.error && !o ? <ErrorNotice onRetry={() => void live.reload()} /> : null}
      {!o ? (
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-48 md:col-span-2" /></div>
      ) : (
        <div className="grid gap-4">
          {/* Scope and time range. */}
          <Card>
            <CardBody className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
              <fieldset>
                <legend className="text-small font-semibold">{t('trust.scope.label')}</legend>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" aria-pressed={shownScope.length === FRAMEWORK_KEYS.length} onClick={() => setScope([...FRAMEWORK_KEYS])} className={chip(shownScope.length === FRAMEWORK_KEYS.length)}>{t('trust.scope.all')}</button>
                  {o.frameworks.map((f) => <button key={f.key} type="button" aria-pressed={shownScope.includes(f.key)} onClick={() => toggle(f.key)} className={chip(shownScope.includes(f.key))}>{fr(i18n.language) ? f.nameFr : f.name}</button>)}
                  {canManage && scope && scope.join() !== (o.savedScope.length ? o.savedScope : o.scope).join() ? <Button size="sm" variant="ghost" onClick={() => void saveScope()}>{t('trust.scope.save')}</Button> : null}
                </div>
              </fieldset>
              <div>
                <label htmlFor="trust-range" className="flex justify-between text-small font-semibold"><span>{t('trust.range.label')}</span><span className="tabular-nums text-muted">{rangeLabel(days)}</span></label>
                <input id="trust-range" type="range" min={0} max={RANGE_STOPS.length - 1} step={1} value={range} onChange={(e) => setRange(Number(e.target.value))} aria-valuetext={rangeLabel(days)} className="mt-2 h-11 w-full cursor-pointer accent-brand-text" />
                <div className="mt-1 flex justify-between text-caption text-muted" aria-hidden="true"><span>{rangeLabel(7)}</span><span>{rangeLabel(365)}</span></div>
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi href="/platform/trust/tests?status=FAIL" icon={AlertTriangle} label={t('trust.kpi.failingTests')} value={o.kpis.failingTests} series={spark('failingTests')} bad />
            <Kpi href="/platform/trust/evidence" icon={FileWarning} label={t('trust.kpi.overdueEvidence')} value={o.kpis.overdueEvidence} series={spark('overdueEvidence')} bad />
            <Kpi href="/platform/trust/risks" icon={ShieldAlert} label={t('trust.kpi.highRisks')} value={o.kpis.openHighRisks} series={spark('openHighRisks')} bad />
            <Kpi href="/platform/trust/vendors" icon={Store} label={t('trust.kpi.vendorsDue')} value={o.kpis.vendorsDue} series={spark('vendorsDue')} />
            <Kpi href="/platform/trust/commitments" icon={Timer} label={t('trust.kpi.commitments30')} value={o.kpis.commitmentsDue30} series={spark('commitmentsDue30')} extra={o.kpis.commitmentsOverdue ? t('trust.kpi.overdue', { count: o.kpis.commitmentsOverdue }) : undefined} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <Card>
              <CardHeader title={t('trust.overview.score')} description={t('trust.overview.scoreHelp')} />
              <CardBody className="flex flex-wrap items-center gap-5">
                <ScoreRing score={o.score} label={t('trust.overview.score')} />
                <ul className="grid gap-1.5 text-small">
                  {(['PASSING', 'NEEDS_EVIDENCE', 'FAILING', 'NOT_APPLICABLE'] as const).map((s) => (
                    <li key={s}><Link href={`/platform/trust/controls?status=${s}`} className="flex min-h-[32px] items-center gap-2 hover:underline"><StatusPill tone={({ PASSING: 'ok', NEEDS_EVIDENCE: 'warn', FAILING: 'danger', NOT_APPLICABLE: 'neutral' } as const)[s]}>{t(`trust.status.${s}`)}</StatusPill><span className="font-semibold tabular-nums">{o.controls[s] ?? 0}</span></Link></li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('trust.overview.readiness')} description={t('trust.overview.readinessHelp')} action={<Link href="/platform/trust/frameworks" className="text-small font-semibold text-brand-text hover:underline">{t('trust.section.frameworks')}</Link>} />
              <CardBody><ReadinessBars frameworks={o.frameworks} onPick={(k) => router.push(`/platform/trust/frameworks?f=${k}`)} /></CardBody>
            </Card>
          </div>
          <div className="grid gap-4">
            <Card>
              <CardHeader title={mode === 'tests' ? t('trust.trend.testsTitle') : t('trust.trend.scoreTitle')} description={rangeLabel(days)} action={<Segmented label={t('trust.trend.mode')} value={mode} onChange={setMode} options={[{ value: 'tests', label: t('trust.trend.tests') }, { value: 'score', label: t('trust.trend.score') }]} />} />
              <CardBody><TrendChart points={o.trend} mode={mode} /></CardBody>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title={t('trust.heat.title')} description={t('trust.heat.help')} action={<Segmented label={t('trust.heat.mode')} value={heatMode} onChange={(v) => (setHeatMode(v), setCell(null))} options={[{ value: 'residual', label: t('trust.risk.residual') }, { value: 'inherent', label: t('trust.risk.inherent') }]} />} />
              <CardBody className="grid gap-4">
                <HeatMap risks={o.risks} appetite={appetite ?? o.riskAppetite} mode={heatMode} selected={cell} onCell={(c) => setCell(cell && cell.likelihood === c.likelihood && cell.impact === c.impact ? null : c)} />
                <div>
                  <label htmlFor="trust-appetite" className="flex justify-between text-small font-semibold"><span>{t('trust.appetite.label')}</span><span className="tabular-nums text-muted">{t('trust.appetite.value', { score: appetite ?? o.riskAppetite })}</span></label>
                  <input id="trust-appetite" type="range" min={o.appetiteRange[0]} max={o.appetiteRange[1]} step={1} value={appetite ?? o.riskAppetite} onChange={(e) => saveAppetite(Number(e.target.value))} aria-valuetext={t('trust.appetite.value', { score: appetite ?? o.riskAppetite })} className="mt-2 h-11 w-full cursor-pointer accent-brand-text" />
                  <p className="mt-1 text-caption text-muted">{canManage ? t('trust.appetite.help') : t('trust.appetite.readOnly')}</p>
                </div>
                {cell ? (
                  <div aria-live="polite">
                    <h3 className="text-small font-semibold">{t('trust.heat.selected', { likelihood: cell.likelihood, impact: cell.impact })}</h3>
                    {cellRisks.length ? <ul className="mt-1 grid gap-1 text-small">{cellRisks.map((r) => <li key={r.id}><Link href={`/platform/trust/risks?id=${r.id}`} className="hover:underline"><span className="font-semibold">{r.ref}</span> {pick(r, 'title', i18n.language)}</Link></li>)}</ul> : <p className="mt-1 text-small text-muted">{t('trust.heat.emptyCell')}</p>}
                  </div>
                ) : null}
              </CardBody>
            </Card>
            <div className="grid content-start gap-4">
              <Card>
                <CardHeader title={t('trust.timeline.title')} description={t('trust.timeline.help')} />
                <CardBody><Timeline items={o.commitments} onOpen={(id) => router.push(`/platform/trust/commitments?id=${id}`)} /></CardBody>
              </Card>
              <Card>
                <CardHeader title={t('trust.vendorRisk')} />
                <CardBody><VendorBars dist={o.vendors} /></CardBody>
              </Card>
              <Card>
                <CardBody><Progress done={o.policyAcks.done} total={o.policyAcks.required} label={t('trust.ackProgress', { policies: o.policyAcks.policies, admins: o.policyAcks.admins })} /></CardBody>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('trust.overview.failing')} description={failing.length ? undefined : t('trust.overview.noneFailing')} action={<Link href="/platform/trust/tests" className="text-small font-semibold text-brand-text hover:underline">{t('trust.section.tests')}</Link>} />
              <CardBody className="pt-3">
                <ul className="divide-y divide-line">
                  {failing.map((x) => (
                    <li key={x.key}>
                      <Link href={`/platform/trust/tests?test=${x.key}`} className="flex min-h-[44px] items-start gap-3 py-2.5 hover:bg-surface/50">
                        <StatusPill tone={testTone(x.status)}>{t(`trust.testStatus.${x.status}`)}</StatusPill>
                        <span className="min-w-0"><span className="block text-small font-semibold">{pick(x, 'title', i18n.language)}</span><span className="block text-small text-muted">{pick(x, 'summary', i18n.language)}</span></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('trust.alerts.title')} />
              <CardBody className="pt-3">
                {o.alerts.length ? (
                  <ul className="divide-y divide-line text-small">
                    {o.alerts.map((a) => (
                      <li key={a.id} className="flex items-start gap-2 py-2.5">
                        <ClipboardCheck className={cn('mt-0.5 h-4 w-4 shrink-0', a.kind === 'test_recovered' ? 'text-ok' : a.kind === 'reminder' ? 'text-muted' : 'text-warn')} aria-hidden="true" />
                        <span className="min-w-0 flex-1">{a.link ? <Link href={a.link} className="hover:underline">{fr(i18n.language) ? a.titleFr : a.title}</Link> : fr(i18n.language) ? a.titleFr : a.title}</span>
                        <time className="shrink-0 text-caption text-muted" dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })}</time>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-small text-muted">{t('trust.alerts.none')}</p>}
              </CardBody>
            </Card>
          </div>
          <p className="text-caption text-muted">{t('trust.libraryVersion', { version: o.libraryVersion })}</p>
        </div>
      )}
    </div>
  );
}

const chip = (on: boolean) => cn('min-h-[40px] rounded-full border px-3 text-small font-semibold transition-colors', on ? 'border-transparent bg-brand/10 text-brand-text' : 'border-line text-muted hover:bg-surface hover:text-ink');

function Kpi({ href, icon: Icon, label, value, series, bad, extra }: { href: string; icon: typeof AlertTriangle; label: string; value: number; series: number[]; bad?: boolean; extra?: string }) {
  const tone = bad && value ? 'danger' : 'brand';
  return (
    <Link href={href} className="group flex flex-col justify-between gap-2 rounded-xl2 border border-line bg-panel p-4 shadow-card hover:border-ink/30">
      <span className="flex items-start justify-between gap-2 text-small text-muted"><span className="min-w-0">{label}</span><Icon className={cn('h-4 w-4 shrink-0', bad && value ? 'text-danger' : '')} aria-hidden="true" /></span>
      <span className="flex items-end justify-between gap-2">
        <span className={cn('text-title tabular-nums', bad && value ? 'text-danger' : 'text-ink')}>{value}</span>
        <Sparkline values={series} tone={tone} />
      </span>
      {extra ? <span className="text-caption font-semibold text-danger">{extra}</span> : null}
    </Link>
  );
}
