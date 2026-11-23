export const ROLES = ['STAFF', 'HEAD_LIFEGUARD', 'AQUATIC_SUPERVISOR', 'FRONT_DESK', 'HR_ADMIN', 'UNION_STEWARD', 'EMPLOYEE'] as const;
export const EMPLOYMENT = ['FULL_TIME', 'PART_TIME', 'CASUAL', 'ON_CALL', 'VOLUNTEER'] as const;
export const TIERS = ['A_SQUAD', 'B_SQUAD', 'C_SQUAD', 'UNASSIGNED'] as const;
export interface Position { id: string; name: string; nameFr: string | null }

/**
 * HR's record form as the API takes it. Only fields the form shows are sent (seniority is hidden where the
 * organization doesn't use it, so its date and hours are left alone); blanks clear dates, phone and employee number.
 * Seniority hours are sent only when a value is typed and differs from the record: a blank never becomes 0.
 * The sign-in email isn't edited here (its change is confirmed from the new address).
 */
export function hrBody(f: FormData, current: { seniorityHours?: string | null } = {}) {
  const val = (k: string) => String(f.get(k) ?? '').trim() || null;
  const shown = (k: string) => f.has(k);
  return {
    ...(shown('firstName') ? { firstName: String(f.get('firstName')).trim() } : {}),
    ...(shown('lastName') ? { lastName: String(f.get('lastName')).trim() } : {}),
    ...(shown('phone') ? { phone: val('phone') } : {}),
    roles: f.getAll('roles').length ? f.getAll('roles') : f.getAll('customRoles').length ? ['EMPLOYEE'] : [],
    customRoleIds: f.getAll('customRoles'),
    status: val('status'),
    employmentStatus: val('employment'),
    hireDate: val('hireDate'),
    ...(shown('seniorityDate') ? { seniorityDate: val('seniorityDate') } : {}),
    ...(hoursChanged(f.get('seniorityHours'), current.seniorityHours) ? { seniorityHours: String(f.get('seniorityHours')).trim() } : {}),
    vscClearedDate: val('vsc'),
    dateOfBirth: val('dob'),
    employeeNumber: val('employeeNumber'),
    unionMember: f.get('union') === 'on',
  };
}

/** A typed, valid number of hours that isn't the stored one (1240.5 and "1240.50" are the same). */
function hoursChanged(typed: FormDataEntryValue | null, stored: string | null | undefined): boolean {
  const v = typeof typed === 'string' ? typed.trim() : '';
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(v)) return false;
  return stored == null || Number(v) !== Number(stored);
}
