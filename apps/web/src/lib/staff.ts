export const ROLES = ['STAFF', 'HEAD_LIFEGUARD', 'AQUATIC_SUPERVISOR', 'FRONT_DESK', 'HR_ADMIN', 'UNION_STEWARD', 'EMPLOYEE'] as const;
export const EMPLOYMENT = ['FULL_TIME', 'PART_TIME', 'CASUAL', 'ON_CALL', 'VOLUNTEER'] as const;
export const TIERS = ['A_SQUAD', 'B_SQUAD', 'C_SQUAD', 'UNASSIGNED'] as const;
export interface Position { id: string; name: string; nameFr: string | null }

/**
 * HR's record form as the API takes it. Only fields the form shows are sent (seniority is hidden where the
 * organization doesn't use it, so its date and hours are left alone); blanks clear dates, phone and employee number.
 */
export function hrBody(f: FormData) {
  const val = (k: string) => String(f.get(k) ?? '').trim() || null;
  const shown = (k: string) => f.has(k);
  return {
    ...(shown('firstName') ? { firstName: String(f.get('firstName')).trim() } : {}),
    ...(shown('lastName') ? { lastName: String(f.get('lastName')).trim() } : {}),
    ...(shown('email') ? { email: String(f.get('email')).trim() } : {}),
    ...(shown('phone') ? { phone: val('phone') } : {}),
    roles: f.getAll('roles').length ? f.getAll('roles') : f.getAll('customRoles').length ? ['EMPLOYEE'] : [],
    customRoleIds: f.getAll('customRoles'),
    status: val('status'),
    employmentStatus: val('employment'),
    hireDate: val('hireDate'),
    ...(shown('seniorityDate') ? { seniorityDate: val('seniorityDate') } : {}),
    ...(shown('seniorityHours') ? { seniorityHours: String(Number(f.get('seniorityHours') || 0)) } : {}),
    vscClearedDate: val('vsc'),
    dateOfBirth: val('dob'),
    employeeNumber: val('employeeNumber'),
    unionMember: f.get('union') === 'on',
  };
}
