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
      ontarioReduction: { basic: 300 },
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
    MB: {
      brackets: [
        { upTo: 47000, rate: 0.108 },
        { upTo: 100000, rate: 0.1275 },
        { upTo: null, rate: 0.174 },
      ],
      basicPersonal: 15780,
    } satisfies ProvincialTable,
    SK: {
      brackets: [
        { upTo: 54532, rate: 0.105 },
        { upTo: 155805, rate: 0.125 },
        { upTo: null, rate: 0.145 },
      ],
      basicPersonal: 19866,
    } satisfies ProvincialTable,
    NB: {
      brackets: [
        { upTo: 52333, rate: 0.094 },
        { upTo: 104666, rate: 0.14 },
        { upTo: 193861, rate: 0.16 },
        { upTo: null, rate: 0.195 },
      ],
      basicPersonal: 13664,
      reduction: { amount: 833, rate: 0.03, threshold: 22805 },
    } satisfies ProvincialTable,
    NS: {
      brackets: [
        { upTo: 31117, rate: 0.0879 },
        { upTo: 62235, rate: 0.1495 },
        { upTo: 97801, rate: 0.1667 },
        { upTo: 157743, rate: 0.175 },
        { upTo: null, rate: 0.21 },
      ],
      basicPersonal: 11979,
    } satisfies ProvincialTable,
    PE: {
      brackets: [
        { upTo: 33928, rate: 0.095 },
        { upTo: 65820, rate: 0.1347 },
        { upTo: 106890, rate: 0.166 },
        { upTo: 142520, rate: 0.1762 },
        { upTo: null, rate: 0.19 },
      ],
      basicPersonal: 14650,
    } satisfies ProvincialTable,
    NL: {
      brackets: [
        { upTo: 45076, rate: 0.087 },
        { upTo: 90150, rate: 0.145 },
        { upTo: 160948, rate: 0.158 },
        { upTo: 225328, rate: 0.178 },
        { upTo: 287858, rate: 0.198 },
        { upTo: 575718, rate: 0.208 },
        { upTo: 1151435, rate: 0.213 },
        { upTo: null, rate: 0.218 },
      ],
      basicPersonal: 11288,
    } satisfies ProvincialTable,
    YT: {
      brackets: [
        { upTo: 58523, rate: 0.064 },
        { upTo: 117045, rate: 0.09 },
        { upTo: 181440, rate: 0.109 },
        { upTo: 500000, rate: 0.128 },
        { upTo: null, rate: 0.15 },
      ],
      basicPersonal: 16452,
    } satisfies ProvincialTable,
    NT: {
      brackets: [
        { upTo: 53003, rate: 0.059 },
        { upTo: 106009, rate: 0.086 },
        { upTo: 172346, rate: 0.122 },
        { upTo: null, rate: 0.1405 },
      ],
      basicPersonal: 18198,
    } satisfies ProvincialTable,
    NU: {
      brackets: [
        { upTo: 55801, rate: 0.04 },
        { upTo: 111602, rate: 0.07 },
        { upTo: 181439, rate: 0.09 },
        { upTo: null, rate: 0.115 },
      ],
      basicPersonal: 19659,
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
      employer: {
        hsf: { publicRate: 0.0426, minRate: 0.0165, maxRate: 0.0426, minUpTo: 1_000_000, maxFrom: 7_500_000 },
        cntRate: 0.0006,
        wsdrf: { rate: 0.01, threshold: 2_000_000 },
      },
    } satisfies QuebecTable,
  },
};

export const STARTING_NOTE = 'Unverified starting values. Compare every number with CRA’s T4127 for this year before verifying (and TP-1015.F for Quebec). Not modelled: Manitoba’s and Yukon’s phase-out of the basic personal amount for high earners, and provincial credits for dependants beyond the TD1 claim amount.';

/** Adds this year's starting tables (unverified) if they aren't there yet. */
export async function ensureTaxTables(tx: Tx, year: number) {
  for (const [jurisdiction, data] of Object.entries(STARTING_VALUES[year] ?? {})) {
    const row = await tx.payrollTaxTable.findUnique({ where: { year_jurisdiction: { year, jurisdiction } } });
    if (!row) {
      await tx.payrollTaxTable.create({ data: { year, jurisdiction, data: data as object, note: STARTING_NOTE } });
      continue;
    }
    // A table not yet verified gets any parts added since it was created (a verified one is never touched).
    const current = row.data as Record<string, unknown>;
    const missing = Object.entries(data).filter(([k]) => !(k in current));
    if (!row.verifiedAt && missing.length) await tx.payrollTaxTable.update({ where: { id: row.id }, data: { data: { ...current, ...Object.fromEntries(missing) } as object } });
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
