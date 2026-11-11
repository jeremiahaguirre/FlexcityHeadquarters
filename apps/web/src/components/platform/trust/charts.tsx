'use client';

import { Fragment, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { colon, heatCells, linePath, riskLevel, timelinePos, daysLeft, type FrameworkReadiness, type OverviewRisk, type TrendPoint, pct } from '@/lib/trust';

/**
 * Trust charts: inline SVG, the app's own tokens (status colours keep their meaning: green ok,
 * amber attention, red blocking, always with words or numbers beside them), thin marks, direct
 * labels, and a text equivalent for every chart (an aria-label, or a visually hidden table).
 */
const C = { brand: 'rgb(var(--brand-text))', ok: 'rgb(var(--ok))', warn: 'rgb(var(--warn))', danger: 'rgb(var(--danger))', line: 'rgb(var(--line))', muted: 'rgb(var(--muted))', surface: 'rgb(var(--surface))' };

export function ScoreRing({ score, size = 168, label }: { score: number; size?: number; label: string }) {
  const { i18n } = useTranslation();
  const r = size / 2 - 10;
  const len = 2 * Math.PI * r;
  const tone = score >= 80 ? C.ok : score >= 50 ? C.brand : C.warn;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}${colon(i18n.language)}${score} / 100`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.surface} strokeWidth="12" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(len * score) / 100} ${len}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-700" />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-ink font-extrabold" style={{ fontSize: size * 0.27 }}>{score}</text>
      <text x="50%" y="66%" textAnchor="middle" className="fill-muted" style={{ fontSize: size * 0.085 }}>/ 100</text>
    </svg>
  );
}

export function ReadinessBars({ frameworks, onPick }: { frameworks: FrameworkReadiness[]; onPick?: (k: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <ul className="grid gap-3">
      {frameworks.map((f) => {
        const name = i18n.language.startsWith('fr') ? f.nameFr : f.name;
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-small">
              <span className={cn('min-w-0 font-semibold [overflow-wrap:anywhere]', !f.inScope && 'text-muted')}>{name}{!f.inScope ? ` · ${t('trust.outOfScope')}` : ''}</span>
              <span className="shrink-0 tabular-nums text-muted"><span className="font-semibold text-ink">{pct(f.readiness, i18n.language)}</span> · {t('trust.metOf', { met: f.met, total: f.total - f.notApplicable })}</span>
            </span>
            <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-surface" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.readiness} aria-label={t('trust.readinessOf', { name })}>
              <span className="block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${f.readiness}%`, background: f.inScope ? C.brand : C.muted }} />
            </span>
          </>
        );
        return <li key={f.key}>{onPick ? <button type="button" onClick={() => onPick(f.key)} className="block min-h-[44px] w-full rounded-lg text-left">{body}</button> : body}</li>;
      })}
    </ul>
  );
}

/**
 * Test results per day as stacked bars (passing, needs a look, failing), or the posture score as a
 * step line; one y axis with labelled ticks, a per-bar tooltip, and a hidden table. Sparse history
 * says so instead of stretching a line over two points.
 */
export function TrendChart({ points, mode }: { points: TrendPoint[]; mode: 'tests' | 'score' }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
  if (!points.length) return <p className="py-10 text-center text-small text-muted">{t('trust.trend.collecting', { count: 0 })}</p>;
  const series = mode === 'tests'
    ? [{ key: 'pass', label: t('trust.trend.passing'), color: C.ok }, { key: 'warn', label: t('trust.trend.warning'), color: C.muted }, { key: 'fail', label: t('trust.trend.failing'), color: C.danger }] as const
    : [{ key: 'score', label: t('trust.trend.score'), color: C.brand }] as const;
  const val = (p: TrendPoint, k: string) => Number((p as unknown as Record<string, number>)[k] ?? 0);
  const total = (p: TrendPoint) => p.pass + p.warn + p.fail;
  const raw = mode === 'score' ? 100 : Math.max(4, ...points.map(total));
  const step = mode === 'score' ? 25 : raw <= 10 ? 2 : raw <= 20 ? 5 : 10;
  const max = Math.ceil(raw / step) * step;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  const W = 640;
  const H = 180;
  const n = points.length;
  const slot = W / n;
  const bw = Math.max(2, Math.min(28, slot - Math.max(2, slot * 0.25)));
  const y = (v: number) => H - (v / max) * H;
  const stepPath = points.map((p, i) => `${i ? 'L' : 'M'}${(i * slot).toFixed(1)},${y(p.score).toFixed(1)} L${((i + 1) * slot).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const hp = hover !== null ? points[hover] : null;
  const hatchId = `hatch-${id.replace(/[^\w-]/g, '')}`;
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-4 text-caption text-muted" aria-hidden="true">
        {series.map((s) => <li key={s.key} className="flex items-center gap-1.5"><span className={cn('w-3 rounded-sm', mode === 'score' ? 'h-0.5' : 'h-3')} style={{ background: s.key === 'fail' ? `${HATCH_CSS}, ${s.color}` : s.color }} />{s.label}</li>)}
      </ul>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-1">
        <div className="relative h-44 text-right text-[0.6875rem] tabular-nums text-muted" aria-hidden="true">
          {ticks.map((v) => <span key={v} className="absolute right-1 -translate-y-1/2" style={{ top: `${(1 - v / max) * 100}%` }}>{v}</span>)}
        </div>
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full overflow-visible" preserveAspectRatio="none" aria-labelledby={`${id}-cap`} role="img"
            onPointerMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              setHover(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
            }}
            onPointerLeave={() => setHover(null)}>
            <defs>
              <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={C.danger} />
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgb(var(--panel))" strokeWidth="2" strokeOpacity="0.55" />
              </pattern>
            </defs>
            {ticks.map((v) => <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke={C.line} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            {hover !== null ? <rect x={hover * slot} y="0" width={slot} height={H} fill={C.surface} opacity="0.6" /> : null}
            {mode === 'tests'
              ? points.map((p, i) => {
                  let acc = 0;
                  const x = i * slot + (slot - bw) / 2;
                  return (
                    <g key={p.day}>
                      {(['pass', 'warn', 'fail'] as const).map((k) => {
                        const v = val(p, k);
                        if (!v) return null;
                        const top = y(acc + v);
                        const hgt = y(acc) - top;
                        acc += v;
                        // A 2px surface gap between stacked segments.
                        return <rect key={k} x={x} y={top + 1} width={bw} height={Math.max(0, hgt - 2)} rx={Math.min(3, bw / 3)} fill={k === 'fail' ? `url(#${hatchId})` : series.find((s) => s.key === k)!.color} />;
                      })}
                    </g>
                  );
                })
              : <path d={stepPath} fill="none" stroke={C.brand} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
          </svg>
          {hp ? (
            <div className="pointer-events-none absolute top-0 z-10 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-caption shadow-card" style={{ left: `min(calc(${((hover! + 1) / n) * 100}% + 6px), calc(100% - 9.5rem))` }}>
              <p className="font-semibold">{fmt(hp.day)}</p>
              {series.map((s) => <p key={s.key} className="tabular-nums"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: s.key === 'fail' ? `${HATCH_CSS}, ${s.color}` : s.color }} />{s.label}{colon(i18n.language)}{val(hp, s.key)}</p>)}
            </div>
          ) : null}
          <div className="mt-1 flex justify-between text-caption text-muted" aria-hidden="true"><span>{fmt(points[0]!.day)}</span>{n > 1 ? <span>{fmt(points[n - 1]!.day)}</span> : null}</div>
        </div>
      </div>
      {n < 7 ? <p className="mt-2 text-caption text-muted">{t('trust.trend.collecting', { count: n })}</p> : null}
      <table className="sr-only">
        <caption id={`${id}-cap`}>{mode === 'tests' ? t('trust.trend.testsTitle') : t('trust.trend.scoreTitle')}</caption>
        <thead><tr><th scope="col">{t('trust.trend.day')}</th>{series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
        <tbody>{points.map((p) => <tr key={p.day}><th scope="row">{fmt(p.day)}</th>{series.map((s) => <td key={s.key}>{val(p, s.key)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** The failing hatch for legend swatches (the bars use the matching SVG pattern). */
const HATCH_CSS = 'repeating-linear-gradient(45deg, rgb(var(--panel) / 0.55) 0 1.5px, transparent 1.5px 4px)';

export const levelStyle = { high: 'bg-danger-bg text-danger', medium: 'bg-warn-bg text-warn', low: 'bg-ok-bg text-ok' } as const;

/** 5×5 likelihood × impact grid; cells recolour live with the risk appetite. Each cell is a button. */
export function HeatMap({ risks, appetite, mode, onCell, selected }: { risks: OverviewRisk[]; appetite: number; mode: 'residual' | 'inherent'; onCell?: (c: { likelihood: number; impact: number }) => void; selected?: { likelihood: number; impact: number } | null }) {
  const { t } = useTranslation();
  const cells = useMemo(() => heatCells(risks, mode), [risks, mode]);
  return (
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5">
      <div className="flex items-center justify-center"><span className="-rotate-90 whitespace-nowrap text-caption text-muted">{t('trust.risk.impact')} →</span></div>
      <div>
        {/* A group of buttons (not an ARIA grid, which would need rows and arrow-key navigation); each says its cell in words.
            Each row starts with its impact tick (5 at the top), and the likelihood ticks run along the bottom. */}
        <div className="grid grid-cols-[1rem_repeat(5,minmax(0,1fr))] gap-1" role="group" aria-label={t('trust.heat.label', { appetite })}>
          {cells.map((c) => {
            const lvl = riskLevel(c.score, appetite);
            const on = selected?.likelihood === c.likelihood && selected?.impact === c.impact;
            return (
              <Fragment key={`${c.likelihood}-${c.impact}`}>
                {c.likelihood === 1 ? <span className="grid place-items-center text-caption tabular-nums text-muted" aria-hidden="true">{c.impact}</span> : null}
                <button type="button" onClick={() => onCell?.(c)} aria-pressed={on}
                  aria-label={t('trust.heat.cell', { likelihood: c.likelihood, impact: c.impact, score: c.score, count: c.risks.length, level: t(`trust.level.${lvl}`) })}
                  className={cn('relative grid aspect-[4/3] min-h-[44px] place-items-center rounded-lg text-small font-bold tabular-nums motion-safe:transition-colors', levelStyle[lvl], on && 'ring-2 ring-ink ring-offset-2 ring-offset-panel')}>
                  {c.risks.length || ''}
                  {/* Full-strength colour (no opacity): the small score keeps AA contrast on every level's background. */}
                  <span className="absolute bottom-0.5 right-1 text-[0.625rem] font-medium" aria-hidden="true">{c.score}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
        <div className="mt-1 grid grid-cols-[1rem_repeat(5,minmax(0,1fr))] gap-1 text-center text-caption tabular-nums text-muted" aria-hidden="true">
          <span />
          {[1, 2, 3, 4, 5].map((v) => <span key={v}>{v}</span>)}
        </div>
        <p className="mt-0.5 pl-5 text-center text-caption text-muted">{t('trust.risk.likelihood')} →</p>
      </div>
    </div>
  );
}

export function VendorBars({ dist }: { dist: { low: number; medium: number; high: number } }) {
  const { t } = useTranslation();
  const total = dist.low + dist.medium + dist.high;
  const parts = [{ k: 'high', v: dist.high, c: C.danger }, { k: 'medium', v: dist.medium, c: C.warn }, { k: 'low', v: dist.low, c: C.ok }] as const;
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface" role="img" aria-label={t('trust.vendorDist', { high: dist.high, medium: dist.medium, low: dist.low })}>
        {parts.filter((p) => p.v).map((p) => <span key={p.k} style={{ width: `${(100 * p.v) / Math.max(1, total)}%`, background: p.c }} className="h-full first:rounded-l-full last:rounded-r-full" />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-small">
        {parts.map((p) => <li key={p.k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.c }} aria-hidden="true" />{t(`trust.level.${p.k}`)} <span className="font-semibold tabular-nums">{p.v}</span></li>)}
      </ul>
    </div>
  );
}

/** Next 90 days of commitments; overdue ones pinned at the start in red, due within 7 days in amber. */
export function Timeline({ items, onOpen }: { items: Array<{ id: string; title: string; customer: string; dueAt: string }>; onOpen?: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const start = Date.now();
  const tone = (d: string) => (daysLeft(d) < 0 ? 'danger' : daysLeft(d) <= 7 ? 'warn' : 'brand');
  const color = { danger: C.danger, warn: C.warn, brand: C.brand };
  const fmt = (d: string) => new Date(d).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (!items.length) return <p className="py-6 text-center text-small text-muted">{t('trust.timeline.none')}</p>;
  // Dots closer than ~5% of the axis (overdue ones all sit at Today) merge into one dot with a count,
  // coloured by the most urgent of them.
  const rank = { danger: 0, warn: 1, brand: 2 } as const;
  const clusters: Array<{ pos: number; tone: 'danger' | 'warn' | 'brand'; items: typeof items }> = [];
  for (const c of [...items].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    const pos = timelinePos(c.dueAt, start, 90);
    const last = clusters[clusters.length - 1];
    if (last && pos - last.pos < 0.05) {
      last.items.push(c);
      if (rank[tone(c.dueAt)] < rank[last.tone]) last.tone = tone(c.dueAt);
    } else clusters.push({ pos, tone: tone(c.dueAt), items: [c] });
  }
  return (
    <div>
      <div className="relative mx-2 h-10" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
        {[0, 30, 60, 90].map((d) => <span key={d} className="absolute top-[calc(50%+6px)] -translate-x-1/2 text-[0.625rem] text-muted" style={{ left: `${(d / 90) * 100}%` }}>{d ? `+${d}` : t('trust.timeline.today')}</span>)}
        {clusters.map((g) => (
          <span key={g.items[0]!.id} className={cn('absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[0.625rem] font-bold tabular-nums text-page ring-2 ring-panel', g.items.length > 1 ? 'h-4 min-w-4 px-1' : 'h-3 w-3')} style={{ left: `${g.pos * 100}%`, background: color[g.tone] }}>
            {g.items.length > 1 ? g.items.length : null}
          </span>
        ))}
      </div>
      <ul className="mt-3 divide-y divide-line text-small">
        {items.slice(0, 6).map((c) => {
          const left = daysLeft(c.dueAt);
          return (
            <li key={c.id}>
              <button type="button" onClick={() => onOpen?.(c.id)} className="flex min-h-[44px] w-full items-start gap-3 py-2 text-left">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color[tone(c.dueAt)] }} aria-hidden="true" />
                <span className="line-clamp-2 min-w-0 flex-1"><span className="font-semibold">{c.customer}</span> · {c.title}</span>
                <span className={cn('shrink-0 tabular-nums', left < 0 ? 'font-semibold text-danger' : left <= 7 ? 'font-semibold text-warn' : 'text-muted')}>{left < 0 ? t('trust.timeline.overdue', { count: -left }) : `${fmt(c.dueAt)} · ${t('trust.timeline.inDays', { count: left })}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const { i18n } = useTranslation();
  const share = total ? Math.round((100 * done) / total) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-small"><span className="min-w-0">{label}</span><span className="shrink-0 whitespace-nowrap tabular-nums"><span className="font-semibold">{done}</span> / {total} · {pct(share, i18n.language)}</span></div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done} aria-label={label}>
        <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${share}%`, background: share === 100 ? C.ok : C.brand }} />
      </div>
    </div>
  );
}

export function Sparkline({ values, tone = 'brand' }: { values: number[]; tone?: 'brand' | 'danger' | 'warn' | 'ok' }) {
  if (values.length < 2) return <span className="block h-7" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 96 28" className="h-7 w-24" aria-hidden="true" preserveAspectRatio="none">
      <path d={linePath(values, 96, 28)} fill="none" stroke={C[tone]} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
