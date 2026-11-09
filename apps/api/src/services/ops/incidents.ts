import type { Tx } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { type KeyProvider, open, seal } from '../crypto/envelope.js';

export interface IncidentNarrative {
  summary: string;
  peopleInvolved: string;
  actionsTaken: string;
  emsCalled: boolean;
  witnesses?: string;
}

const aad = (tenantId: string, id: string) => `incident:${tenantId}:${id}`;

export async function createIncident(
  tx: Tx,
  keys: KeyProvider,
  kekId: string,
  input: { tenantId: string; facilityId: string; reportedById: string; occurredAt: Date; category: string; narrative: IncidentNarrative },
) {
  const id = crypto.randomUUID();
  const sealed = await seal(keys, kekId, JSON.stringify(input.narrative), aad(input.tenantId, id));
  await tx.incidentReport.create({
    data: {
      id,
      tenantId: input.tenantId,
      facilityId: input.facilityId,
      reportedById: input.reportedById,
      occurredAt: input.occurredAt,
      category: input.category,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      wrappedDataKey: sealed.wrappedDataKey,
      kekId: sealed.kekId,
    },
  });
  return { id };
}

/** Every decryption is logged with a stated purpose. */
export async function readIncident(tx: Tx, keys: KeyProvider, tenantId: string, userId: string, id: string, purpose: string) {
  const r = await tx.incidentReport.findUnique({ where: { id } });
  if (!r) throw notFound('Incident');
  await tx.incidentAccessLog.create({ data: { tenantId, incidentId: id, userId, purpose } });
  const narrative = JSON.parse(
    await open(
      keys,
      { ciphertext: Buffer.from(r.ciphertext), iv: Buffer.from(r.iv), authTag: Buffer.from(r.authTag), wrappedDataKey: Buffer.from(r.wrappedDataKey), kekId: r.kekId },
      aad(tenantId, id),
    ),
  ) as IncidentNarrative;
  return { id: r.id, facilityId: r.facilityId, occurredAt: r.occurredAt, category: r.category, reportedById: r.reportedById, narrative };
}
