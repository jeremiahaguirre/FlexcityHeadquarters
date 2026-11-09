/**
 * Development seed. Creates a demo BC municipality at subdomain "kelowna".
 * All demo accounts use the password: flexcity-dev
 *
 * Pool thresholds below are PLACEHOLDERS for local development only — real
 * values must come from the facility's operating permit / provincial regulation.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/tokens.js';

const prisma = new PrismaClient(); // owner connection (DATABASE_URL)

const BC_STAT_HOLIDAYS_2026: Array<[string, string, string]> = [
  ['2026-01-01', "New Year's Day", 'Jour de l’An'],
  ['2026-02-16', 'Family Day', 'Journée de la famille'],
  ['2026-04-03', 'Good Friday', 'Vendredi saint'],
  ['2026-05-18', 'Victoria Day', 'Fête de la Reine'],
  ['2026-07-01', 'Canada Day', 'Fête du Canada'],
  ['2026-08-03', 'British Columbia Day', 'Jour de la Colombie-Britannique'],
  ['2026-09-07', 'Labour Day', 'Fête du Travail'],
  ['2026-09-30', 'National Day for Truth and Reconciliation', 'Journée nationale de la vérité et de la réconciliation'],
  ['2026-10-12', 'Thanksgiving', 'Action de grâce'],
  ['2026-11-11', 'Remembrance Day', 'Jour du Souvenir'],
  ['2026-12-25', 'Christmas Day', 'Noël'],
];

async function main() {
  // FH Dev console account (dev only). Production accounts: npm run platform:admin.
  await prisma.platformAdmin.upsert({
    where: { email: 'dev@flexcity.dev' },
    update: {},
    create: { email: 'dev@flexcity.dev', name: 'FH Dev', passwordHash: await hashPassword('flexcity-dev') },
  });

  const existing = await prisma.tenant.findUnique({ where: { subdomain: 'kelowna' } });
  if (existing) {
    console.log('Seed data already present (tenant "kelowna"). Skipping.');
    return;
  }

  for (const [date, name, nameFr] of BC_STAT_HOLIDAYS_2026) {
    await prisma.statutoryHoliday.upsert({
      where: { province_date: { province: 'BC', date: new Date(date) } },
      update: {},
      create: { province: 'BC', date: new Date(date), name, nameFr },
    });
  }

  const sfa = await prisma.certification.create({ data: { name: 'Standard First Aid with CPR-C', nameFr: 'Secourisme général avec RCR-C', issuingBody: 'Lifesaving Society / Canadian Red Cross', validityMonths: 36 } });
  const nls = await prisma.certification.create({ data: { name: 'National Lifeguard – Pool', nameFr: 'Sauveteur national – Piscine', issuingBody: 'Lifesaving Society', validityMonths: 24 } });
  const wsi = await prisma.certification.create({ data: { name: 'Swim Instructor', nameFr: 'Moniteur de natation', issuingBody: 'Lifesaving Society', validityMonths: 24 } });
  await prisma.certificationPrerequisite.create({ data: { certificationId: nls.id, requiresId: sfa.id } });

  const tenant = await prisma.tenant.create({
    data: {
      name: 'City of Kelowna (demo)',
      subdomain: 'kelowna',
      themeColors: { primary: '#0f766e', primaryHover: '#115e59', primaryContrast: '#ffffff', accent: '#c026d3' },
      features: { union: true },
    },
  });
  const facility = await prisma.facility.create({
    data: { tenantId: tenant.id, name: 'Parkinson Recreation Centre', province: 'BC', timezone: 'America/Vancouver', latitude: 49.8879, longitude: -119.4697, costCenter: 'CC-405-AQUATICS' },
  });
  await prisma.poolBody.createMany({
    data: [
      { tenantId: tenant.id, facilityId: facility.id, name: 'Main Tank', kind: 'POOL', freeChlorineMinPpm: 1.0, freeChlorineMaxPpm: 5.0, combinedChlorineMaxPpm: 0.5, phMin: 7.2, phMax: 7.8, thresholdSource: 'DEV PLACEHOLDER — replace from permit', bathersPerLifeguard: 50 },
      { tenantId: tenant.id, facilityId: facility.id, name: 'Hot Tub', kind: 'HOT_TUB', freeChlorineMinPpm: 2.0, freeChlorineMaxPpm: 5.0, combinedChlorineMaxPpm: 0.5, phMin: 7.2, phMax: 7.8, thresholdSource: 'DEV PLACEHOLDER — replace from permit', bathersPerLifeguard: 25 },
    ],
  });

  const guard = await prisma.position.create({ data: { tenantId: tenant.id, name: 'Lifeguard', nameFr: 'Sauveteur', minimumAge: 16 } });
  const instructor = await prisma.position.create({ data: { tenantId: tenant.id, name: 'Swim Instructor', nameFr: 'Moniteur de natation', minimumAge: 15 } });
  await prisma.positionCertRequirement.createMany({
    data: [
      { tenantId: tenant.id, positionId: guard.id, certificationId: nls.id },
      { tenantId: tenant.id, positionId: instructor.id, certificationId: wsi.id },
    ],
  });
  await prisma.payCodeMapping.createMany({
    data: [
      { tenantId: tenant.id, key: 'REGULAR', positionId: guard.id, code: 'REG_LIFEGUARD' },
      { tenantId: tenant.id, key: 'REGULAR', positionId: instructor.id, code: 'REG_INSTRUCTOR' },
      { tenantId: tenant.id, key: 'OVERTIME_1_5', code: 'OT_1.5' },
      { tenantId: tenant.id, key: 'OVERTIME_2_0', code: 'OT_2.0' },
      { tenantId: tenant.id, key: 'STAT_WORKED', code: 'STAT_WORKED' },
      { tenantId: tenant.id, key: 'STAT_HOLIDAY_PAY', code: 'STAT_PAY' },
      { tenantId: tenant.id, key: 'SHIFT_PREMIUM', code: 'PREMIUM' },
      { tenantId: tenant.id, key: 'VACATION_PAY', code: 'VAC_PAY_4' },
    ],
  });

  const passwordHash = await hashPassword('flexcity-dev');
  const people = [
    { email: 'hr@kelowna.test', firstName: 'Harper', lastName: 'Reid', roles: ['HR_ADMIN'], employmentStatus: 'FULL_TIME', positions: [] },
    { email: 'supervisor@kelowna.test', firstName: 'Sam', lastName: 'Okafor', roles: ['AQUATIC_SUPERVISOR'], employmentStatus: 'FULL_TIME', positions: [guard.id] },
    { email: 'head@kelowna.test', firstName: 'Avery', lastName: 'Tremblay', roles: ['HEAD_LIFEGUARD', 'STAFF'], employmentStatus: 'FULL_TIME', positions: [guard.id, instructor.id] },
    { email: 'guard@kelowna.test', firstName: 'Jordan', lastName: 'Singh', roles: ['STAFF'], employmentStatus: 'PART_TIME', positions: [guard.id, instructor.id] },
    { email: 'casual@kelowna.test', firstName: 'Riley', lastName: 'Chen', roles: ['STAFF'], employmentStatus: 'CASUAL', positions: [guard.id] },
    { email: 'junior@kelowna.test', firstName: 'Morgan', lastName: 'Lee', roles: ['STAFF'], employmentStatus: 'CASUAL', positions: [instructor.id], dob: '2011-03-14' },
    { email: 'frontdesk@kelowna.test', firstName: 'Casey', lastName: 'Martin', roles: ['FRONT_DESK'], employmentStatus: 'PART_TIME', positions: [] },
    { email: 'steward@kelowna.test', firstName: 'Taylor', lastName: 'Nguyen', roles: ['UNION_STEWARD', 'STAFF'], employmentStatus: 'FULL_TIME', positions: [guard.id] },
  ] as const;

  let n = 100;
  for (const p of people) {
    const u = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        roles: [...p.roles],
        employmentStatus: p.employmentStatus,
        passwordHash,
        employeeNumber: `E${n++}`,
        hireDate: new Date('2022-05-01'),
        seniorityDate: new Date('2022-05-01'),
        dateOfBirth: new Date('dob' in p ? p.dob : '1999-06-01'),
        unionMember: p.roles.includes('STAFF' as never),
        weeklyMinHours: p.employmentStatus === 'FULL_TIME' ? 32 : null,
        weeklyMaxHours: p.employmentStatus === 'PART_TIME' ? 28 : null,
      },
    });
    for (const positionId of p.positions) {
      await prisma.userPosition.create({ data: { tenantId: tenant.id, userId: u.id, positionId } });
      await prisma.payRate.create({ data: { tenantId: tenant.id, userId: u.id, positionId, hourlyRate: positionId === guard.id ? 22.5 : 24.75, effectiveFrom: new Date('2026-01-01') } });
    }
    const certs = p.positions.includes(guard.id as never) ? [sfa, nls] : [];
    if (p.positions.includes(instructor.id as never)) certs.push(wsi);
    for (const c of certs) {
      await prisma.userCertification.create({ data: { tenantId: tenant.id, userId: u.id, certificationId: c.id, issueDate: new Date('2025-06-01'), expiryDate: new Date('2027-06-01'), verifiedAt: new Date() } });
    }
    for (let dow = 0; dow < 7; dow++) {
      await prisma.availability.create({ data: { tenantId: tenant.id, userId: u.id, dayOfWeek: dow, startMinute: 6 * 60, endMinute: 22 * 60, effectiveFrom: new Date('2026-01-01') } });
    }
  }

  // A union local for the Union Hub, with every union member in it and the steward running it.
  const [local] = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO union_hub.local (tenant_id, name, kek_id) VALUES (${tenant.id}::uuid, 'CUPE Local 338 (demo)', 'local:cupe338') RETURNING id`;
  const members = await prisma.user.findMany({ where: { tenantId: tenant.id, unionMember: true }, select: { id: true, roles: true } });
  for (const m of members) {
    await prisma.$executeRaw`
      INSERT INTO union_hub.member_access (local_id, user_id, is_steward) VALUES (${local!.id}::uuid, ${m.id}::uuid, ${m.roles.includes('UNION_STEWARD')})`;
  }

  console.log('Seeded tenant "kelowna". Log in at http://kelowna.localhost:3000 with e.g. guard@kelowna.test / flexcity-dev');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
