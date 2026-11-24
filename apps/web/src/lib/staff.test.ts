import { describe, expect, it } from 'vitest';
import { hrBody } from './staff';

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

describe('HR record form', () => {
  it('sends a corrected name, phone and seniority hours', () => {
    const b = hrBody(form({ firstName: ' Jordan ', lastName: 'Singh', phone: '', roles: 'STAFF', status: 'ACTIVE', employment: 'PART_TIME', hireDate: '2025-05-01', seniorityDate: '2025-05-01', seniorityHours: '1240.5', vsc: '', dob: '', employeeNumber: '' }), { seniorityHours: '1500.00' });
    expect(b).toMatchObject({ firstName: 'Jordan', lastName: 'Singh', phone: null, seniorityHours: '1240.5', seniorityDate: '2025-05-01', roles: ['STAFF'] });
    // The sign-in email changes through its own confirmed flow, not this form.
    expect(b).not.toHaveProperty('email');
  });

  it('never turns a blank, unreadable or unchanged seniority hours field into a change (a blank used to save 0)', () => {
    const base = { firstName: 'A', lastName: 'B', roles: 'STAFF', status: 'ACTIVE', employment: 'CASUAL', seniorityDate: '' };
    expect(hrBody(form({ ...base, seniorityHours: '' }), { seniorityHours: '1500.00' })).not.toHaveProperty('seniorityHours');
    expect(hrBody(form({ ...base, seniorityHours: '12e' }), { seniorityHours: '1500.00' })).not.toHaveProperty('seniorityHours');
    expect(hrBody(form({ ...base, seniorityHours: '1500' }), { seniorityHours: '1500.00' })).not.toHaveProperty('seniorityHours');
    expect(hrBody(form({ ...base, seniorityHours: '0' }), { seniorityHours: '1500.00' })).toMatchObject({ seniorityHours: '0' });
  });

  it('leaves seniority alone where the organization doesn’t use it (the fields aren’t shown)', () => {
    const b = hrBody(form({ firstName: 'A', lastName: 'B', email: 'a@example.ca', roles: 'STAFF', status: 'ACTIVE', employment: 'CASUAL', hireDate: '' }));
    expect(b).not.toHaveProperty('seniorityDate');
    expect(b).not.toHaveProperty('seniorityHours');
  });
});
