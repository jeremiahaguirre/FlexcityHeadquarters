/**
 * What an organization's plan includes, and whether its account is in good
 * standing. Read on every request (cached with the feature switches).
 *
 * - The plan's standard options, plus or minus what the Dev console switched
 *   for this organization, unlock their features; everything else is core
 *   (services/billing/catalog.ts).
 * - An organization with no billing account, or in a trial, has everything.
 * - Unpaid invoices: a warning once overdue, then read-only after the grace
 *   period, except safety work (incidents, chemistry, headcounts, working
 *   alone), clocking in and out, and paying.
 */
import type { BillingAccount } from '@prisma/client';
import { db } from '../../lib/db.js';
import type { FeatureKey } from '../platform/features.js';
import { type ItemKey, lockedFeatures, ownedItems } from './catalog.js';

export type Module = ItemKey;

export type BillingStage = 'unbilled' | 'trial' | 'ok' | 'overdue' | 'suspended';
export interface BillingState {
  stage: BillingStage;
  /** Feature → the module that unlocks it, for features the plan doesn't include. */
  locked: Partial<Record<FeatureKey, Module>>;
  /** Options the plan includes (everything during a trial or without an account). */
  modules: Module[] | 'all';
  balanceCents: number;
  overdueCents: number;
  /** Oldest unpaid due date that's passed. */
  overdueSince: string | null;
  /** When the app turns (or turned) read-only. */
  suspendsOn: string | null;
  trialEndsAt: string | null;
}

const DAY = 86_400_000;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export const lockedFor = (acct: Pick<BillingAccount, 'plan' | 'level' | 'items'>) => lockedFeatures(acct);

export function stateFrom(
  acct: BillingAccount | null,
  unpaid: Array<{ dueDate: Date | null; totalCents: number; paidCents: number }>,
  now = new Date(),
): BillingState {
  const balanceCents = unpaid.reduce((s, i) => s + Math.max(0, i.totalCents - i.paidCents), 0);
  const empty = { locked: {}, modules: 'all' as const, balanceCents, overdueCents: 0, overdueSince: null, suspendsOn: null, trialEndsAt: null };
  if (!acct) return { stage: 'unbilled', ...empty };
  const trialEndsAt = acct.trialEndsAt && acct.trialEndsAt > now ? acct.trialEndsAt.toISOString() : null;
  const today = dateOnly(now);
  const late = unpaid.filter((i) => i.dueDate && dateOnly(i.dueDate) < today && i.totalCents > i.paidCents);
  const overdueCents = late.reduce((s, i) => s + (i.totalCents - i.paidCents), 0);
  const oldest = late.map((i) => i.dueDate!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const suspendsOn = oldest ? new Date(oldest.getTime() + acct.graceDays * DAY) : null;
  const held = !!acct.suspensionHoldUntil && acct.suspensionHoldUntil > now;
  const stage: BillingStage = suspendsOn && dateOnly(suspendsOn) <= today && !held ? 'suspended' : oldest ? 'overdue' : trialEndsAt ? 'trial' : 'ok';
  return {
    stage,
    locked: trialEndsAt ? {} : lockedFor(acct),
    modules: trialEndsAt ? 'all' : [...ownedItems(acct)],
    balanceCents,
    overdueCents,
    overdueSince: oldest ? dateOnly(oldest) : null,
    suspendsOn: suspendsOn ? dateOnly(suspendsOn) : null,
    trialEndsAt,
  };
}

/** Billing records live outside the organization's own tables (FH's books), so they're read directly. */
export async function billingState(tenantId: string, now = new Date()): Promise<BillingState> {
  const [acct, unpaid] = await Promise.all([
    db().billingAccount.findUnique({ where: { tenantId } }),
    db().invoice.findMany({ where: { tenantId, status: 'SENT' }, select: { dueDate: true, totalCents: true, paidCents: true } }),
  ]);
  return stateFrom(acct, unpaid, now);
}

/**
 * What a suspended (read-only) organization can still change: signing in,
 * safety records, clocking in and out, and paying what it owes.
 */
const STILL_WORKS = [
  /^\/api\/auth\//,
  /^\/api\/me\/passkeys/,
  /^\/api\/me\/password$/,
  /^\/api\/incidents$/,
  /^\/api\/ops\/(readings|headcounts|page-head-guard)/,
  /^\/api\/ops\/pools\/[^/]+\/closure$/,
  /^\/api\/(me\/)?lone-work/,
  /^\/api\/timeclock\//,
  /^\/api\/notifications\/read$/,
  /^\/api\/billing\//,
];
export const allowedWhileSuspended = (method: string, url: string) =>
  method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || STILL_WORKS.some((r) => r.test(url.split('?')[0]!));

/** Whether the plan includes a module that isn't a feature switch (single sign-on, the bank connection). */
export const hasModule = (b: Pick<BillingState, 'modules'>, m: Module) => b.modules === 'all' || b.modules.includes(m);
