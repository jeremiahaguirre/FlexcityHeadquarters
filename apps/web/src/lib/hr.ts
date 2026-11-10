export const LEAVE_TYPES = ['VACATION', 'SICK', 'PROTECTED_LEAVE', 'UNPAID_PERSONAL', 'OTHER'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export interface LeaveBalance { type: LeaveType; entitled: number | null; carryover: number; used: number; pending: number; remaining: number | null; set: boolean; note: string | null }
export interface PersonBalances { userId: string; name: string; types: LeaveBalance[] }

export type ReviewStatus = 'SELF' | 'MANAGER' | 'DISCUSS' | 'ACKNOWLEDGED';
export interface Review {
  id: string;
  userId: string;
  reviewerId: string;
  employee: string;
  reviewer: string;
  cycle: string;
  dueOn: string;
  status: ReviewStatus;
  goals: Array<{ text: string; met: boolean | null }>;
  selfComments: string | null;
  managerComments: string | null;
  rating: number | null;
  employeeComments: string | null;
  acknowledgedAt: string | null;
  mine?: boolean;
  reviewing?: boolean;
}

export interface Course { id: string; name: string; nameFr: string | null; hours: number; mandatory: boolean; renewMonths: number | null; positionIds: string[]; active: boolean }
export interface TrainingDue { userId: string; courseId: string; status: 'MISSING' | 'EXPIRED' | 'DUE_SOON'; expiresOn: string | null; name?: string }
export interface TrainingRecord { id: string; courseId: string; userId?: string; name?: string; completedOn: string; hours: number | null; trainer: string | null }

export const GRIEVANCE_STATUSES = ['FILED', 'STEP_1', 'STEP_2', 'STEP_3', 'ARBITRATION', 'RESOLVED', 'WITHDRAWN'] as const;
export type GrievanceStatus = (typeof GRIEVANCE_STATUSES)[number];
export interface Grievance { id: string; number: number; userId: string | null; grievor: string | null; kind: 'INDIVIDUAL' | 'GROUP' | 'POLICY'; title: string; articles: string | null; filedOn: string; status: GrievanceStatus; dueOn: string | null; outcome: string | null; history: Array<{ at: string; by: string; status: GrievanceStatus; note: string | null }> }

export const OFFBOARD_REASONS = ['RESIGNATION', 'RETIREMENT', 'END_OF_SEASON', 'END_OF_CONTRACT', 'DISMISSAL', 'LAYOFF', 'OTHER'] as const;
export interface Offboarding { id: string; userId: string; name: string; lastDay: string; reason: (typeof OFFBOARD_REASONS)[number]; checklist: Array<{ key: string; done: boolean; doneAt: string | null }>; completedAt: string | null }

export interface HrOverview { staff: number; openJobs: number; draftRuns: number; pendingBank: number; plans: number; enrolled: number; openClaims: number; activeAccommodations: number; openGrievances: number; reviewsOpen: number; reviewsLate: number; offboarding: number; flagged: number; trainingDue: number }

export const courseName = (c: { name: string; nameFr: string | null }, lng: string) => (lng === 'fr-CA' && c.nameFr ? c.nameFr : c.name);
