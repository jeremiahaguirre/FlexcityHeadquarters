import { describe, expect, it } from 'vitest';
import { buildCpa005, julian } from '../../src/services/payroll/cpa005.js';

const o = { originatorId: 'KELOWNA001', fileCreationNumber: 7, destinationDataCentre: '00310', shortName: 'City of Kelowna', longName: 'City of Kelowna Payroll', returns: { institution: '003', transit: '00010', account: '1234567' } };
const pay = (n: number) => ({ amountCents: 100_000 + n, payeeName: `Émilie Côté ${n}`, institution: '001', transit: '12345', account: '9876543', crossReference: `ST${n}` });

describe('CPA-005 direct deposit file', () => {
  it('writes Julian dates as 0YYDDD', () => {
    expect(julian('2026-01-01')).toBe('026001');
    expect(julian('2026-11-13')).toBe('026317');
  });

  it('builds 1464-character header, credit and trailer records', () => {
    const file = buildCpa005(o, Array.from({ length: 8 }, (_, i) => pay(i)), '2026-11-13', '2026-11-10');
    const lines = file.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(4); // A, C (6 payments), C (2 payments), Z
    for (const l of lines) expect(l).toHaveLength(1464);
    expect(lines[0]!.slice(0, 24)).toBe('A000000001KELOWNA0010007');
    expect(lines[0]!.slice(24, 30)).toBe('026314');
    expect(lines[0]!.slice(55, 58)).toBe('CAD');
    const seg = lines[1]!.slice(24, 264);
    expect(seg.slice(0, 3)).toBe('200');
    expect(seg.slice(3, 13)).toBe('0000100000');
    expect(seg.slice(19, 28)).toBe('000112345');
    expect(seg.slice(80, 110).trim()).toBe('EMILIE COTE 0'); // accents removed
    expect(lines[3]!.slice(0, 10)).toBe('Z000000004');
    const total = Array.from({ length: 8 }, (_, i) => 100_000 + i).reduce((a, b) => a + b, 0);
    expect(Number(lines[3]!.slice(46, 60))).toBe(total);
    expect(Number(lines[3]!.slice(60, 68))).toBe(8);
  });

  it('refuses bad account numbers and empty deposits', () => {
    expect(() => buildCpa005(o, [{ ...pay(1), account: '12' }], '2026-11-13', '2026-11-10')).toThrow(/5 to 12 digits/);
    expect(() => buildCpa005(o, [{ ...pay(1), amountCents: 0 }], '2026-11-13', '2026-11-10')).toThrow(/more than/);
  });
});
