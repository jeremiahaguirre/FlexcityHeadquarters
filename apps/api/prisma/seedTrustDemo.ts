/**
 * Development demo only: fills the Dev console's Trust area with realistic sample activity
 * (published policies, evidence, vendor dates, customer commitments for the demo organizations,
 * and a backfilled posture trend), so the screens can be tried and shown. Never run in production:
 * commitments there come from real contracts.
 *
 *   node --env-file-if-exists=.env --import tsx prisma/seedTrustDemo.ts
 */
import { PrismaClient } from '@prisma/client';
import { ensureTrustSeeded } from '../src/services/trust/seed.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo data is for development only.');
const prisma = new PrismaClient(); // owner connection (DATABASE_URL)
const DAY = 86_400_000;
const now = new Date();
const at = (d: number) => new Date(now.getTime() + d * DAY);

await ensureTrustSeeded(prisma, now);
const admin = await prisma.platformAdmin.findFirst({ where: { disabledAt: null }, orderBy: { createdAt: 'asc' } });
if (!admin) throw new Error('Create a Dev console admin first (npm run platform:admin).');

// Policies: most approved and published 40 days ago; the admin has read some.
const policies = await prisma.trustPolicy.findMany({ include: { versions: true }, orderBy: { key: 'asc' } });
for (const [i, p] of policies.entries()) {
  const v = p.versions[0]!;
  await prisma.trustPolicy.update({ where: { id: p.id }, data: { ownerId: admin.id } });
  if (i >= 9 || v.status !== 'DRAFT') continue;
  await prisma.trustPolicyVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', approvedById: admin.id, approvedAt: at(-41), publishedAt: at(-40) } });
  await prisma.trustPolicy.update({ where: { id: p.id }, data: { nextReviewAt: at(325) } });
  if (i < 6) await prisma.trustPolicyAck.createMany({ data: [{ versionId: v.id, adminId: admin.id, at: at(-38) }], skipDuplicates: true });
}

// Evidence a security lead would have gathered.
if (!(await prisma.trustEvidence.count())) {
  const ev = (controlKey: string, kind: string, title: string, days: number, extra: object = {}) => ({ controlKey, kind, title, addedById: admin.id, createdAt: at(-days), ...extra });
  await prisma.trustEvidence.createMany({
    data: [
      ev('BK-01', 'NOTE', 'Weekly backup copy to ca-west-1 confirmed (snapshot list checked)', 3, { note: '7 nightly snapshots present; weekly copy landed with object lock (35 days).' }),
      ev('BK-02', 'NOTE', 'October restore test: staging restore in 38 min, row counts match', 21, { note: 'Restored last week’s full backup to an isolated account; API test suite passed against it.' }),
      ev('VM-01', 'CI', 'Security workflow on main: dependency audit, CodeQL, secrets scan', 2, { result: 'PASS', url: 'https://github.com/example/flexcityheadquarters/actions/runs/1' }),
      ev('PS-01', 'LINK', 'AWS SOC 2 Type II report (AWS Artifact)', 60, { url: 'https://aws.amazon.com/artifact/' }),
      ev('LM-05', 'LINK', 'AWS time sync service (inherited)', 60, { url: 'https://aws.amazon.com/about-aws/whats-new/2017/11/introducing-the-amazon-time-sync-service/' }),
      ev('GV-01', 'NOTE', 'Annual management review of the security program', 45, { note: 'Objectives for next year: SOC 2 Type I, error tracking vendor, second text provider.' }),
      ev('HR-02', 'NOTE', 'Security and privacy training: all staff complete', 30),
      ev('IR-01', 'NOTE', 'Tabletop: text provider outage during a working-alone alert', 52),
      ev('PR-03', 'NOTE', 'Privacy officer designation and PIA v3 approved', 70),
      ev('CR-03', 'NOTE', 'KMS automatic rotation on; key policy limited to the API role', 90),
      ev('AC-07', 'NOTE', 'Branch protection: one review required, CI must pass', 80),
      ev('SD-01', 'NOTE', 'Pull request sample (10) reviewed for Q3', 40),
      ev('HR-01', 'NOTE', 'Onboarding checklist: two hires this year', 120),
      ev('RT-02', 'NOTE', 'Purge dry run on a test organization', 110),
      ev('PR-01', 'LINK', 'Privacy notice and consent text (current version)', 100, { url: 'https://flexcityhq.example/privacy' }),
      ev('VN-02', 'NOTE', 'Subprocessor list sent to customers', 95),
      ev('AC-03', 'NOTE', 'Q3 access review: 1 console account, no IAM users without MFA', 75),
    ],
  });
  await prisma.trustEvidenceRequest.createMany({
    data: [
      { controlKey: 'VM-03', title: 'Penetration test report summary', ownerId: admin.id, dueAt: at(45), createdById: admin.id },
      { controlKey: 'PS-02', title: 'Laptop inventory with disk encryption status', ownerId: admin.id, dueAt: at(-4), createdById: admin.id },
      { controlKey: 'NW-01', title: 'WAF rules export', ownerId: admin.id, dueAt: at(12), createdById: admin.id },
    ],
  });
}

// Vendor paperwork.
const vendor = (name: string, data: object) => prisma.trustVendor.updateMany({ where: { name }, data: { ownerId: admin.id, ...data } });
await vendor('Amazon Web Services', { dpaSignedAt: at(-300), dpaExpiresAt: at(430), soc2ExpiresAt: at(22), isoExpiresAt: at(260), lastReviewedAt: at(-60), nextReviewAt: at(305), questionnaire: { certification: 'yes', dpa: 'yes', canada: 'yes', encryption: 'yes', mfa: 'yes', breachNotice: 'yes', subprocessors: 'yes', pentest: 'yes', deletion: 'yes', logging: 'yes' }, score: 100 });
await vendor('Twilio', { dpaSignedAt: at(-200), soc2ExpiresAt: at(140), lastReviewedAt: at(-375), nextReviewAt: at(-10), questionnaire: { certification: 'yes', dpa: 'yes', canada: 'no', encryption: 'yes', mfa: 'yes', breachNotice: 'partial', subprocessors: 'yes', pentest: 'yes', deletion: 'yes', logging: 'yes' }, score: 80 });
await vendor('Stripe', { dpaSignedAt: at(-150), soc2ExpiresAt: at(200), lastReviewedAt: at(-150), nextReviewAt: at(580), score: 95, questionnaire: { certification: 'yes', dpa: 'yes', canada: 'partial', encryption: 'yes', mfa: 'yes', breachNotice: 'yes' } });
await vendor('Vercel', { lastReviewedAt: at(-90), nextReviewAt: at(640) });
await vendor('Environment and Climate Change Canada', { lastReviewedAt: at(-120), nextReviewAt: at(610) });
await vendor('Browser push services', { lastReviewedAt: at(-200), nextReviewAt: at(530) });

await prisma.trustRisk.updateMany({ data: { ownerId: admin.id } });
await prisma.trustTest.updateMany({ data: { ownerId: admin.id } });
const { CONTROLS } = await import('../src/services/trust/library.js');
for (const c of CONTROLS) await prisma.trustControlState.upsert({ where: { key: c.key }, create: { key: c.key, ownerId: admin.id }, update: { ownerId: admin.id } });

// Customer commitments for the demo organizations.
if (!(await prisma.trustCommitment.count())) {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true }, take: 2, orderBy: { createdAt: 'asc' } });
  const [a, b] = [tenants.find((x) => /kelowna/i.test(x.name)) ?? tenants[0], tenants.find((x) => !/kelowna/i.test(x.name)) ?? tenants[1]];
  const c = (t: { id: string; name: string } | undefined, kind: string, title: string, due: number | null, recurrence = 'NONE', extra: object = {}) => ({ tenantId: t?.id ?? null, customer: t?.name ?? 'Town of Example', kind, title, dueAt: due === null ? null : at(due), recurrence, ownerId: admin.id, createdById: admin.id, ...extra });
  await prisma.trustCommitment.createMany({
    data: [
      c(a, 'REPORT_DELIVERY', 'Send the yearly security posture summary', 12, 'YEARLY', { source: 'Master services agreement, Schedule C s. 4', controlKeys: ['GV-03'] }),
      c(a, 'SLA_UPTIME', 'Monthly uptime report (99.9% target)', 4, 'MONTHLY', { source: 'SLA s. 2.1', controlKeys: ['LM-02'] }),
      c(a, 'BREACH_NOTICE', 'Notify within 24 hours of confirming an incident', null, 'NONE', { source: 'Privacy schedule s. 7', detail: 'Notice to the City’s privacy officer by phone and email within 24 hours.', controlKeys: ['IR-02'] }),
      c(a, 'DATA_RESIDENCY', 'All data, including backups, stored in Canada', null, 'NONE', { source: 'Privacy schedule s. 3 (FIPPA)', controlKeys: ['PR-05'] }),
      c(a, 'PEN_TEST', 'Share the yearly penetration test summary', 75, 'YEARLY', { controlKeys: ['VM-03'] }),
      c(b, 'QUESTIONNAIRE', 'Return the updated vendor security questionnaire', 26, 'NONE', { controlKeys: [] }),
      c(b, 'SUPPORT_RESPONSE', 'Quarterly support response-time report (P1 within 1 hour)', -3, 'QUARTERLY', { source: 'Order form, Support terms' }),
      c(b, 'SECURITY_CLAUSE', 'Confirm staff confidentiality training completion', 52, 'YEARLY', { controlKeys: ['HR-02'] }),
    ],
  });
}

// Posture over the last 120 days (demo trend; real snapshots replace it as the worker runs).
if ((await prisma.trustScoreSnapshot.count()) < 10) {
  const rows = [];
  for (let d = 120; d >= 1; d--) {
    const p = (120 - d) / 120;
    const score = Math.round(41 + 22 * p + Math.sin(d / 7) * 1.5);
    const fail = Math.round(14 - 5 * p);
    const pass = 27 - fail - 5;
    rows.push({ score, frameworks: { soc2: score - 4, iso27001: score - 9, hipaa: score - 14, pipeda: score + 6, provincial: score + 2, law25: score - 2 }, testsPass: pass, testsFail: fail, testsWarn: 5, controls: { kpis: { failingTests: fail, overdueEvidence: d > 80 ? 4 : d > 40 ? 2 : 1, openHighRisks: d > 70 ? 3 : d > 25 ? 2 : 1, vendorsDue: d > 50 ? 4 : d > 20 ? 3 : 2, commitmentsDue30: d > 60 ? 4 : d > 15 ? 3 : 3, commitmentsOverdue: d < 4 ? 1 : 0 } }, at: at(-d) });
  }
  await prisma.trustScoreSnapshot.createMany({ data: rows });
}
console.log('Trust demo data ready.');
await prisma.$disconnect();
