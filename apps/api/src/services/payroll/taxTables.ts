/**
 * Payroll tax tables: one per year and jurisdiction ("CA" = federal, CPP and EI).
 *
 * The starting values below are UNVERIFIED. They were entered from memory to
 * give each table its shape. A pay run can't be approved until FH staff compare
 * every number with CRA's T4127 "Payroll Deductions Formulas" for that year
 * (and the January / July editions when rates change mid-year) and mark the
 * table verified in the Dev console.
 */
import type { Tx } from '../../lib/db.js';
import type { FederalTable, ProvincialTable, QuebecTable } from './tax.js';

export const STARTING_VALUES: Record<number, Record<string, FederalTable | ProvincialTable | QuebecTable>> = {
  2026: {
    CA: {
      cpp: { rate: 0.0595, basicExemption: 3500, ympe: 74600, baseRate: 0.0495 },
      cpp2: { rate: 0.04, yampe: 85000 },
      ei: { rate: 0.0163, maxInsurable: 68900, employerMultiplier: 1.4 },
      brackets: [
        { upTo: 58523, rate: 0.14 },
        { upTo: 117045, rate: 0.205 },
        { upTo: 181440, rate: 0.26 },
        { upTo: 258482, rate: 0.29 },
        { upTo: null, rate: 0.33 },
      ],
      basicPersonal: { max: 16452, min: 14829, phaseOutFrom: 181440, phaseOutTo: 258482 },
      cea: 1501,
    } satisfies FederalTable,
    BC: {
      brackets: [
        { upTo: 50363, rate: 0.0506 },
        { upTo: 100728, rate: 0.077 },
        { upTo: 115648, rate: 0.105 },
        { upTo: 140430, rate: 0.1229 },
        { upTo: 190405, rate: 0.147 },
        { upTo: 265545, rate: 0.168 },
        { upTo: null, rate: 0.205 },
      ],
      basicPersonal: 13216,
      reduction: { amount: 575, rate: 0.0356, threshold: 25570 },
    } satisfies ProvincialTable,
    ON: {
      brackets: [
        { upTo: 53891, rate: 0.0505 },
        { upTo: 107785, rate: 0.0915 },
        { upTo: 150000, rate: 0.1116 },
        { upTo: 220000, rate: 0.1216 },
        { upTo: null, rate: 0.1316 },
      ],
      basicPersonal: 12989,
      surtax: [
        { threshold: 5818, rate: 0.2 },
        { threshold: 7446, rate: 0.36 },
      ],
      healthPremium: [
        { over: 20000, base: 0, rate: 0.06, max: 300 },
        { over: 36000, base: 300, rate: 0.06, max: 450 },
        { over: 48000, base: 450, rate: 0.25, max: 600 },
        { over: 72000, base: 600, rate: 0.25, max: 750 },
        { over: 200000, base: 750, rate: 0.25, max: 900 },
      ],
    } satisfies ProvincialTable,
    AB: {
      brackets: [
        { upTo: 61200, rate: 0.08 },
        { upTo: 154259, rate: 0.1 },
        { upTo: 185111, rate: 0.12 },
        { upTo: 246813, rate: 0.13 },
        { upTo: 370220, rate: 0.14 },
        { upTo: null, rate: 0.15 },
      ],
      basicPersonal: 22769,
    } satisfies ProvincialTable,
    // Compare with Revenu Québec's TP-1015.F and the QPP / QPIP rate notices for the year.
    QC: {
      qpp: { rate: 0.064, basicExemption: 3500, ympe: 74600, baseRate: 0.054 },
      qpp2: { rate: 0.04, yampe: 85000 },
      qpip: { employeeRate: 0.0043, employerRate: 0.00602, maxInsurable: 103000 },
      eiRate: 0.013,
      federalAbatement: 0.165,
      brackets: [
        { upTo: 54345, rate: 0.14 },
        { upTo: 108680, rate: 0.19 },
        { upTo: 132245, rate: 0.24 },
        { upTo: null, rate: 0.2575 },
      ],
      basicPersonal: 18952,
      employmentDeduction: { rate: 0.06, max: 1450 },
    } satisfies QuebecTable,
  },
};

export const STARTING_NOTE = 'Unverified starting values. Compare every number with CRA’s T4127 for this year before verifying. Ontario’s low-income tax reduction is not applied (slight over-withholding for low earners).';

/** Adds this year's starting tables (unverified) if they aren't there yet. */
export async function ensureTaxTables(tx: Tx, year: number) {
  for (const [jurisdiction, data] of Object.entries(STARTING_VALUES[year] ?? {})) {
    await tx.payrollTaxTable.upsert({ where: { year_jurisdiction: { year, jurisdiction } }, update: {}, create: { year, jurisdiction, data: data as object, note: STARTING_NOTE } });
  }
}

export interface LoadedTables {
  federal: { data: FederalTable; verified: boolean } | null;
  provincial: Map<string, { data: ProvincialTable; verified: boolean }>;
  quebec: { data: QuebecTable; verified: boolean } | null;
}

export async function loadTaxTables(tx: Tx, year: number): Promise<LoadedTables> {
  await ensureTaxTables(tx, year);
  const rows = await tx.payrollTaxTable.findMany({ where: { year } });
  const fed = rows.find((r) => r.jurisdiction === 'CA');
  return {
    federal: fed ? { data: fed.data as unknown as FederalTable, verified: !!fed.verifiedAt } : null,
    quebec: (() => {
      const qc = rows.find((r) => r.jurisdiction === 'QC');
      return qc ? { data: qc.data as unknown as QuebecTable, verified: !!qc.verifiedAt } : null;
    })(),
    provincial: new Map(rows.filter((r) => r.jurisdiction !== 'CA' && r.jurisdiction !== 'QC').map((r) => [r.jurisdiction, { data: r.data as unknown as ProvincialTable, verified: !!r.verifiedAt }])),
  };
}
