import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError, maskEmail } from '../../src/lib/log.js';
import { ConsoleMailer } from '../../src/services/notifications/mailer.js';

describe('logs carry no personal information', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cuts a database error to its code and first line, dropping the query’s data', () => {
    const err = Object.assign(new Error('\nInvalid `prisma.user.create()` invocation:\n\n{\n  data: {\n    firstName: "Avery",\n    dateOfBirth: "2009-04-02"\n  }\n}\n\nUnique constraint failed'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
    const out = describeError(err);
    expect(out).toContain('PrismaClientKnownRequestError P2002: Invalid `prisma.user.create()` invocation:');
    expect(out).not.toContain('Avery');
    expect(out).not.toContain('2009-04-02');
  });

  it('never prints an email’s contents (names, sign-in links)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await new ConsoleMailer().send({ to: 'avery.tremblay@city.ca', subject: 'Welcome, Avery', text: 'Set your password: https://x/reset?token=secret-token' });
    const printed = log.mock.calls.flat().join(' ');
    expect(printed).not.toMatch(/Avery|avery\.tremblay|secret-token/);
    expect(printed).toContain(maskEmail('avery.tremblay@city.ca'));
    expect(maskEmail('avery.tremblay@city.ca')).toBe('a•••@city.ca');
  });
});
