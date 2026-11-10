/**
 * Direct deposit file in the Payments Canada CPA Standard 005 layout
 * (1464-character records: an "A" header, "C" credit records with up to six
 * 240-character payments each, and a "Z" trailer). Most Canadian banks accept it
 * for payroll deposits; each bank assigns the originator ID and data centre, and
 * some ask for small variations, so a city confirms the layout with its bank
 * and sends a test file first.
 */

export interface Originator {
  /** 10 characters, assigned by the bank. */
  originatorId: string;
  /** 0001–9999; must go up by one for every file sent to the bank. */
  fileCreationNumber: number;
  /** 5 digits, assigned by the bank. */
  destinationDataCentre: string;
  shortName: string;
  longName: string;
  /** Where the bank sends returned payments. */
  returns: { institution: string; transit: string; account: string };
}

export interface Payment {
  /** In cents. */
  amountCents: number;
  payeeName: string;
  institution: string;
  transit: string;
  account: string;
  /** Shown on the employee's bank statement, e.g. a statement id. */
  crossReference: string;
}

/** CPA-005 transaction code for payroll deposits. */
export const PAYROLL_DEPOSIT = '200';
const RECORD = 1464;

/** "0YYDDD": 0, two-digit year, day of the year. */
export function julian(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Math.floor((d.getTime() - start) / 86_400_000) + 1;
  return `0${String(d.getUTCFullYear() % 100).padStart(2, '0')}${String(day).padStart(3, '0')}`;
}

const alpha = (s: string, n: number) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // banks expect plain letters: é → e
    .replace(/[^A-Za-z0-9 .,'&/-]/g, ' ')
    .toUpperCase()
    .slice(0, n)
    .padEnd(n, ' ');
const num = (v: number | string, n: number) => {
  const s = String(v);
  if (!/^\d+$/.test(s) || s.length > n) throw new Error(`Not a ${n}-digit number: ${s}`);
  return s.padStart(n, '0');
};
const institutionId = (institution: string, transit: string) => `0${num(institution, 3)}${num(transit, 5)}`;
const account = (a: string) => {
  if (!/^\d{5,12}$/.test(a)) throw new Error('Account numbers are 5 to 12 digits.');
  return a.padEnd(12, ' ');
};

function segment(o: Originator, p: Payment, dueDate: string): string {
  const s = [
    PAYROLL_DEPOSIT, // 01-03 transaction type
    num(p.amountCents, 10), // 04-13 amount in cents
    julian(dueDate), // 14-19 date funds available
    institutionId(p.institution, p.transit), // 20-28
    account(p.account), // 29-40 payee account
    '0'.repeat(22), // 41-62 item trace number
    '000', // 63-65 stored transaction type
    alpha(o.shortName, 15), // 66-80
    alpha(p.payeeName, 30), // 81-110
    alpha(o.longName, 30), // 111-140
    alpha(o.originatorId, 10), // 141-150 originating direct clearer's user ID
    alpha(p.crossReference, 19), // 151-169 originator's cross reference
    institutionId(o.returns.institution, o.returns.transit), // 170-178 returns institution
    account(o.returns.account), // 179-190 returns account
    ' '.repeat(15), // 191-205 sundry information
    ' '.repeat(22), // 206-227 filler
    '  ', // 228-229 settlement code
    '0'.repeat(11), // 230-240 invalid data element ID
  ].join('');
  if (s.length !== 240) throw new Error(`CPA-005 segment is ${s.length} characters, not 240.`);
  return s;
}

/** Builds the file. Every record is 1464 characters, separated by CRLF. */
export function buildCpa005(o: Originator, payments: Payment[], dueDate: string, createdOn: string): string {
  if (!/^[A-Za-z0-9]{1,10}$/.test(o.originatorId)) throw new Error('The originator ID is up to 10 letters or digits.');
  if (o.fileCreationNumber < 1 || o.fileCreationNumber > 9999) throw new Error('File creation numbers run from 1 to 9999.');
  if (payments.some((p) => p.amountCents <= 0)) throw new Error('Every deposit must be more than $0.');
  const fcn = num(o.fileCreationNumber, 4);
  const id = alpha(o.originatorId, 10);
  const records: string[] = [];
  const head = (type: string) => `${type}${num(records.length + 1, 9)}${id}${fcn}`;
  records.push(`${head('A')}${julian(createdOn)}${num(o.destinationDataCentre, 5)}${' '.repeat(20)}CAD`.padEnd(RECORD, ' '));
  for (let i = 0; i < payments.length; i += 6) {
    const segs = payments.slice(i, i + 6).map((p) => segment(o, p, dueDate));
    records.push(`${head('C')}${segs.join('')}`.padEnd(RECORD, ' '));
  }
  const total = payments.reduce((s, p) => s + p.amountCents, 0);
  records.push(`${head('Z')}${num(0, 14)}${num(0, 8)}${num(total, 14)}${num(payments.length, 8)}${num(0, 14)}${num(0, 8)}${num(0, 14)}${num(0, 8)}`.padEnd(RECORD, ' '));
  for (const r of records) if (r.length !== RECORD) throw new Error(`CPA-005 record is ${r.length} characters, not ${RECORD}.`);
  return `${records.join('\r\n')}\r\n`;
}
