import { Check, ChevronsRight, Fingerprint, MapPin, ShieldCheck } from 'lucide-react';
import { LoneTimer } from '@/components/Motion';
import type { Copy } from '@/content/copy';
import { cn } from '@/lib/cn';

/**
 * Small HTML drawings of the app, with sample data, for the marketing pages. They are
 * pictures, not controls: each caller hides them from assistive technology or gives the
 * group one label. Without motion they rest in their finished state (see globals.css).
 */
type M = Copy['home']['mock'];

const TEAL = 'bg-[#5EEAD4] text-[#04201F]';
const LIME = 'bg-[#C5F23A] text-[#1A2A04]';
const PINK = 'bg-[#F0ABFC] text-[#3A0D40]';
const SOFT = 'bg-white/20 text-white';
const ROWS: Array<{ n: string; s: Array<[string, string] | null | 'open'> }> = [
  { n: 'Maya', s: [['6–2', TEAL], ['6–2', TEAL], null, ['6–2', TEAL], ['6–2', TEAL], null, null] },
  { n: 'Liam', s: [null, ['2–10', LIME], ['2–10', LIME], null, ['2–10', LIME], ['8–4', LIME], null] },
  { n: 'Chloé', s: [['9–5', PINK], null, ['9–5', PINK], ['9–5', PINK], null, null, ['8–4', PINK]] },
  { n: 'Noah', s: [['2–10', SOFT], null, null, ['2–10', SOFT], null, 'open', ['12–8', SOFT]] },
  { n: 'Sofia', s: [null, ['9–5', TEAL], ['6–2', TEAL], null, ['9–5', TEAL], ['12–8', TEAL], null] },
];

export function ScheduleMock({ m, className }: { m: M; className?: string }) {
  let d = 0;
  return (
    <div className={cn('mock-panel rounded-2xl p-3 sm:p-4', className)}>
      {/* The sample label sits next to the title, clear of the rules card laid over the top right. */}
      <div className="mb-3 flex items-center gap-2">
        <span className="truncate text-[0.8125rem] font-semibold text-white">
          {m.week} <span className="text-white/60">· {m.site}</span>
        </span>
        <span className="shrink-0 rounded-full border border-white/25 px-2 py-0.5 text-[0.6875rem] font-semibold text-white/80">{m.sample}</span>
      </div>
      <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] gap-1 text-[0.625rem] font-bold sm:grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] sm:gap-1.5 sm:text-[0.6875rem]">
        <span />
        {m.days.map((day) => (
          <span key={day} className="pb-1 text-center font-semibold uppercase tracking-wide text-white/60">{day}</span>
        ))}
        {ROWS.map((r) => (
          <div key={r.n} className="contents">
            <span className="flex items-center gap-1.5 truncate text-[0.6875rem] font-semibold text-white/90 sm:text-[0.75rem]">
              <i className="hidden h-5 w-5 shrink-0 place-items-center rounded-full bg-white/15 text-[0.625rem] not-italic sm:grid">{r.n[0]}</i>
              {r.n}
            </span>
            {r.s.map((c, i) =>
              c === 'open' ? (
                <span key={i} className="open-pulse grid h-7 place-items-center rounded-md border border-dashed border-[#C5F23A] text-[#C5F23A] sm:h-8">{m.open}</span>
              ) : c ? (
                <span key={i} style={{ ['--d' as string]: d++ }} className={cn('pop grid h-7 place-items-center rounded-md sm:h-8', c[1])}>{c[0]}</span>
              ) : (
                <span key={i} className="h-7 rounded-md bg-white/[0.05] sm:h-8" />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RulesBadge({ m, className }: { m: M; className?: string }) {
  return (
    <div className={cn('mock-panel rounded-2xl p-3.5', className)}>
      <p className="flex items-center gap-2 text-[0.8125rem] font-bold text-white">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[#C5F23A] text-[#1A2A04]">
          <ShieldCheck className="h-4 w-4" />
        </span>
        {m.rulesTitle}
      </p>
      <ul className="mt-2.5 grid gap-1.5 text-[0.75rem] font-medium text-white/85">
        {m.rules.map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[#C5F23A]" />
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SlideMock({ m, className }: { m: M; className?: string }) {
  return (
    <div className={cn('mock-panel rounded-2xl p-4', className)}>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#5EEAD4] text-[0.8125rem] font-bold text-[#04201F]">M</span>
        <span className="min-w-0">
          <span className="block text-[0.8125rem] font-bold leading-tight text-white">{m.shift}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[0.6875rem] font-semibold text-white/75">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3 text-[#5EEAD4]" />{m.onSite}</span>
            <span className="inline-flex items-center gap-1"><Check className="h-3 w-3 text-[#C5F23A]" />{m.certOk}</span>
          </span>
        </span>
      </div>
      <div className="relative mt-3.5 h-12 overflow-hidden rounded-full border border-white/15 bg-white/10">
        <span className="slide-fill absolute inset-0 bg-[#5EEAD4]" />
        <span className="slide-label-a absolute inset-0 grid place-items-center pl-8 text-[0.8125rem] font-bold text-white">{m.slide}</span>
        <span className="slide-label-b absolute inset-0 flex items-center justify-center gap-1.5 pr-10 text-[0.8125rem] font-bold text-[#04201F]">
          <Check className="h-4 w-4" />
          {m.clocked}
        </span>
        <span className="slide-knob-rail absolute inset-y-1 left-1 right-11">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#0D5F59] shadow-lg">
            <ChevronsRight className="h-5 w-5" />
          </span>
        </span>
      </div>
    </div>
  );
}

export function LoneMock({ m, className }: { m: M; className?: string }) {
  return (
    <div className={cn('mock-panel rounded-2xl p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[0.8125rem] font-bold text-white">
          <span className="relative flex h-2.5 w-2.5">
            <span className="pulse-dot absolute inset-0 rounded-full bg-[#C5F23A]" />
          </span>
          {m.aloneTitle}
        </p>
        <span className="inline-flex min-w-0 items-center gap-1 text-[0.6875rem] font-semibold text-white/75">
          <MapPin className="h-3 w-3 shrink-0 text-[#5EEAD4]" />
          <span className="truncate">{m.aloneWhere}</span>
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3.5">
        <span className="relative grid h-[4.5rem] w-[4.5rem] shrink-0 place-items-center">
          <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90" fill="none" strokeWidth="3.5" strokeLinecap="round">
            <circle cx="20" cy="20" r="17" className="ring-track" />
            <circle cx="20" cy="20" r="17" pathLength="100" className="ring-bar" />
          </svg>
          <LoneTimer className="text-[1rem] font-extrabold tabular-nums text-white" />
        </span>
        <span className="min-w-0">
          <span className="block text-[0.8125rem] font-bold text-white">{m.aloneNext}</span>
          <span className="block text-[0.75rem] font-semibold text-white/75">{m.aloneEvery}</span>
        </span>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-2 text-center text-[0.8125rem] font-bold">
        <span className="rounded-xl bg-[#C5F23A] px-2 py-2.5 text-[#1A2A04]">{m.ok}</span>
        <span className="rounded-xl border border-[#FF8A7A]/60 bg-[#FF8A7A]/10 px-2 py-2.5 text-[#FFC2B8]">{m.help}</span>
      </div>
    </div>
  );
}

export function BoardMock({ m, className }: { m: M; className?: string }) {
  return (
    <div className={cn('mock-panel rounded-2xl p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <span>
          <span className="open-pulse inline-flex rounded-full border border-dashed border-[#C5F23A] px-2.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-[#C5F23A]">{m.boardOpen}</span>
          <span className="mt-2 block text-[0.875rem] font-bold text-white">{m.boardWhen}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[0.6875rem] font-semibold text-white/75">{m.boardPay}</span>
          <span className="block text-[1.5rem] font-extrabold leading-tight tabular-nums text-[#C5F23A]">{m.boardPayValue}</span>
          <span className="block text-[0.625rem] font-semibold uppercase tracking-wide text-white/60">{m.sample}</span>
        </span>
      </div>
      <ul className="mt-3 grid gap-1.5 border-t border-white/10 pt-3 text-[0.75rem] font-medium text-white/85">
        {[m.boardEligible, m.certOk, m.boardOrder].map((x) => (
          <li key={x} className="flex gap-1.5">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C5F23A]" />
            {x}
          </li>
        ))}
      </ul>
      <span className="sheen mt-3.5 block rounded-xl bg-[#5EEAD4] py-2.5 text-center text-[0.8125rem] font-bold text-[#04201F]">{m.boardClaim}</span>
    </div>
  );
}

export function PayrollMock({ m, className }: { m: M; className?: string }) {
  return (
    <div className={cn('mock-panel rounded-2xl p-4', className)}>
      <p className="text-[0.8125rem] font-bold text-white">{m.payTitle}</p>
      <ul className="mt-3 grid gap-2">
        {m.payRows.map((r, i) => (
          <li key={r} className="flex items-center gap-3 rounded-xl bg-white/[0.07] px-3 py-2.5 text-[0.75rem] font-semibold text-white/90">
            <span className="min-w-0 flex-1 truncate">{r}</span>
            <span aria-hidden="true" className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-white/10 sm:block">
              <span className="block h-full rounded-full bg-[#5EEAD4]" style={{ width: `${[100, 34, 18][i] ?? 50}%` }} />
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#C5F23A]/15 px-2 py-0.5 text-[0.6875rem] font-bold text-[#C5F23A]">
              <Check className="h-3 w-3" />
              {m.payApproved}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
        <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold text-white/80">
          <Fingerprint className="h-3.5 w-3.5 text-[#5EEAD4]" />
          {m.payMfa}
        </span>
        <span className="sheen rounded-xl bg-white px-3.5 py-2 text-[0.8125rem] font-bold text-[#0B3B3C]">{m.payExport}</span>
      </div>
    </div>
  );
}

/** The hero picture: the week's schedule with three cards laid over it. */
export function HeroConsole({ m }: { m: M }) {
  return (
    <div role="img" aria-label={m.label} className="relative mx-auto w-full max-w-xl select-none lg:max-w-none">
      <ScheduleMock m={m} />
      <RulesBadge m={m} className="absolute -top-[6.75rem] right-4 z-10 hidden w-52 sm:block" />
      <div className="relative z-10 -mt-3 grid gap-3 px-2 sm:-mt-6 sm:grid-cols-2 sm:px-5">
        <SlideMock m={m} />
        <LoneMock m={m} />
      </div>
    </div>
  );
}
