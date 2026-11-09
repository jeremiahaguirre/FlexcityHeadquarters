import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasEmailTemplate, renderEmail } from '../../src/services/notifications/mailer.js';

describe('email templates', () => {
  it('has a template for every email the notifier queues', () => {
    const src = readFileSync('src/services/notifications/notifier.ts', 'utf8');
    const used = [...src.matchAll(/email: '([a-z_]+)'/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const t of used) expect(hasEmailTemplate(t), t).toBe(true);
  });

  it('renders French for French-speaking staff', () => {
    expect(renderEmail('time_off_decided', 'fr-CA', { status: 'APPROVED' }).subject).toBe('Votre demande de congé a été approuvée');
    expect(renderEmail('time_off_decided', 'en-CA', { status: 'DENIED' }).subject).toBe('Your time-off request was declined');
  });

  it('refuses unknown templates', () => {
    expect(() => renderEmail('nope', 'en-CA', {})).toThrow(/Unknown email template/);
  });
});
