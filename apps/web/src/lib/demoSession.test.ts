import { describe, expect, it } from 'vitest';
import { emptySession, sessionRead, sessionWrite, templatePreview } from './demoSession';
import type { ConversationDetail } from './messages';
import type { TemplatesView } from './shiftTemplates';

const me = { id: 'u-me', firstName: 'Jordan', lastName: 'Singh' };
const now = new Date('2026-11-12T18:00:00Z');

describe('demo session', () => {
  it('keeps a sent message in its conversation and moves the list’s last-message time', () => {
    const w = sessionWrite(emptySession(), '/api/messages/conversations/c1/messages', 'POST', { text: '  See you at 6  ' }, { me, now })!;
    expect(w.response).toMatchObject({ mine: true, text: 'See you at 6', authorId: 'u-me', author: 'Jordan Singh' });
    const detail: ConversationDetail = { id: 'c1', kind: 'DIRECT', title: 'Sam', readOnly: null, muted: false, closesAt: null, owner: false, investigation: null, members: [], messages: [], more: false };
    expect((sessionRead(w.state, '/api/messages/conversations/c1', detail) as ConversationDetail).messages.map((m) => m.text)).toEqual(['See you at 6']);
    expect(sessionRead(w.state, '/api/messages/conversations/c2', detail)).toBe(detail);
    const list = sessionRead(w.state, '/api/messages/conversations', [{ id: 'c1', lastMessageAt: '2026-11-11T00:00:00Z' }, { id: 'c2', lastMessageAt: null }]) as Array<{ lastMessageAt: string | null }>;
    expect(list.map((c) => c.lastMessageAt)).toEqual([now.toISOString(), null]);
  });

  it('ignores an empty message and writes it doesn’t keep', () => {
    expect(sessionWrite(emptySession(), '/api/messages/conversations/c1/messages', 'POST', { text: ' ' }, { me })).toBeUndefined();
    expect(sessionWrite(emptySession(), '/api/messages/m1', 'PATCH', { text: 'x' }, { me })).toBeUndefined();
  });

  it('marks an answered survey as answered, and only that one', () => {
    const w = sessionWrite(emptySession(), '/api/me/surveys/s1/answers', 'POST', { answers: { week: 4 } }, { me })!;
    const list = sessionRead(w.state, '/api/me/surveys', [{ id: 's1', responded: false }, { id: 's2', responded: false }]) as Array<{ responded: boolean }>;
    expect(list.map((s) => s.responded)).toEqual([true, false]);
  });

  it('returns saved preferences with the limits and the time saved', () => {
    const body = { preferences: [{ kind: 'AVOID', daysOfWeek: [0], startMinute: null, endMinute: null, positionId: null, facilityId: null, note: 'Family day' }], maxWeeklyHours: 24, maxDaysPerWeek: null };
    const w = sessionWrite(emptySession(), '/api/me/preferences', 'PUT', body, { me, now })!;
    const r = sessionRead(w.state, '/api/me/preferences', { preferences: [], maxWeeklyHours: null, maxDaysPerWeek: 5, updatedAt: null, positions: [{ id: 'p' }] }) as Record<string, unknown>;
    expect(r).toMatchObject({ maxWeeklyHours: 24, maxDaysPerWeek: null, updatedAt: now.toISOString(), positions: [{ id: 'p' }] });
    expect((r.preferences as Array<{ id: string; note: string }>)[0]).toMatchObject({ id: 'demo-pref-1', note: 'Family day' });
  });

  it('keeps a bid ranking per round', () => {
    const w = sessionWrite(emptySession(), '/api/me/bids/r1/choices', 'PUT', { itemIds: ['b', 'a'] }, { me })!;
    const rounds = sessionRead(w.state, '/api/me/bids', [{ id: 'r1', myChoices: ['a'] }, { id: 'r2', myChoices: ['z'] }]) as Array<{ myChoices: string[] }>;
    expect(rounds.map((r) => r.myChoices)).toEqual([['b', 'a'], ['z']]);
  });

  it('previews a template: each line on its weekdays, times its headcount, inside the template’s dates', () => {
    const slot = (daysOfWeek: number[], headcount: number) => ({ id: `s${headcount}`, daysOfWeek, startMinute: 22 * 60, endMinute: 30 * 60, facilityId: 'f', positionId: 'p', headcount, unpaidBreakMinutes: null });
    // Mon 2026-11-16 to Mon 2026-11-23: one week.
    const r = templatePreview({ slots: [slot([1, 2, 3, 4, 5], 1), slot([0, 6], 3)], validFrom: null, validTo: null }, '2026-11-16', '2026-11-23');
    expect(r.created).toBe(5 + 2 * 3);
    expect(r.outsideDates).toBe(0);
    expect(r.items[0]).toMatchObject({ date: '2026-11-16', startsAt: '2026-11-16T22:00:00', endsAt: '2026-11-17T06:00:00', status: 'create' });
    // Valid only from Thursday: Mon–Wed are outside its dates.
    const later = templatePreview({ slots: [slot([1, 2, 3, 4, 5], 1)], validFrom: '2026-11-19', validTo: null }, '2026-11-16', '2026-11-23');
    expect(later).toMatchObject({ created: 2, outsideDates: 3 });
    expect(templatePreview({ slots: [slot([1], 1)], validFrom: '2027-06-29', validTo: '2027-09-07' }, '2026-11-16', '2026-11-23')).toMatchObject({ created: 0, outsideDates: 7, items: [] });
  });

  it('answers a template preview and an apply from the recorded templates', () => {
    const templates = { templates: [{ id: 't1', slots: [{ id: 's', daysOfWeek: [1], startMinute: 360, endMinute: 840, facilityId: 'f', positionId: 'p', headcount: 2, unpaidBreakMinutes: 30 }], validFrom: null, validTo: null }] } as unknown as TemplatesView;
    const dry = sessionWrite(emptySession(), '/api/schedule/templates/t1/apply', 'POST', { from: '2026-11-16', to: '2026-11-30', dryRun: true }, { me, templates })!;
    expect(dry.response).toMatchObject({ created: 4, applicationId: null });
    const real = sessionWrite(emptySession(), '/api/schedule/templates/t1/apply', 'POST', { from: '2026-11-16', to: '2026-11-30' }, { me, templates })!;
    expect(real.response).toMatchObject({ created: 4, applicationId: 'demo-application' });
    expect(sessionWrite(emptySession(), '/api/schedule/templates/nope/apply', 'POST', { from: '2026-11-16', to: '2026-11-30' }, { me, templates })).toBeUndefined();
  });
});
