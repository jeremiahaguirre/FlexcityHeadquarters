export const ROLES = ['STAFF', 'HEAD_LIFEGUARD', 'AQUATIC_SUPERVISOR', 'FRONT_DESK', 'HR_ADMIN', 'UNION_STEWARD', 'EMPLOYEE'] as const;
export const EMPLOYMENT = ['FULL_TIME', 'PART_TIME', 'CASUAL', 'ON_CALL', 'VOLUNTEER'] as const;
export const TIERS = ['A_SQUAD', 'B_SQUAD', 'C_SQUAD', 'UNASSIGNED'] as const;
export interface Position { id: string; name: string; nameFr: string | null }
