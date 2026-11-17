/** Kinds of leave (apps/api/src/services/people/leaveTypes.ts): six built in, and the organization's own. */
export type ApprovalStep = 'MANAGER' | 'HR';
export interface LeaveKind {
  id: string;
  code: string;
  /** The built-in TimeOffType, or null for the organization's own. */
  system: string | null;
  name: string;
  nameFr: string;
  paid: boolean;
  hasBalance: boolean;
  yearlyHours: number | null;
  carryOverMaxHours: number | null;
  protectedLeave: boolean;
  approvalChain: ApprovalStep[];
  payCode: string | null;
  sortOrder: number;
  archived: boolean;
}
/** What a request carries of its kind of leave. */
export interface LeaveKindBrief { id: string; code: string; name: string; nameFr: string; system: string | null; protectedLeave?: boolean; approvalChain?: unknown }

/** A kind of leave's label: built-in kinds by the app's own words (timeOff.types), the organization's by its names. */
export function leaveLabel(t: (k: string) => string, lng: string, k: { system: string | null | boolean; code: string; name: string; nameFr: string } | null | undefined, fallbackType?: string): string {
  if (!k) return t(`timeOff.types.${fallbackType ?? 'OTHER'}`);
  if (k.system) return t(`timeOff.types.${k.code}`);
  return lng.startsWith('fr') ? k.nameFr : k.name;
}

export const chainSteps = (k: { approvalChain?: unknown } | null | undefined): ApprovalStep[] => (Array.isArray(k?.approvalChain) ? (k!.approvalChain as unknown[]).filter((s): s is ApprovalStep => s === 'MANAGER' || s === 'HR') : []);
