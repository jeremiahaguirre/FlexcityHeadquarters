/** Onboarding: shared types and helpers. */
export const OWNERS = ['HR', 'SUPERVISOR', 'EMPLOYEE'] as const;
export type State = 'DONE' | 'WAIVED' | 'EXPIRING' | 'EXPIRED' | 'PENDING';

export interface OnboardingItem {
  id: string;
  key: string | null;
  name: string;
  nameFr: string | null;
  description: string | null;
  descriptionFr?: string | null;
  owner: (typeof OWNERS)[number];
  kind: 'CHECK' | 'TRAINING' | 'ACKNOWLEDGEMENT' | 'DOCUMENT' | 'TASK';
  allStaff: boolean;
  blocksScheduling: boolean;
  validityMonths: number | null;
  policyText: string | null;
  archivedAt: string | null;
  positionIds: string[];
}

export interface ChecklistItem extends Omit<OnboardingItem, 'allStaff' | 'archivedAt' | 'positionIds'> {
  state: State;
  completedOn: string | null;
  expiresOn: string | null;
  note: string | null;
  waivedReason: string | null;
}

export const itemName = (i: { name: string; nameFr: string | null }, lng: string) => (lng.startsWith('fr') && i.nameFr ? i.nameFr : i.name);
export const stateTone = (s: State) => (s === 'DONE' ? 'ok' : s === 'WAIVED' ? 'neutral' : s === 'EXPIRING' ? 'warn' : s === 'EXPIRED' ? 'danger' : 'new');
export const isOpen = (s: State) => s === 'PENDING' || s === 'EXPIRED';
