import { describe, expect, it } from 'vitest';
import { buildSchoolCalendar } from '../../src/services/compliance/schoolCalendar.js';
import { DEFAULT_SCHOOL_CALENDAR } from '../../src/services/scheduling/eligibility.js';

describe('school calendar', () => {
  const cal = buildSchoolCalendar([
    { kind: 'TERM', startsOn: '2026-09-02', endsOn: '2027-06-25' },
    { kind: 'BREAK', startsOn: '2026-12-21', endsOn: '2027-01-01' },
  ]);
  it('weekdays in a term are school days', () => expect(cal.isSchoolDay('2026-10-07')).toBe(true));
  it('breaks and weekends are not', () => {
    expect(cal.isSchoolDay('2026-12-22')).toBe(false);
    expect(cal.isSchoolDay('2026-10-10')).toBe(false);
  });
  it('days outside every term are not (e.g. summer)', () => expect(cal.isSchoolDay('2026-07-15')).toBe(false));
  it('falls back to the default when no terms are entered', () => expect(buildSchoolCalendar([])).toBe(DEFAULT_SCHOOL_CALENDAR));
});
