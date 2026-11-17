import { describe, expect, it } from 'vitest';
import { hrBody } from './staff';

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

describe('HR record form', () => {
  it('sends a corrected name, email, phone and seniority hours', () => {
    const b = hrBody(form({ firstName: ' Jordan ', lastName: 'Singh', email: 'jordan.singh@example.ca', phone: '', roles: 'STAFF', status: 'ACTIVE', employment: 'PART_TIME', hireDate: '2025-05-01', seniorityDate: '2025-05-01', seniorityHours: '1240.5', vsc: '', dob: '', employeeNumber: '' }));
    expect(b).toMatchObject({ firstName: 'Jordan', lastName: 'Singh', email: 'jordan.singh@example.ca', phone: null, seniorityHours: '1240.5', seniorityDate: '2025-05-01', roles: ['STAFF'] });
  });

  it('leaves seniority alone where the organization doesn’t use it (the fields aren’t shown)', () => {
    const b = hrBody(form({ firstName: 'A', lastName: 'B', email: 'a@example.ca', roles: 'STAFF', status: 'ACTIVE', employment: 'CASUAL', hireDate: '' }));
    expect(b).not.toHaveProperty('seniorityDate');
    expect(b).not.toHaveProperty('seniorityHours');
  });
});
