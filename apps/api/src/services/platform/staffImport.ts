/**
 * Staff import from a spreadsheet (CSV). Validation is separate from writing so
 * the Dev console can show a row-by-row preview before anything is created.
 * Problems are codes (translated in the web app), never free text.
 */
import type { AccessRole, EmploymentStatus } from '@prisma/client';

export const MAX_IMPORT_ROWS = 2000;

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const HEADERS: Record<string, string> = {
  first_name: 'firstName', firstname: 'firstName', 'first name': 'firstName', prenom: 'firstName', prénom: 'firstName',
  last_name: 'lastName', lastname: 'lastName', 'last name': 'lastName', nom: 'lastName',
  email: 'email', courriel: 'email', 'e-mail': 'email',
  employment: 'employment', employment_status: 'employment', type: 'employment', emploi: 'employment',
  positions: 'positions', position: 'positions', postes: 'positions', poste: 'positions',
  roles: 'roles', role: 'roles', rôles: 'roles',
  hire_date: 'hireDate', 'hire date': 'hireDate', date_embauche: 'hireDate',
  date_of_birth: 'dateOfBirth', dob: 'dateOfBirth', 'date of birth': 'dateOfBirth', date_naissance: 'dateOfBirth',
  employee_number: 'employeeNumber', 'employee number': 'employeeNumber', employee_id: 'employeeNumber', numero_employe: 'employeeNumber',
  phone: 'phone', telephone: 'phone', téléphone: 'phone',
  language: 'locale', langue: 'locale', locale: 'locale',
  manager: 'manager', manager_email: 'manager', reports_to: 'manager', 'reports to': 'manager', gestionnaire: 'manager', superieur: 'manager', supérieur: 'manager', relève_de: 'manager', releve_de: 'manager',
  union_member: 'unionMember', union: 'unionMember', syndique: 'unionMember', syndiqué: 'unionMember',
};

const EMPLOYMENT: Record<string, EmploymentStatus> = {
  full_time: 'FULL_TIME', 'full-time': 'FULL_TIME', fulltime: 'FULL_TIME', 'full time': 'FULL_TIME', ft: 'FULL_TIME', 'temps plein': 'FULL_TIME',
  part_time: 'PART_TIME', 'part-time': 'PART_TIME', parttime: 'PART_TIME', 'part time': 'PART_TIME', pt: 'PART_TIME', 'temps partiel': 'PART_TIME',
  casual: 'CASUAL', occasionnel: 'CASUAL',
  on_call: 'ON_CALL', 'on-call': 'ON_CALL', 'on call': 'ON_CALL', 'sur appel': 'ON_CALL',
  volunteer: 'VOLUNTEER', bénévole: 'VOLUNTEER', benevole: 'VOLUNTEER',
};

const ROLES: Record<string, AccessRole> = {
  staff: 'STAFF', lifeguard: 'STAFF', instructor: 'STAFF',
  head_lifeguard: 'HEAD_LIFEGUARD', 'head lifeguard': 'HEAD_LIFEGUARD',
  aquatic_supervisor: 'AQUATIC_SUPERVISOR', supervisor: 'AQUATIC_SUPERVISOR', 'aquatic supervisor': 'AQUATIC_SUPERVISOR',
  front_desk: 'FRONT_DESK', 'front desk': 'FRONT_DESK',
  hr_admin: 'HR_ADMIN', hr: 'HR_ADMIN', 'hr administrator': 'HR_ADMIN',
  union_steward: 'UNION_STEWARD', steward: 'UNION_STEWARD', 'union steward': 'UNION_STEWARD',
  employee: 'EMPLOYEE', general: 'EMPLOYEE', 'general employee': 'EMPLOYEE', employé: 'EMPLOYEE', employe: 'EMPLOYEE',
};

export interface ImportIssue { field: string; code: string; value?: string }
export interface ImportRow {
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  employmentStatus: EmploymentStatus | null;
  roles: AccessRole[];
  /** The organization's own roles (water works, maintenance…), matched by name. */
  customRoleIds: string[];
  positionIds: string[];
  positions: string[];
  hireDate: string | null;
  dateOfBirth: string | null;
  employeeNumber: string | null;
  phone: string | null;
  locale: 'en-CA' | 'fr-CA';
  unionMember: boolean;
  /** Email of the person they report to: someone already on staff or another row of the file. */
  managerEmail: string | null;
  /** create: will be added · exists: already on staff, skipped · error: fix and re-upload */
  status: 'create' | 'exists' | 'error';
  errors: ImportIssue[];
  warnings: ImportIssue[];
}
export interface ImportPreview {
  rows: ImportRow[];
  missingColumns: string[];
  unknownColumns: string[];
  summary: { create: number; exists: number; error: number };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const isoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const list = (s: string) => s.split(/[;|]/).map((x) => x.trim()).filter(Boolean);

export function previewImport(
  text: string,
  ctx: {
    existingEmails: Set<string>;
    positions: Array<{ id: string; name: string; nameFr: string | null }>;
    customRoles?: Array<{ id: string; name: string; nameFr: string | null }>;
    today: string;
  },
): ImportPreview {
  const [header = [], ...body] = parseCsv(text);
  const cols = header.map((h) => HEADERS[norm(h).replace(/ /g, '_')] ?? HEADERS[norm(h)] ?? null);
  const missingColumns = ['firstName', 'lastName', 'email'].filter((c) => !cols.includes(c));
  const unknownColumns = header.filter((_, i) => !cols[i]).map((h) => h.trim()).filter(Boolean);
  if (body.length > MAX_IMPORT_ROWS) body.length = MAX_IMPORT_ROWS + 1; // the extra row flags the limit below
  const byName = new Map<string, string>();
  for (const p of ctx.positions) {
    byName.set(norm(p.name), p.id);
    if (p.nameFr) byName.set(norm(p.nameFr), p.id);
  }
  const customByName = new Map<string, string>();
  for (const r of ctx.customRoles ?? []) {
    customByName.set(norm(r.name), r.id);
    if (r.nameFr) customByName.set(norm(r.nameFr), r.id);
  }
  const seen = new Set<string>();

  const rows = body.map((cells, i): ImportRow => {
    const get = (k: string) => {
      const idx = cols.indexOf(k);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const line = i + 2;
    if (i >= MAX_IMPORT_ROWS) errors.push({ field: 'row', code: 'TOO_MANY_ROWS' });

    const firstName = get('firstName');
    const lastName = get('lastName');
    if (!firstName) errors.push({ field: 'firstName', code: 'REQUIRED' });
    if (!lastName) errors.push({ field: 'lastName', code: 'REQUIRED' });
    if (firstName.length > 60 || lastName.length > 60) errors.push({ field: 'name', code: 'TOO_LONG' });

    const email = get('email').toLowerCase();
    let status: ImportRow['status'] = 'create';
    if (!email) errors.push({ field: 'email', code: 'REQUIRED' });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) errors.push({ field: 'email', code: 'EMAIL_INVALID', value: email });
    else if (seen.has(email)) errors.push({ field: 'email', code: 'DUPLICATE_IN_FILE', value: email });
    else if (ctx.existingEmails.has(email)) status = 'exists';
    if (email) seen.add(email);

    const empRaw = get('employment');
    const employmentStatus = empRaw ? (EMPLOYMENT[norm(empRaw)] ?? EMPLOYMENT[norm(empRaw).replace(/ /g, '_')] ?? (empRaw.toUpperCase() in { FULL_TIME: 1, PART_TIME: 1, CASUAL: 1, ON_CALL: 1, VOLUNTEER: 1 } ? (empRaw.toUpperCase() as EmploymentStatus) : null)) : 'PART_TIME';
    if (!employmentStatus) errors.push({ field: 'employment', code: 'UNKNOWN_EMPLOYMENT', value: empRaw });
    if (!empRaw) warnings.push({ field: 'employment', code: 'DEFAULTED_PART_TIME' });

    const roleNames = list(get('roles'));
    const builtIn = (r: string) => ROLES[norm(r)] ?? ROLES[norm(r).replace(/ /g, '_')];
    const accessRoles = new Set<AccessRole>();
    const customRoleIds = new Set<string>();
    for (const r of roleNames) {
      const b = builtIn(r);
      const c = customByName.get(norm(r));
      if (b) accessRoles.add(b);
      else if (c) customRoleIds.add(c);
      else errors.push({ field: 'roles', code: 'UNKNOWN_ROLE', value: r });
    }
    // Nothing given → lifeguard/instructor; only the city's own roles → general employee underneath.
    if (!accessRoles.size) accessRoles.add(customRoleIds.size ? 'EMPLOYEE' : 'STAFF');
    const roles = [...accessRoles];

    const positions = list(get('positions'));
    const positionIds: string[] = [];
    for (const p of positions) {
      const id = byName.get(norm(p));
      if (id) positionIds.push(id);
      else errors.push({ field: 'positions', code: 'UNKNOWN_POSITION', value: p });
    }

    const date = (k: 'hireDate' | 'dateOfBirth') => {
      const v = get(k);
      if (!v) return null;
      if (!isoDate(v)) {
        errors.push({ field: k, code: 'DATE_FORMAT', value: v });
        return null;
      }
      if (v > ctx.today && k === 'dateOfBirth') errors.push({ field: k, code: 'DATE_IN_FUTURE', value: v });
      return v;
    };
    const hireDate = date('hireDate');
    const dateOfBirth = date('dateOfBirth');

    const employeeNumber = get('employeeNumber') || null;
    if (!employeeNumber) warnings.push({ field: 'employeeNumber', code: 'NO_EMPLOYEE_NUMBER' });
    else if (employeeNumber.length > 40) errors.push({ field: 'employeeNumber', code: 'TOO_LONG' });

    const lang = norm(get('locale'));
    const locale = lang.startsWith('fr') ? 'fr-CA' : 'en-CA';
    const unionRaw = norm(get('unionMember'));
    const unionMember = ['yes', 'y', 'true', '1', 'oui', 'o'].includes(unionRaw);
    const phone = get('phone').slice(0, 30) || null;
    const managerEmail = get('manager').toLowerCase() || null;
    if (managerEmail && managerEmail === email) errors.push({ field: 'manager', code: 'MANAGER_SELF', value: managerEmail });

    return {
      line,
      firstName,
      lastName,
      email,
      employmentStatus,
      roles,
      customRoleIds: [...customRoleIds],
      positionIds,
      positions,
      hireDate,
      dateOfBirth,
      employeeNumber,
      phone,
      locale,
      unionMember,
      managerEmail,
      status: errors.length ? 'error' : status,
      errors,
      warnings,
    };
  });

  // Managers: on staff already or in this file, and never a loop within the file.
  const inFile = new Map(rows.map((r) => [r.email, r]));
  for (const r of rows) {
    const m = r.managerEmail;
    if (!m || r.errors.some((e) => e.field === 'manager')) continue;
    if (!ctx.existingEmails.has(m) && !inFile.has(m)) r.errors.push({ field: 'manager', code: 'MANAGER_UNKNOWN', value: m });
    else {
      const seen = new Set([r.email]);
      for (let cur = inFile.get(m); cur; cur = cur.managerEmail ? inFile.get(cur.managerEmail) : undefined) {
        // Someone already on staff keeps their own manager: the chain stops there.
        if (cur.status === 'exists' || ctx.existingEmails.has(cur.email)) break;
        if (seen.has(cur.email)) {
          r.errors.push({ field: 'manager', code: 'MANAGER_CYCLE', value: m });
          break;
        }
        seen.add(cur.email);
      }
    }
    if (r.errors.length) r.status = 'error';
  }

  const summary = { create: 0, exists: 0, error: 0 };
  for (const r of rows) summary[r.status]++;
  return { rows, missingColumns, unknownColumns, summary };
}
