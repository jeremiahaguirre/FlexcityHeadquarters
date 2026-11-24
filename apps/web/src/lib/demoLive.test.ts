import { describe, expect, it } from 'vitest';
import { loadFixtures } from './demoFixtures';
import { DEMO_FRENCH, inFrench } from './demoFrench';
import { OPEN_PUNCH_MINUTES, liveTimes } from './demoLive';
import guard from './demo-fixtures/guard.json';
import hr from './demo-fixtures/hr.json';
import supervisor from './demo-fixtures/supervisor.json';
import waterworks from './demo-fixtures/waterworks.json';
import frontdesk from './demo-fixtures/frontdesk.json';
import steward from './demo-fixtures/steward.json';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-12-03T19:30:00Z');
const today = '2026-12-03';

describe('demo: times that run up to now', () => {
  it('the open punch started a few hours ago, not a day ago', async () => {
    const data = await loadFixtures('guard', today);
    const open = liveTimes('/api/me/punch/open', data.get('/api/me/punch/open'), NOW) as { clockIn: string; shift: { startsAt: string; endsAt: string } };
    const worked = (NOW - Date.parse(open.clockIn)) / HOUR;
    expect(worked).toBeGreaterThan(2);
    expect(worked).toBeLessThan(5);
    expect(worked * 60).toBeCloseTo(OPEN_PUNCH_MINUTES, 0);
    // Its shift is still running.
    expect(Date.parse(open.shift.startsAt)).toBeLessThanOrEqual(NOW);
    expect(Date.parse(open.shift.endsAt)).toBeGreaterThan(NOW);
  });

  it('the timeclock list shows the same open punch at the same time', async () => {
    const data = await loadFixtures('guard', today);
    const url = `/api/me/punches?from=${encodeURIComponent(new Date(NOW - 14 * 24 * HOUR).toISOString())}&to=${encodeURIComponent(new Date(NOW + 24 * HOUR).toISOString())}`;
    const list = liveTimes(url, data.get(url), NOW) as Array<{ localClockOut: string | null; localClockIn: string }>;
    const open = list.filter((p) => p.localClockOut === null);
    expect(open).toHaveLength(1);
    const openNow = liveTimes('/api/me/punch/open', data.get('/api/me/punch/open'), NOW) as { localClockIn: string };
    expect(open[0]!.localClockIn).toBe(openNow.localClockIn);
  });

  it('a running lone-work session checked in within its interval, or is overdue by minutes, not days', async () => {
    for (const [role, path] of [['hr', '/api/lone-work'], ['supervisor', '/api/lone-work'], ['waterworks', '/api/me/lone-work']] as const) {
      const data = await loadFixtures(role, today);
      const live = liveTimes(path, data.get(path), NOW);
      const sessions = (Array.isArray(live) ? live : [live]) as Array<{ status: string; lastCheckInAt: string; nextDueAt: string; startedAt: string; intervalMinutes: number }>;
      expect(sessions.length, `${role} ${path}`).toBeGreaterThan(0);
      for (const s of sessions) {
        expect(NOW - Date.parse(s.startedAt), `${role} started today`).toBeLessThan(4 * HOUR);
        if (s.status === 'OVERDUE') expect(Date.parse(s.nextDueAt)).toBeLessThan(NOW);
        if (s.status === 'ACTIVE') expect(Date.parse(s.nextDueAt)).toBeGreaterThan(NOW);
        expect(Date.parse(s.nextDueAt) - Date.parse(s.lastCheckInAt)).toBe(s.intervalMinutes * 60_000);
      }
    }
  });

  it('the supervisor’s Lone workers screen has someone on it', async () => {
    const data = await loadFixtures('supervisor', today);
    const list = data.get('/api/lone-work') as Array<{ status: string; person: string }>;
    expect(list.filter((s) => s.status !== 'ENDED').length).toBeGreaterThan(0);
  });
});

describe('demo: sample text on French screens', () => {
  const all = JSON.stringify([guard, hr, supervisor, waterworks, frontdesk, steward]);

  it('every sample sentence it translates is in a recording (none left behind after a re-capture)', () => {
    const missing = Object.keys(DEMO_FRENCH).filter((en) => !all.includes(JSON.stringify(en).slice(1, -1)));
    expect(missing).toEqual([]);
  });

  it('translates whole strings anywhere in an answer, and leaves names alone', () => {
    const out = inFrench({ items: [{ location: 'Pump station 4, lower level', task: 'Valve inspection', person: 'Drew Kowalski', intervalMinutes: 60 }] });
    expect(out).toEqual({ items: [{ location: 'Station de pompage 4, niveau inférieur', task: 'Inspection de vannes', person: 'Drew Kowalski', intervalMinutes: 60 }] });
  });

  it('the lone-work screens read in French', async () => {
    for (const role of ['hr', 'supervisor'] as const) {
      const data = await loadFixtures(role, today);
      const text = JSON.stringify(inFrench(data.get('/api/lone-work')));
      expect(text).not.toMatch(/Pump station|Valve inspection|Pool mechanical room|Chlorine feed/);
    }
  });
});
