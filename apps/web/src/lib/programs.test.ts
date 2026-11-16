import { describe, expect, it } from 'vitest';
import { ageMonths, campaignBody, cents, levelBody } from './programs';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('program forms', () => {
  it('a campaign edit can clear its French name, dates and notes, and keeps only real skip dates', () => {
    expect(campaignBody(form({ name: ' Winter ', nameFr: '', kind: 'LESSONS', startsOn: '2027-01-04', endsOn: '2027-03-01', opens: '', closes: '', skip: '2027-02-15, soon,2027-02-16', notes: '' }))).toEqual({
      name: 'Winter', nameFr: null, kind: 'LESSONS', startsOn: '2027-01-04', endsOn: '2027-03-01', registrationOpensAt: null, registrationClosesAt: null, skipDates: ['2027-02-15', '2027-02-16'], notes: null,
    });
  });

  it('prices in dollars become cents; ages in years and months become months; blanks are none', () => {
    expect(cents('95,50')).toBe(9550);
    expect(cents(' ')).toBeNull();
    expect(ageMonths('3', '6')).toBe(42);
    expect(ageMonths('', '')).toBeNull();
    expect(levelBody(form({ program: 'Adult', name: 'Adult 1', nameFr: '', minYears: '18', minMonths: '', maxYears: '', maxMonths: '', ratio: '6', duration: '45', active: 'on' }))).toEqual({
      program: 'Adult', name: 'Adult 1', nameFr: null, minAgeMonths: 216, maxAgeMonths: null, ratio: 6, durationMinutes: 45, parentInWater: false, active: true,
    });
  });
});
