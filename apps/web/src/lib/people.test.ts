import { describe, expect, it } from 'vitest';
import { type CaseFile, recentFacts, requiredChecks } from './people';

describe('people helpers', () => {
  it('mirrors the API on which confirmations a record needs', () => {
    expect(requiredChecks('VERBAL_WARNING', true)).toEqual([]);
    expect(requiredChecks('SUSPENSION', true)).toEqual(['factsReviewed', 'protectedGrounds', 'employeeHeard', 'agreementChecked', 'stewardOffered']);
    expect(requiredChecks('TERMINATION', false)).toEqual(['factsReviewed', 'protectedGrounds', 'employeeHeard', 'agreementChecked', 'counselReviewed']);
  });

  it('offers only counted concerns from the last 90 days as evidence', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const iso = (d: number) => new Date(now - d * 86_400_000).toISOString();
    const file = {
      events: [
        { id: 'a', counted: true, points: -15, occurredAt: iso(5) },
        { id: 'b', counted: false, points: -15, occurredAt: iso(5) },
        { id: 'c', counted: true, points: 2, occurredAt: iso(5) },
        { id: 'd', counted: true, points: -2, occurredAt: iso(120) },
      ],
      notes: [
        { id: 'n1', category: 'CONDUCT', retractedAt: null, occurredAt: iso(3) },
        { id: 'n2', category: 'COMMENDATION', retractedAt: null, occurredAt: iso(3) },
        { id: 'n3', category: 'POLICY', retractedAt: iso(1), occurredAt: iso(3) },
      ],
    } as unknown as CaseFile;
    const r = recentFacts(file, now);
    expect(r.events.map((e) => e.id)).toEqual(['a']);
    expect(r.notes.map((n) => n.id)).toEqual(['n1']);
  });
});
