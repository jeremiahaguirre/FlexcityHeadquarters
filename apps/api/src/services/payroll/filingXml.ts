/**
 * Electronic filing files built from approved and paid pay statements:
 * - T4 return in CRA's XML format (T619 transmittal + T4 slips + T4 Summary),
 *   uploaded with CRA's Internet File Transfer;
 * - Record of Employment in Service Canada's ROE Web bulk XML format (W-2.0);
 * - RL-1 slips in Revenu Québec's XML transmission format (Groupe01), for Quebec staff.
 *
 * Element names follow CRA's "T4 XML specification" and Service Canada's
 * "ROE Web XML specification". Run the first file of each kind through the
 * agency's validator before filing it: both publish one, and both change
 * their schemas between years.
 */
import type { MailingAddress } from './bank.js';
import type { Rl1Slip, T4Slip } from './yearEnd.js';

export const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const el = (name: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : `<${name}>${esc(v)}</${name}>`);
const amt = (name: string, n: number) => (n ? el(name, n.toFixed(2)) : '');
const cut = (s: string | null | undefined, n: number) => (s ?? '').slice(0, n);
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

export interface FilingContact { name: string; phone: string; email?: string | null }
export interface Employer { name: string; businessNumber: string; address: MailingAddress | null; contact: FilingContact }
export interface Person { firstName: string; lastName: string; sin: string; employeeNumber: string | null; address: MailingAddress | null; cppExempt: boolean; eiExempt: boolean }

function addr(prefix: 'EMPE' | 'EMPR' | 'TRNMTR', a: MailingAddress | null) {
  if (!a) return '';
  return `<${prefix}_ADDR>${el('addr_l1_txt', cut(a.line1, 30))}${el('addr_l2_txt', cut(a.line2, 30))}${el('cty_nm', cut(a.city, 28))}${el('prov_cd', a.province)}${el('cntry_cd', 'CAN')}${el('pstl_cd', a.postalCode.replace(/\s/g, ''))}</${prefix}_ADDR>`;
}
function contact(c: FilingContact) {
  const p = digits(c.phone);
  return `<CNTC>${el('cntc_nm', cut(c.name, 22))}${el('cntc_area_cd', p.slice(0, 3))}${el('cntc_phn_nbr', `${p.slice(3, 6)}-${p.slice(6, 10)}`)}${el('cntc_email_area', c.email)}</CNTC>`;
}

export interface FilingProblem { code: 'NO_BN' | 'NO_EMPLOYER_ADDRESS' | 'NO_CONTACT' | 'NO_SIN' | 'NO_ADDRESS'; name?: string }

/** Details the agency would reject the file without (shown in the person's language); no file is built while there are any. */
export function t4Problems(employer: Partial<Employer>, people: Map<string, Person | null>, slips: Array<Pick<T4Slip, 'userId' | 'name'>>): FilingProblem[] {
  const out: FilingProblem[] = [];
  if (!employer.businessNumber) out.push({ code: 'NO_BN' });
  if (!employer.address) out.push({ code: 'NO_EMPLOYER_ADDRESS' });
  if (!employer.contact?.name || digits(employer.contact?.phone).length !== 10) out.push({ code: 'NO_CONTACT' });
  for (const s of slips) {
    const p = people.get(s.userId);
    if (!p?.sin) out.push({ code: 'NO_SIN', name: s.name });
    if (!p?.address) out.push({ code: 'NO_ADDRESS', name: s.name });
  }
  return out;
}

export function t4Xml(o: { year: number; employer: Employer; transmitterNumber?: string | null; reportType: 'O' | 'A'; submissionRef: string; slips: T4Slip[]; people: Map<string, Person>; summary: { box19EmployerEi: number; box27EmployerCpp: number } }) {
  const r = o.reportType;
  const slips = o.slips.map((s) => {
    const p = o.people.get(s.userId)!;
    const qc = s.province === 'QC';
    return (
      '<T4Slip>' +
      `<EMPE_NM>${el('snm', cut(p.lastName, 20))}${el('gvn_nm', cut(p.firstName, 12))}</EMPE_NM>` +
      addr('EMPE', p.address) +
      el('sin', digits(p.sin)) +
      el('empe_nbr', cut(p.employeeNumber, 20)) +
      el('bn', o.employer.businessNumber) +
      el('cpp_qpp_xmpt_cd', p.cppExempt ? 1 : 0) +
      el('ei_xmpt_cd', p.eiExempt ? 1 : 0) +
      el('prov_pip_xmpt_cd', 0) +
      el('rpt_tcd', r) +
      el('empt_prov_cd', s.province) +
      '<T4_AMT>' +
      amt('empt_incamt', s.box14EmploymentIncome) +
      (qc ? amt('qpp_cntrb_amt', s.box17Qpp) + amt('qppe_cntrb_amt', s.box17aQpp2) : amt('cpp_cntrb_amt', s.box16Cpp) + amt('cppe_cntrb_amt', s.box16aCpp2)) +
      amt('empe_eip_amt', s.box18Ei) +
      amt('rpp_cntrb_amt', s.box20Rpp) +
      amt('itx_ddct_amt', s.box22IncomeTax) +
      amt('ei_insu_ernamt', s.box24EiInsurable) +
      amt('cpp_qpp_ernamt', s.box26CppPensionable) +
      amt('unn_dues_amt', s.box44UnionDues) +
      (qc ? amt('prov_pip_amt', s.box55Ppip) + amt('prov_insu_ernamt', s.box56PpipInsurable) : '') +
      '</T4_AMT>' +
      (s.box40TaxableBenefits ? `<OTH_INFO>${amt('oth_tx_ben_amt', s.box40TaxableBenefits)}</OTH_INFO>` : '') +
      '</T4Slip>'
    );
  });
  const sum = (k: keyof T4Slip) => o.slips.reduce((a, s) => a + (s[k] as number), 0);
  const cppEmpe = sum('box16Cpp') + sum('box17Qpp');
  const cppeEmpe = sum('box16aCpp2') + sum('box17aQpp2');
  const tamt =
    '<T4_TAMT>' +
    amt('tot_empt_incamt', sum('box14EmploymentIncome')) +
    amt('tot_empe_cpp_amt', cppEmpe) +
    amt('tot_empe_cppe_amt', cppeEmpe) +
    amt('tot_empe_eip_amt', sum('box18Ei')) +
    amt('tot_rpp_cntrb_amt', sum('box20Rpp')) +
    amt('tot_itx_ddct_amt', sum('box22IncomeTax')) +
    amt('tot_empr_cpp_amt', o.summary.box27EmployerCpp) +
    amt('tot_empr_eip_amt', o.summary.box19EmployerEi) +
    '</T4_TAMT>';
  const summary =
    '<T4Summary>' +
    el('bn', o.employer.businessNumber) +
    `<EMPR_NM>${el('l1_nm', cut(o.employer.name, 35))}</EMPR_NM>` +
    addr('EMPR', o.employer.address) +
    contact(o.employer.contact) +
    el('tx_yr', o.year) +
    el('slp_cnt', o.slips.length) +
    el('rpt_tcd', r) +
    tamt +
    '</T4Summary>';
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
    contact(o.employer.contact) +
    '</T619>';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Submission xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="layout-topologie.xsd">${t619}<Return><T4>${slips.join('')}${summary}</T4></Return></Submission>\n`;
}

/* ---------------- Record of Employment ---------------- */

/** Service Canada's reasons for issuing an ROE (block 16). */
export const ROE_REASONS = {
  A: 'Shortage of work / end of contract or season',
  B: 'Strike or lockout',
  D: 'Illness or injury',
  E: 'Quit',
  F: 'Maternity',
  G: 'Retirement',
  H: 'Work-sharing',
  J: 'Apprentice training',
  K: 'Other',
  M: 'Dismissal',
  N: 'Leave of absence',
  P: 'Parental',
  Z: 'Compassionate care / family caregiver',
} as const;
export type RoeReason = keyof typeof ROE_REASONS;

/** Block 6: how often the person was paid. */
export const payPeriodType = (weeks: number) => (weeks === 1 ? 'W' : weeks === 2 ? 'B' : weeks === 4 ? 'O' : 'B');

export function roeXml(o: {
  employer: Employer;
  person: Person;
  payrollReference: string;
  payPeriodType: string;
  firstDay: string;
  lastDayPaid: string;
  finalPeriodEnd: string;
  occupation: string | null;
  recall: { code: 'Y' | 'N' | 'U'; date?: string | null };
  totalInsurableHours: number;
  /** Newest first, as on the ROE (pay period 1 is the final one). */
  periods: Array<{ insurableEarnings: number }>;
  reason: RoeReason;
  comments?: string | null;
  vacationPay?: number;
}) {
  const p = o.person;
  const a = p.address;
  const phone = digits(o.employer.contact.phone);
  const [cfn, ...cln] = o.employer.contact.name.trim().split(/\s+/);
  const periods = o.periods.slice(0, 53).map((x, i) => `<PP nbr="${i + 1}">${el('AMT', x.insurableEarnings.toFixed(2))}</PP>`).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<ROEHEADER FileVersion="W-2.0" SoftwareVendor="FlexcityHeadquarters" ProductName="FlexcityHeadquarters">` +
    `<ROE Issue="D" PrintingLanguage="E">` +
    el('B3', cut(o.payrollReference, 15)) +
    el('B5', o.employer.businessNumber) +
    el('B6', o.payPeriodType) +
    el('B8', digits(p.sin)) +
    `<B9>${el('FN', cut(p.firstName, 20))}${el('LN', cut(p.lastName, 28))}${a ? el('A1', cut(a.line1, 35)) + el('A2', cut(`${a.city} ${a.province}`, 35)) + el('A3', a.postalCode.replace(/\s/g, '')) : ''}</B9>` +
    el('B10', o.firstDay) +
    el('B11', o.lastDayPaid) +
    el('B12', o.finalPeriodEnd) +
    el('B13', cut(o.occupation, 40)) +
    `<B14>${el('CD', o.recall.code)}${o.recall.code === 'Y' ? el('DT', o.recall.date) : ''}</B14>` +
    el('B15A', Math.round(o.totalInsurableHours)) +
    `<B15C>${periods}</B15C>` +
    `<B16>${el('CD', o.reason)}${el('FN', cut(cfn, 20))}${el('LN', cut(cln.join(' ') || cfn, 28))}${el('AC', phone.slice(0, 3))}${el('TEL', phone.slice(3, 10))}</B16>` +
    (o.vacationPay ? `<B17A><VP nbr="1">${el('CD', 1)}${el('AMT', o.vacationPay.toFixed(2))}</VP></B17A>` : '') +
    el('B18', cut(o.comments, 160)) +
    `</ROE></ROEHEADER>\n`
  );
}

/* ---------------- RL-1 (Revenu Québec) ---------------- */

/**
 * RL-1 slip numbers: Revenu Québec assigns each transmitter a range of 8-digit sequence numbers;
 * the 9th digit is a check digit, the sequence's remainder when divided by 7.
 */
export function rl1SlipNumber(sequence: number): string {
  const seq = String(sequence).padStart(8, '0').slice(-8);
  return `${seq}${Number(seq) % 7}`;
}

export interface Rl1Transmitter {
  /** Preparer number Revenu Québec assigns the transmitter (NP + 6 digits). */
  preparerNumber: string;
  /** The software's authorization number from Revenu Québec (it certifies each year's RL-1 software). */
  certificationNumber: string;
  /** First number of the range Revenu Québec assigned for this year's slips (8 digits). */
  firstSlipSequence: number;
}

export interface Rl1Problem { code: 'NO_QC_NUMBER' | 'NO_PREPARER' | 'NO_CERTIFICATION' | 'NO_SLIP_RANGE' | 'NO_EMPLOYER_ADDRESS' | 'NO_CONTACT' | 'NO_SIN' | 'NO_ADDRESS'; name?: string }

export function rl1Problems(o: { quebecNumber?: string | null; transmitter: Partial<Rl1Transmitter>; employer: Partial<Employer> }, people: Map<string, Person | null>, slips: Array<Pick<Rl1Slip, 'userId' | 'name'>>): Rl1Problem[] {
  const out: Rl1Problem[] = [];
  if (!o.quebecNumber) out.push({ code: 'NO_QC_NUMBER' });
  if (!o.transmitter.preparerNumber) out.push({ code: 'NO_PREPARER' });
  if (!o.transmitter.certificationNumber) out.push({ code: 'NO_CERTIFICATION' });
  if (!o.transmitter.firstSlipSequence) out.push({ code: 'NO_SLIP_RANGE' });
  if (!o.employer.address) out.push({ code: 'NO_EMPLOYER_ADDRESS' });
  if (!o.employer.contact?.name || !o.employer.contact?.phone) out.push({ code: 'NO_CONTACT' });
  for (const s of slips) {
    const p = people.get(s.userId);
    if (!p) out.push({ code: 'NO_SIN', name: s.name });
    else if (!p.address) out.push({ code: 'NO_ADDRESS', name: s.name });
  }
  return out;
}

function rqAddr(a: MailingAddress | null) {
  if (!a) return '';
  return `<Adresse>${el('Ligne1', cut(a.line1, 30))}${el('Ligne2', cut(a.line2, 30))}${el('Ville', cut(a.city, 30))}${el('Province', a.province)}${el('CodePostal', a.postalCode.replace(/\s/g, ''))}</Adresse>`;
}

/**
 * The year's RL-1 slips as one Revenu Québec XML transmission. Laid out after Revenu Québec's
 * published RL-1 schema (Transmission / P / Groupe01 / R); like the CRA files, run the first one
 * through Revenu Québec's test service, and confirm the schema version for the year.
 * `kind` 'R' is an original; 'A' amends (each slip keeps its number), 'D' cancels.
 */
export function rl1Xml(o: { year: number; kind: 'R' | 'A' | 'D'; quebecNumber: string; employer: Employer; transmitter: Rl1Transmitter; slips: Rl1Slip[]; people: Map<string, Person>; software: { name: string; version: string } }) {
  const money = (name: string, n: number) => (n ? el(name, n.toFixed(2)) : '');
  const slips = o.slips.map((s, i) => {
    const p = o.people.get(s.userId)!;
    return (
      '<R>' +
      `<Identification>${el('Annee', o.year)}${el('NoReleve', rl1SlipNumber(o.transmitter.firstSlipSequence + i))}</Identification>` +
      `<Employe>${el('NAS', digits(p.sin))}${el('NoRef', cut(p.employeeNumber, 20))}${el('Nom', cut(p.lastName, 30))}${el('Prenom', cut(p.firstName, 30))}${rqAddr(p.address)}</Employe>` +
      '<Montants>' +
      money('A_RevenuEmploi', s.boxA) +
      money('B_CotisationRRQ', s.boxBA) +
      money('B_B_CotisationRRQSupplementaire', s.boxBB) +
      money('C_CotisationAssEmploi', s.boxC) +
      money('D_CotisationRPA', s.boxD) +
      money('E_ImpotQue', s.boxE) +
      money('F_CotisationSyndicale', s.boxF) +
      money('G_SalaireAdmisRRQ', s.boxG) +
      money('H_CotisationRQAP', s.boxH) +
      money('I_SalaireAdmisRQAP', s.boxI) +
      money('L_AvantageImposable', s.boxL) +
      '</Montants>' +
      '</R>'
    );
  });
  const c = o.employer.contact;
  const phone = digits(c.phone);
  const header =
    '<P>' +
    el('Annee', o.year) +
    el('TypeEnvoi', o.kind === 'R' ? 1 : o.kind === 'A' ? 4 : 6) +
    `<Preparateur>${el('No', o.transmitter.preparerNumber)}${el('Type', 1)}${el('Nom1', cut(o.employer.name, 30))}${rqAddr(o.employer.address)}</Preparateur>` +
    `<Informatique>${el('Nom', cut(c.name, 30))}${el('IndRegional', phone.slice(0, 3))}${el('Tel', `${phone.slice(3, 6)}-${phone.slice(6, 10)}`)}${el('Courriel', c.email)}</Informatique>` +
    `<Comptabilite>${el('Nom', cut(c.name, 30))}${el('IndRegional', phone.slice(0, 3))}${el('Tel', `${phone.slice(3, 6)}-${phone.slice(6, 10)}`)}</Comptabilite>` +
    el('NoCertification', o.transmitter.certificationNumber) +
    el('NomLogiciel', o.software.name) +
    el('VersionLogiciel', o.software.version) +
    '</P>';
  const group = `<Groupe01>${el('NoId', o.quebecNumber.slice(0, 10))}${el('TypeDossier', 'RS')}${el('NoDossier', o.quebecNumber.slice(12))}${slips.join('')}</Groupe01>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Transmission VersionSchema="${o.year}.1" pxmlns="http://www.mrq.gouv.qc.ca/T5">${header}${group}</Transmission>\n`;
}
