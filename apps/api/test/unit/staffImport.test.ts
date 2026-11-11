import { describe, expect, it } from 'vitest';
import { AccessRole as PrismaAccessRole, EmploymentStatus as PrismaEmploymentStatus } from '@prisma/client';
import { type AccessRole, type EmploymentStatus, parseCsv, previewImport } from '../../src/services/platform/staffImport.js';
import { parseLogo } from '../../src/services/platform/logo.js';

const positions = [
  { id: 'p-guard', name: 'Lifeguard', nameFr: 'Sauveteur' },
  { id: 'p-wsi', name: 'Swim Instructor', nameFr: 'Moniteur de natation' },
];
const ctx = { existingEmails: new Set(['taken@city.ca']), positions, today: '2026-11-09' };

describe('CSV parsing', () => {
  it('handles quotes, commas inside quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"Smith, Jr.","say ""hi"""\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['Smith, Jr.', 'say "hi"'],
    ]);
  });
});

describe('staff import preview', () => {
  it('accepts friendly column names and values in English or French', () => {
    const p = previewImport(
      'Prénom,Nom,Courriel,Emploi,Postes,Date embauche,Employee number,Langue,Union\nAlex,Roy,ALEX@city.ca,temps partiel,Sauveteur; Swim Instructor,2026-05-01,E9,fr,oui\n',
      ctx,
    );
    expect(p.missingColumns).toEqual([]);
    expect(p.rows[0]).toMatchObject({ status: 'create', email: 'alex@city.ca', employmentStatus: 'PART_TIME', positionIds: ['p-guard', 'p-wsi'], locale: 'fr-CA', unionMember: true, roles: ['STAFF'] });
  });

  it('flags each problem on its own line and skips people already on staff', () => {
    const csv = [
      'first_name,last_name,email,employment,positions,date_of_birth,roles',
      'A,One,a@city.ca,casual,Lifeguard,2010-02-30,',
      'B,Two,a@city.ca,casual,Lifeguard,,',
      'C,Three,not-an-email,temp,Diver,,boss',
      'D,Four,taken@city.ca,,,,',
    ].join('\n');
    const p = previewImport(csv, ctx);
    expect(p.rows.map((r) => r.status)).toEqual(['error', 'error', 'error', 'exists']);
    expect(p.rows[0]!.errors).toEqual([{ field: 'dateOfBirth', code: 'DATE_FORMAT', value: '2010-02-30' }]);
    expect(p.rows[1]!.errors.map((e) => e.code)).toEqual(['DUPLICATE_IN_FILE']);
    expect(p.rows[2]!.errors.map((e) => e.code).sort()).toEqual(['EMAIL_INVALID', 'UNKNOWN_EMPLOYMENT', 'UNKNOWN_POSITION', 'UNKNOWN_ROLE']);
    expect(p.rows[3]!.warnings.map((w) => w.code)).toContain('NO_EMPLOYEE_NUMBER');
    expect(p.summary).toEqual({ create: 0, exists: 1, error: 3 });
  });

  it('reads a manager column: someone on staff or in the file, never a loop', () => {
    const csv = [
      'first_name,last_name,email,reports_to',
      'A,One,a@city.ca,taken@city.ca',
      'B,Two,b@city.ca,a@city.ca',
      'C,Three,c@city.ca,d@city.ca',
      'D,Four,d@city.ca,c@city.ca',
      'E,Five,e@city.ca,e@city.ca',
      'F,Six,f@city.ca,nobody@city.ca',
    ].join('\n');
    const p = previewImport(csv, ctx);
    expect(p.unknownColumns).toEqual([]);
    expect(p.rows.map((r) => r.managerEmail)).toEqual(['taken@city.ca', 'a@city.ca', 'd@city.ca', 'c@city.ca', 'e@city.ca', 'nobody@city.ca']);
    expect(p.rows.map((r) => r.errors.map((e) => e.code)[0] ?? r.status)).toEqual(['create', 'create', 'MANAGER_CYCLE', 'MANAGER_CYCLE', 'MANAGER_SELF', 'MANAGER_UNKNOWN']);
  });

  it('says which required columns are missing', () => {
    expect(previewImport('name,email\nX,x@y.ca', ctx).missingColumns).toEqual(['firstName', 'lastName']);
  });
});

describe('logo upload', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  it('accepts a real PNG and refuses a mislabelled or SVG file', () => {
    expect(parseLogo(`data:image/png;base64,${png}`).contentType).toBe('image/png');
    expect(() => parseLogo(`data:image/jpeg;base64,${png}`)).toThrow(/not a valid/);
    expect(() => parseLogo(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`)).toThrow(/PNG, JPEG or WebP/);
  });
});

// Compile-time: the file's own copies of the enums must equal Prisma's both ways (npm run typecheck).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameRoles: Same<AccessRole, PrismaAccessRole> = true;
const sameStatus: Same<EmploymentStatus, PrismaEmploymentStatus> = true;

describe('enum copies', () => {
  it('match the Prisma schema', () => {
    expect([sameRoles, sameStatus]).toEqual([true, true]);
    const roles: Record<AccessRole, true> = { HR_ADMIN: true, AQUATIC_SUPERVISOR: true, HEAD_LIFEGUARD: true, STAFF: true, FRONT_DESK: true, UNION_STEWARD: true, EMPLOYEE: true };
    const statuses: Record<EmploymentStatus, true> = { FULL_TIME: true, PART_TIME: true, CASUAL: true, ON_CALL: true, VOLUNTEER: true };
    expect(Object.keys(roles).sort()).toEqual(Object.values(PrismaAccessRole).sort());
    expect(Object.keys(statuses).sort()).toEqual(Object.values(PrismaEmploymentStatus).sort());
  });
});
