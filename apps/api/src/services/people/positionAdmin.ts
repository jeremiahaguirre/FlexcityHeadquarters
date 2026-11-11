/**
 * Creating and changing positions, for Settings › Positions, the Dev console and the public API:
 * one set of rules (a unique name, known certifications and department, each organization's own
 * external id) wherever the change comes from.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Tx } from '../../lib/db.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { assertDepartment, forget as forgetDepartmentScope } from './departmentAdmin.js';

const uuid = z.string().uuid();

export const positionBody = z.object({
  name: z.string().min(2).max(80),
  nameFr: z.string().max(80).nullable().optional(),
  minimumAge: z.number().int().min(12).max(25).nullable().optional(),
  requiredCertificationIds: z.array(uuid).max(10),
  /** The department this position belongs to; null = none. Omit to leave it as it is. */
  departmentId: uuid.nullable().optional(),
  /** Driving limits; omit or null for none. */
  hoursOfService: z
    .object({ maxDailyHours: z.number().min(1).max(24).nullable().optional(), minRestHours: z.number().min(1).max(24).nullable().optional(), maxHoursIn7Days: z.number().min(1).max(168).nullable().optional() })
    .nullable()
    .optional(),
});
export type PositionInput = z.infer<typeof positionBody>;

/** A change to a position: whatever is left out stays as it is (the public API sends only what changed). */
export type PositionChange = Partial<Omit<PositionInput, 'name'>> & { name?: string; externalId?: string | null };

/** Another of this organization's positions already uses that name, or that external id. */
async function assertUnique(tx: Tx, id: string | null, change: PositionChange) {
  const not = id ? { id: { not: id } } : {};
  if (change.name !== undefined && (await tx.position.findFirst({ where: { name: { equals: change.name, mode: 'insensitive' }, ...not }, select: { id: true } }))) {
    throw conflict('POSITION_EXISTS', 'This organization already has a position with that name.', { field: 'name' });
  }
  if (change.externalId && (await tx.position.findFirst({ where: { externalId: change.externalId, ...not }, select: { id: true } }))) {
    throw conflict('EXTERNAL_ID_TAKEN', 'Another position already has this external id.', { field: 'external_id' });
  }
}

/** Creates (id null) or changes a position. Returns the saved row. */
export async function savePosition(tx: Tx, tenantId: string, id: string | null, change: PositionChange) {
  if (!id && !change.name) throw new HttpError(400, 'BAD_REQUEST', 'A position needs a name.');
  if (id && !(await tx.position.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Position');
  await assertUnique(tx, id, change);
  const certs = change.requiredCertificationIds;
  if (certs && (await tx.certification.count({ where: { id: { in: certs } } })) !== new Set(certs).size) throw badRequest('Unknown certification.');
  await assertDepartment(tx, change.departmentId);
  const data = {
    ...(change.name !== undefined ? { name: change.name } : {}),
    ...(change.nameFr !== undefined ? { nameFr: change.nameFr ?? null } : {}),
    ...(change.minimumAge !== undefined ? { minimumAge: change.minimumAge ?? null } : {}),
    ...(change.departmentId !== undefined ? { departmentId: change.departmentId } : {}),
    ...(change.hoursOfService !== undefined ? { hoursOfService: change.hoursOfService ?? Prisma.DbNull } : {}),
    ...(change.externalId !== undefined ? { externalId: change.externalId } : {}),
  };
  const pos = id ? await tx.position.update({ where: { id }, data }) : await tx.position.create({ data: { name: change.name!, ...data, tenantId } });
  if (certs) {
    await tx.positionCertRequirement.deleteMany({ where: { positionId: pos.id } });
    if (certs.length) await tx.positionCertRequirement.createMany({ data: [...new Set(certs)].map((certificationId) => ({ tenantId, positionId: pos.id, certificationId })) });
  }
  await forgetDepartmentScope(tenantId, tx);
  return pos;
}
