import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '../../../api/src/auth/permissions';
import { approvalTabs } from './approvals';
import { hrTabs } from './hr';

const holds = (...perms: string[]) => (p: string) => perms.includes(p);
const role = (r: keyof typeof ROLE_PERMISSIONS) => (p: string) => (ROLE_PERMISSIONS[r] as string[]).includes(p);

describe('tabs follow the permission to act on them', () => {
  it('Approvals shows only the queues the person decides, never an "All clear" for someone else’s', () => {
    expect(approvalTabs(role('AQUATIC_SUPERVISOR'))).toEqual(['claims', 'timeoff', 'punches', 'trades']);
    // HR reviews timesheets but doesn't approve time off or claims.
    expect(approvalTabs(role('HR_ADMIN'))).toEqual(['punches']);
    expect(approvalTabs(holds('timeoff.approve'))).toEqual(['timeoff']);
    expect(approvalTabs(holds())).toEqual([]);
  });

  it('HR home: a leave administrator gets the overview and Leave, not tabs whose screens refuse them', () => {
    expect(hrTabs(holds('leave.manage'))).toEqual(['overview', 'leave']);
    expect(hrTabs(role('HR_ADMIN'))).toEqual(['overview', 'leave', 'reviews', 'policies', 'labour', 'offboarding']);
  });
});
