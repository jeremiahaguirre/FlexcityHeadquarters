/** Recording water-chemistry readings (an unsafe one recommends closing the pool) and confirming or dismissing those closures. */
import type { Prisma } from '@prisma/client';
import { type Tx, audit } from '../../lib/db.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/errors.js';
import type { DomainEvent } from '../../lib/events.js';
import { dec } from '../../lib/money.js';
import { ThresholdsNotConfiguredError, evaluateReading, validateReading } from './chemistry.js';

export interface ReadingInput {
  poolBodyId: string;
  freeChlorinePpm?: string | null;
  totalChlorinePpm?: string | null;
  ph?: string | null;
  waterTempC?: string | null;
  batherCount?: number | null;
}

export async function recordReading(tx: Tx, tenantId: string, userId: string, input: ReadingInput) {
  const pool = await tx.poolBody.findUnique({ where: { id: input.poolBodyId } });
  if (!pool) throw notFound('Pool');
  const reading = {
    freeChlorinePpm: input.freeChlorinePpm != null ? dec(input.freeChlorinePpm) : null,
    totalChlorinePpm: input.totalChlorinePpm != null ? dec(input.totalChlorinePpm) : null,
    ph: input.ph != null ? dec(input.ph) : null,
  };
  const errors = validateReading(reading);
  if (errors.length) throw badRequest('Reading looks invalid — please re-check.', { errors });

  let result: ReturnType<typeof evaluateReading>;
  try {
    result = evaluateReading(
      {
        freeChlorineMinPpm: pool.freeChlorineMinPpm ? dec(pool.freeChlorineMinPpm) : null,
        freeChlorineMaxPpm: pool.freeChlorineMaxPpm ? dec(pool.freeChlorineMaxPpm) : null,
        combinedChlorineMaxPpm: pool.combinedChlorineMaxPpm ? dec(pool.combinedChlorineMaxPpm) : null,
        phMin: pool.phMin ? dec(pool.phMin) : null,
        phMax: pool.phMax ? dec(pool.phMax) : null,
      },
      reading,
    );
  } catch (e) {
    if (e instanceof ThresholdsNotConfiguredError) throw new HttpError(409, 'THRESHOLDS_NOT_CONFIGURED', e.message);
    throw e;
  }

  const created = await tx.chemicalReading.create({
    data: {
      tenantId,
      poolBodyId: pool.id,
      recordedById: userId,
      recordedAt: new Date(),
      freeChlorinePpm: input.freeChlorinePpm ?? null,
      totalChlorinePpm: input.totalChlorinePpm ?? null,
      ph: input.ph ?? null,
      waterTempC: input.waterTempC ?? null,
      batherCount: input.batherCount ?? null,
      outOfRange: result.outOfRange,
      outOfRangeDetails: result.outOfRange ? (result.reasons as Prisma.InputJsonValue) : undefined,
    },
  });

  const events: DomainEvent[] = [];
  if (result.outOfRange && pool.status === 'OPEN') {
    await tx.poolClosure.create({
      data: { tenantId, poolBodyId: pool.id, readingId: created.id, reason: result.reasons.join('; '), recommendedAt: new Date() },
    });
    await tx.poolBody.update({ where: { id: pool.id }, data: { status: 'CLOSURE_RECOMMENDED' } });
    events.push(
      { type: 'pool.closure_recommended', tenantId, facilityId: pool.facilityId, poolBodyId: pool.id, reasons: result.reasons },
      { type: 'pool.status_changed', tenantId, facilityId: pool.facilityId, poolBodyId: pool.id, status: 'CLOSURE_RECOMMENDED' },
    );
  }
  return { reading: created, outOfRange: result.outOfRange, reasons: result.reasons, events };
}

/** CONFIRM closes the pool; DISMISS reopens (e.g. retest was fine); REOPEN after a confirmed closure. */
export async function decideClosure(
  tx: Tx,
  tenantId: string,
  userId: string,
  poolBodyId: string,
  action: 'CONFIRM' | 'DISMISS' | 'REOPEN',
  note?: string,
): Promise<DomainEvent[]> {
  const pool = await tx.poolBody.findUnique({ where: { id: poolBodyId } });
  if (!pool) throw notFound('Pool');
  const closure = await tx.poolClosure.findFirst({ where: { poolBodyId, reopenedAt: null, dismissedAt: null }, orderBy: { recommendedAt: 'desc' } });
  const now = new Date();
  let status: 'OPEN' | 'CLOSED';

  if (action === 'CONFIRM') {
    if (pool.status !== 'CLOSURE_RECOMMENDED' || !closure) throw conflict('NO_RECOMMENDATION', 'There is no closure awaiting confirmation.');
    await tx.poolClosure.update({ where: { id: closure.id }, data: { confirmedById: userId, confirmedAt: now } });
    status = 'CLOSED';
  } else if (action === 'DISMISS') {
    if (pool.status !== 'CLOSURE_RECOMMENDED' || !closure) throw conflict('NO_RECOMMENDATION', 'There is no closure awaiting confirmation.');
    if (!note?.trim()) throw badRequest('Dismissing a closure requires a note (e.g. retest result).');
    await tx.poolClosure.update({ where: { id: closure.id }, data: { dismissedById: userId, dismissedAt: now, reason: `${closure.reason} | dismissed: ${note}` } });
    status = 'OPEN';
  } else {
    if (pool.status !== 'CLOSED' || !closure) throw conflict('NOT_CLOSED', 'This pool is not closed.');
    await tx.poolClosure.update({ where: { id: closure.id }, data: { reopenedById: userId, reopenedAt: now } });
    status = 'OPEN';
  }
  await tx.poolBody.update({ where: { id: poolBodyId }, data: { status } });
  await audit(tx, { tenantId, actorId: userId, action: `pool.${action.toLowerCase()}`, entity: 'PoolBody', entityId: poolBodyId, after: { status, note } });
  return [{ type: 'pool.status_changed', tenantId, facilityId: pool.facilityId, poolBodyId, status }];
}
