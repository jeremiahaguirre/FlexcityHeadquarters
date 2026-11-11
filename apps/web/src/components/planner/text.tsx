'use client';

/** Words for the planner's statuses and reasons (from the API's codes), and the small status mark. */
import { AlertTriangle, CheckCircle2, CircleDashed, OctagonX } from 'lucide-react';
import type { TFunction } from 'i18next';
import { formatHours, formatTime } from '@/lib/format';
import type { Reason, Status } from '@/lib/planner';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Reasons whose sentence needs a number, a time or a certificate; without it, a plainer one. */
const NEEDS: Record<string, 'n' | 'at' | 'cert'> = {
  OVERLAPPING_SHIFT: 'at',
  REST_BETWEEN_SHIFTS: 'n',
  DAILY_REST: 'n',
  OVER_PERSONAL_WEEKLY_MAX: 'n',
  UNDER_MINIMUM_AGE: 'n',
  HOS_DAILY: 'n',
  HOS_REST: 'n',
  HOS_WEEKLY: 'n',
  OVERTIME: 'n',
  MISSING_CERTIFICATION: 'cert',
  CERTIFICATION_EXPIRES: 'cert',
};

export function reasonText(t: TFunction, lng: string, r: Reason): string {
  const n = r.n ?? [];
  const need = NEEDS[r.code];
  if ((need === 'n' && !n.length) || (need === 'at' && !r.at) || (need === 'cert' && !r.cert)) return t(`planner.reasonsPlain.${r.code}`, { defaultValue: t(`planner.reasons.${r.code}`, { defaultValue: r.code }) });
  const time = (s: string) => formatTime(`2000-01-01T${s}:00`, lng);
  const at = r.at ? r.at.split('-').map(time).join('–') : '';
  return t(`planner.reasons.${r.code}`, {
    hours: n[0] !== undefined ? formatHours(n[0], lng) : '',
    a: n[0] ?? '',
    b: n[1] ?? '',
    at,
    cert: r.cert ?? '',
    defaultValue: t(`blocks.${r.code}`, { defaultValue: r.code }),
  });
}

export const reasonsText = (t: TFunction, lng: string, rs: Reason[]) => rs.map((r) => reasonText(t, lng, r)).join(' · ');

const marks = {
  ok: { Icon: CheckCircle2, cls: 'text-ok' },
  warn: { Icon: AlertTriangle, cls: 'text-warn' },
  block: { Icon: OctagonX, cls: 'text-danger' },
  unknown: { Icon: CircleDashed, cls: 'text-muted' },
} as const;

/** Icon shape + colour for a status (always paired with words somewhere nearby). */
export function StatusMark({ status, className }: { status: Status; className?: string }) {
  const { Icon, cls } = marks[status];
  return <Icon className={cn('h-4 w-4 shrink-0', cls, className)} aria-hidden="true" strokeWidth={2.5} />;
}

/** Drop-target ring and tint while dragging. */
export const dropTone: Record<Status, string> = {
  ok: 'ring-2 ring-ok/70 bg-ok-bg/60',
  warn: 'ring-2 ring-warn/70 bg-warn-bg/60',
  block: 'ring-2 ring-danger/70 bg-danger-bg/50',
  unknown: 'ring-1 ring-line',
};

/** What a refused write says, in words: the rule codes the API sent back, or its error. */
export function reasonsFromError(t: TFunction, lng: string, e: unknown): string[] {
  if (e instanceof ApiError) {
    const blocks = (e.details as { blocks?: Array<{ code: string; message?: string }> } | undefined)?.blocks;
    if (blocks?.length) return blocks.map((b) => reasonText(t, lng, { code: b.code, n: numbersIn(b.message ?? '') }));
    return [t(`errors.${e.code}`, { defaultValue: e.message })];
  }
  return [t('common.error')];
}

/** Hours and limits in the API's own sentence (dates left out), for the translated one. */
const numbersIn = (message: string) => [...message.replace(/\d{4}-\d{2}-\d{2}/g, '').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
