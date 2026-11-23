/** The Approvals tabs, in order. */
export type ApprovalTab = 'claims' | 'timeoff' | 'punches' | 'trades';
const TAB_PERMISSION: Record<ApprovalTab, string> = { claims: 'shiftboard.approve', timeoff: 'timeoff.approve', punches: 'timeclock.review', trades: 'shiftboard.approve' };

/** Each tab only for those who may decide it: an empty "All clear" would hide requests waiting for someone else. */
export const approvalTabs = (can: (p: string) => boolean): ApprovalTab[] => (['claims', 'timeoff', 'punches', 'trades'] as const).filter((k) => can(TAB_PERMISSION[k]));
