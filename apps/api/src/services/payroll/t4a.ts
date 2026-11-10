/**
 * T4A slips for people paid who aren't employees: fees for services (box 048),
 * other income such as honoraria (box 028), self-employed commissions (box 020),
 * and any income tax withheld (box 022).
 *
 * A slip is needed when a payee's boxes total more than $500 in the year, or tax
 * was withheld. The XML follows CRA's T4A layout (T619 transmittal, T4A slips,
 * T4A summary); run the first file through CRA's validation before filing.
 */
import type { Tx } from '../../lib/db.js';
import { open } from '../crypto/envelope.js';
import { keys } from '../../routes/context.js';
import type { MailingAddress } from './bank.js';
import type { Employer } from './filingXml.js';

export const T4A_BOXES = { '048': 'fee_or_oth_srvc_amt', '028': 'oth_incamt', '020': 'self_empl_cmsn_amt' } as const;
export type T4aBox = keyof typeof T4A_BOXES;
export const THRESHOLD = 500;

export interface T4aSlip {
  payeeId: string;
  name: string;
  kind: 'PERSON' | 'BUSINESS';
  boxes: Partial<Record<T4aBox, number>>;
  taxWithheld: number;
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const payeeName = (p: { kind: string; firstName: string | null; lastName: string | null; businessName: string | null }) => (p.kind === 'BUSINESS' ? (p.businessName ?? '') : `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim());
export const sinAad = (tenantId: string, payeeId: string) => `payee-sin:${tenantId}:${payeeId}`;

/** The year's slips: payees over the threshold or with tax withheld. */
export async function t4aSlips(tx: Tx, year: number): Promise<{ slips: T4aSlip[]; under: number }> {
  const pays = await tx.payeePayment.findMany({ where: { paidOn: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, include: { payee: true } });
  const by = new Map<string, T4aSlip>();
  for (const p of pays) {
    const s = by.get(p.payeeId) ?? { payeeId: p.payeeId, name: payeeName(p.payee), kind: p.payee.kind, boxes: {}, taxWithheld: 0, total: 0 };
    const box = p.box as T4aBox;
    s.boxes[box] = r2((s.boxes[box] ?? 0) + Number(p.amount));
    s.taxWithheld = r2(s.taxWithheld + Number(p.taxWithheld));
    s.total = r2(s.total + Number(p.amount));
    by.set(p.payeeId, s);
  }
  const all = [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  const slips = all.filter((s) => s.total > THRESHOLD || s.taxWithheld > 0);
  return { slips, under: all.length - slips.length };
}

export interface T4aRecipient { kind: 'PERSON' | 'BUSINESS'; firstName: string | null; lastName: string | null; businessName: string | null; sin: string | null; businessNumber: string | null; address: MailingAddress | null }

export async function recipients(tx: Tx, tenantId: string, ids: string[]): Promise<Map<string, T4aRecipient>> {
  const rows = await tx.payee.findMany({ where: { id: { in: ids } } });
  const out = new Map<string, T4aRecipient>();
  for (const p of rows) {
    const sin = p.sinCiphertext && p.sinIv && p.sinAuthTag && p.sinWrappedKey && p.sinKekId ? await open(keys(), { ciphertext: Buffer.from(p.sinCiphertext), iv: Buffer.from(p.sinIv), authTag: Buffer.from(p.sinAuthTag), wrappedDataKey: Buffer.from(p.sinWrappedKey), kekId: p.sinKekId }, sinAad(tenantId, p.id)) : null;
    out.set(p.id, { kind: p.kind, firstName: p.firstName, lastName: p.lastName, businessName: p.businessName, sin, businessNumber: p.businessNumber, address: (p.address as MailingAddress | null) ?? null });
  }
  return out;
}

export interface T4aProblem { code: 'NO_BN' | 'NO_EMPLOYER_ADDRESS' | 'NO_CONTACT' | 'NO_TAX_ID' | 'NO_ADDRESS'; name?: string }

export function t4aProblems(employer: Partial<Employer>, people: Map<string, T4aRecipient>, slips: T4aSlip[]): T4aProblem[] {
  const out: T4aProblem[] = [];
  if (!employer.businessNumber) out.push({ code: 'NO_BN' });
  if (!employer.address) out.push({ code: 'NO_EMPLOYER_ADDRESS' });
  if (!employer.contact?.name || !employer.contact.phone) out.push({ code: 'NO_CONTACT' });
  for (const s of slips) {
    const p = people.get(s.payeeId);
    if (!p || (p.kind === 'PERSON' ? !p.sin : !p.businessNumber)) out.push({ code: 'NO_TAX_ID', name: s.name });
    if (!p?.address) out.push({ code: 'NO_ADDRESS', name: s.name });
  }
  return out;
}

const esc = (v: unknown) => String(v).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
const el = (name: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : `<${name}>${esc(v)}</${name}>`);
const amt = (name: string, n: number | undefined) => (n ? el(name, n.toFixed(2)) : '');
const cut = (s: string | null | undefined, n: number) => (s ?? '').slice(0, n);
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
function addr(prefix: 'RCPNT' | 'PAYR' | 'TRNMTR', a: MailingAddress | null) {
  if (!a) return '';
  return `<${prefix}_ADDR>${el('addr_l1_txt', cut(a.line1, 30))}${el('addr_l2_txt', cut(a.line2, 30))}${el('cty_nm', cut(a.city, 28))}${el('prov_cd', a.province)}${el('cntry_cd', 'CAN')}${el('pstl_cd', a.postalCode.replace(/\s/g, '').toUpperCase())}</${prefix}_ADDR>`;
}

export function t4aXml(o: { year: number; employer: Employer; transmitterNumber?: string | null; reportType: 'O' | 'A'; submissionRef: string; slips: T4aSlip[]; people: Map<string, T4aRecipient> }) {
  const r = o.reportType;
  const slips = o.slips.map((s) => {
    const p = o.people.get(s.payeeId)!;
    const name = p.kind === 'BUSINESS' ? el('rcpnt_bus_nm', cut(p.businessName, 30)) : `<RCPNT_NM>${el('snm', cut(p.lastName, 20))}${el('gvn_nm', cut(p.firstName, 12))}</RCPNT_NM>`;
    return (
      '<T4ASlip>' +
      name +
      addr('RCPNT', p.address) +
      (p.kind === 'PERSON' ? el('sin', digits(p.sin)) : el('rcpnt_bn', p.businessNumber)) +
      el('payr_bn', o.employer.businessNumber) +
      el('rpt_tcd', r) +
      '<T4A_AMT>' +
      amt('self_empl_cmsn_amt', s.boxes['020']) +
      amt('itx_ddct_amt', s.taxWithheld) +
      amt('fee_or_oth_srvc_amt', s.boxes['048']) +
      '</T4A_AMT>' +
      (s.boxes['028'] ? `<OTH_INFO>${amt('oth_incamt', s.boxes['028'])}</OTH_INFO>` : '') +
      '</T4ASlip>'
    );
  });
  const sum = (f: (s: T4aSlip) => number) => o.slips.reduce((a, s) => a + f(s), 0);
  const summary =
    '<T4ASummary>' +
    el('payr_bn', o.employer.businessNumber) +
    `<PAYR_NM>${el('l1_nm', cut(o.employer.name, 30))}</PAYR_NM>` +
    addr('PAYR', o.employer.address) +
    `<PAYR_CNTC>${el('cntc_nm', cut(o.employer.contact.name, 22))}${el('cntc_area_cd', digits(o.employer.contact.phone).slice(0, 3))}${el('cntc_phn_nbr', `${digits(o.employer.contact.phone).slice(3, 6)}-${digits(o.employer.contact.phone).slice(6, 10)}`)}</PAYR_CNTC>` +
    el('tx_yr', o.year) +
    el('slp_cnt', o.slips.length) +
    el('rpt_tcd', r) +
    '<T4A_TAMT>' +
    amt('tot_self_cmsn_amt', sum((s) => s.boxes['020'] ?? 0)) +
    amt('tot_itx_ddct_amt', sum((s) => s.taxWithheld)) +
    amt('tot_fee_amt', sum((s) => s.boxes['048'] ?? 0)) +
    amt('rpt_tot_oth_info_amt', sum((s) => s.boxes['028'] ?? 0)) +
    '</T4A_TAMT>' +
    '</T4ASummary>';
  const t619 =
    '<T619>' +
    el('sbmt_ref_id', o.submissionRef) +
    el('rpt_tcd', r) +
    el('trnmtr_nbr', o.transmitterNumber || o.employer.businessNumber.slice(0, 9)) +
    el('trnmtr_tcd', 1) +
    el('summ_cnt', 1) +
    el('lang_cd', 'E') +
    `<TRNMTR_NM>${el('l1_nm', cut(o.employer.name, 35))}</TRNMTR_NM>` +
    addr('TRNMTR', o.employer.address) +
    `<CNTC>${el('cntc_nm', cut(o.employer.contact.name, 22))}${el('cntc_area_cd', digits(o.employer.contact.phone).slice(0, 3))}${el('cntc_phn_nbr', `${digits(o.employer.contact.phone).slice(3, 6)}-${digits(o.employer.contact.phone).slice(6, 10)}`)}${el('cntc_email_area', o.employer.contact.email ?? '')}</CNTC>` +
    '</T619>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Submission xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="layout-topologie.xsd">${t619}<Return><T4A>${slips.join('')}${summary}</T4A></Return></Submission>\n`;
}
