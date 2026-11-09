import { PrismaClient } from '@prisma/client';

/** Owner connection — bypasses RLS; used only to arrange test data. */
export const owner = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
/** Runtime connection — the non-owner app role, RLS enforced. */
export const app = new PrismaClient({ datasources: { db: { url: process.env.APP_DATABASE_URL } } });

const day = (n: number) => new Date(Date.now() + n * 86_400_000);

/** A tenant with one BC facility, a lifeguard position requiring NLS, and N qualified guards. */
export async function seedTenant(sub: string, guards = 3) {
  const tenant = await owner.tenant.create({ data: { name: `City of ${sub}`, subdomain: sub } });
  const facility = await owner.facility.create({
    data: { tenantId: tenant.id, name: 'Rec Centre', province: 'BC', timezone: 'America/Vancouver', latitude: 49.88, longitude: -119.44, costCenter: 'CC-1' },
  });
  const nls = await owner.certification.create({ data: { tenantId: tenant.id, name: `NLS-${sub}`, issuingBody: 'Lifesaving Society', validityMonths: 24 } });
  const position = await owner.position.create({ data: { tenantId: tenant.id, name: 'Lifeguard' } });
  await owner.positionCertRequirement.create({ data: { tenantId: tenant.id, positionId: position.id, certificationId: nls.id } });

  const users = [];
  for (let i = 0; i < guards; i++) {
    const u = await owner.user.create({
      data: {
        tenantId: tenant.id,
        roles: ['STAFF'],
        employmentStatus: 'PART_TIME',
        firstName: `Guard${i}`,
        lastName: sub,
        email: `guard${i}@${sub}.test`,
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    await owner.userPosition.create({ data: { tenantId: tenant.id, userId: u.id, positionId: position.id } });
    await owner.userCertification.create({
      data: { tenantId: tenant.id, userId: u.id, certificationId: nls.id, issueDate: day(-100), expiryDate: day(400) },
    });
    users.push(u);
  }
  return { tenant, facility, position, nls, users };
}

/** A published open shift a few days out, posted to the board. */
export async function seedOpenOffer(t: Awaited<ReturnType<typeof seedTenant>>, startInDays = 3, hours = 4) {
  const startsAt = new Date(Math.floor(day(startInDays).getTime() / 3_600_000) * 3_600_000);
  const shift = await owner.shift.create({
    data: {
      tenantId: t.tenant.id,
      facilityId: t.facility.id,
      positionId: t.position.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + hours * 3_600_000),
      status: 'PUBLISHED',
    },
  });
  const offer = await owner.shiftOffer.create({ data: { tenantId: t.tenant.id, shiftId: shift.id, source: 'OPEN_SHIFT' } });
  return { shift, offer };
}
