/**
 * Demo city workers outside aquatics: a water treatment plant, its position,
 * two city-defined roles and two people. Idempotent.
 *   npx tsx prisma/seedCityWorkers.ts   (adds them to an already-seeded dev database)
 */
import type { PrismaClient } from '@prisma/client';

export async function seedCityWorkers(prisma: PrismaClient, tenantId: string, passwordHash: string) {
  if (await prisma.user.findFirst({ where: { tenantId, email: 'waterworks@kelowna.test' } })) return;
  const plant = await prisma.facility.create({
    data: { tenantId, name: 'Water Treatment Plant', province: 'BC', timezone: 'America/Vancouver', latitude: 49.9, longitude: -119.48, costCenter: 'CC-610-WATER' },
  });
  const waterWorks = await prisma.department.create({ data: { tenantId, name: 'Water Works', nameFr: 'Aqueduc' } });
  const operator = await prisma.position.create({ data: { tenantId, name: 'Water Works Operator', nameFr: 'Opérateur, aqueduc', departmentId: waterWorks.id } });
  const crew = await prisma.customRole.create({
    data: {
      tenantId,
      name: 'Water Works Operator',
      nameFr: 'Opérateur, aqueduc',
      description: 'Plant and distribution crew',
      permissions: ['schedule.read', 'shifts.self', 'timeclock.punch', 'timeoff.self', 'availability.self', 'shiftboard.claim', 'shiftboard.post'],
    },
  });
  const lead = await prisma.customRole.create({
    data: {
      tenantId,
      name: 'Maintenance Lead',
      nameFr: 'Chef d’équipe, entretien',
      description: 'Leads the facilities maintenance crew',
      permissions: ['schedule.read', 'shifts.self', 'timeclock.punch', 'timeoff.self', 'availability.self', 'users.read', 'schedule.write', 'timeoff.approve', 'timeclock.review'],
    },
  });
  for (const p of [
    { email: 'waterworks@kelowna.test', firstName: 'Drew', lastName: 'Kowalski', role: crew.id, positions: [operator.id] },
    { email: 'maintenance@kelowna.test', firstName: 'Jess', lastName: 'Okoye', role: lead.id, positions: [] as string[] },
  ]) {
    const u = await prisma.user.create({
      data: { tenantId, email: p.email, firstName: p.firstName, lastName: p.lastName, roles: ['EMPLOYEE'], employmentStatus: 'FULL_TIME', passwordHash, unionMember: true, hireDate: new Date('2021-04-12'), employeeNumber: p.email.startsWith('water') ? 'E210' : 'E211' },
    });
    await prisma.userCustomRole.create({ data: { tenantId, userId: u.id, customRoleId: p.role } });
    for (const positionId of p.positions) await prisma.userPosition.create({ data: { tenantId, userId: u.id, positionId } });
    // HR chose Jess to run Water Works.
    if (p.role === lead.id) await prisma.departmentManager.create({ data: { tenantId, departmentId: waterWorks.id, userId: u.id } });
  }
  return plant;
}

// Run directly against an existing dev database.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { PrismaClient } = await import('@prisma/client');
  const { hashPassword } = await import('../src/auth/tokens.js');
  const prisma = new PrismaClient();
  const t = await prisma.tenant.findUniqueOrThrow({ where: { subdomain: 'kelowna' } });
  await seedCityWorkers(prisma, t.id, await hashPassword('flexcity-dev'));
  console.log('City workers ready: waterworks@kelowna.test, maintenance@kelowna.test');
  await prisma.$disconnect();
}
