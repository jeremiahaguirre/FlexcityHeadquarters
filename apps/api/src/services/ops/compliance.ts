/**
 * Compliance at any minute: rebuilds, from records already kept, what the
 * deck looked like at a past moment — who was working and where, whether each
 * person's required certifications were valid at that moment, staffing
 * against the bather count, water chemistry, open closures and incidents.
 * Built for inspectors, insurers, coroners and the city's own risk team.
 */
import type { Tx } from '../../lib/db.js';
import { localIso } from '../../lib/time.js';
import { lifeguardsRequired } from './chemistry.js';

const H = 3_600_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

export type CertStatus = 'VALID' | 'EXPIRED' | 'NOT_YET_VALID' | 'UNVERIFIED' | 'MISSING';

/** Status of a required certification at a moment, from the person's certificates. */
export function certStatusAt(certs: Array<{ issueDate: Date; expiryDate: Date | null; verifiedAt: Date | null }>, at: Date): CertStatus {
  if (!certs.length) return 'MISSING';
  const d = day(at);
  const live = certs.filter((c) => day(c.issueDate) <= d && (!c.expiryDate || day(c.expiryDate) >= d));
  if (live.some((c) => c.verifiedAt && c.verifiedAt <= at)) return 'VALID';
  if (live.length) return 'UNVERIFIED';
  if (certs.some((c) => day(c.issueDate) > d)) return 'NOT_YET_VALID';
  return 'EXPIRED';
}

export async function complianceSnapshot(tx: Tx, facilityId: string, at: Date) {
  const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { id: true, name: true, timezone: true, province: true } });
  const [shifts, punches, rotations, pools, incidents] = await Promise.all([
    tx.shift.findMany({ where: { facilityId, status: 'PUBLISHED', userId: { not: null }, startsAt: { lte: at }, endsAt: { gt: at } }, select: { id: true, userId: true, positionId: true, startsAt: true, endsAt: true } }),
    tx.timePunch.findMany({ where: { facilityId, clockIn: { lte: at }, OR: [{ clockOut: null }, { clockOut: { gt: at } }] }, select: { userId: true, positionId: true, clockIn: true, clockOut: true, locationStatus: true } }),
    tx.rotationLog.findMany({ where: { facilityId, startedAt: { lte: at }, OR: [{ endedAt: null }, { endedAt: { gt: at } }] } }),
    tx.poolBody.findMany({ where: { facilityId }, select: { id: true, name: true, maxCapacity: true, bathersPerLifeguard: true } }),
    tx.incidentReport.findMany({ where: { facilityId, occurredAt: { gte: new Date(at.getTime() - 2 * H), lte: new Date(at.getTime() + 2 * H) } }, select: { id: true, category: true, occurredAt: true } }),
  ]);
  const userIds = [...new Set([...shifts.map((s) => s.userId!), ...punches.map((p) => p.userId)])];
  const positionIds = [...new Set([...shifts.map((s) => s.positionId), ...punches.map((p) => p.positionId)])];
  const [users, positions, reqs, certs, stations] = await Promise.all([
    tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
    tx.position.findMany({ where: { id: { in: positionIds } }, select: { id: true, name: true } }),
    tx.positionCertRequirement.findMany({ where: { positionId: { in: positionIds } }, include: { certification: { select: { id: true, name: true } } } }),
    tx.userCertification.findMany({ where: { userId: { in: userIds } } }),
    tx.deckStation.findMany({ where: { facilityId }, select: { id: true, name: true, poolBodyId: true } }),
  ]);

  const people = userIds.map((id) => {
    const u = users.find((x) => x.id === id);
    const punch = punches.find((p) => p.userId === id);
    const shift = shifts.find((s) => s.userId === id);
    const positionId = punch?.positionId ?? shift?.positionId ?? null;
    const rot = rotations.find((r) => r.userId === id);
    const station = rot?.stationId ? stations.find((s) => s.id === rot.stationId) : null;
    const certifications = reqs
      .filter((r) => r.positionId === positionId)
      .map((r) => ({ name: r.certification.name, status: certStatusAt(certs.filter((c) => c.userId === id && c.certificationId === r.certificationId), at) }));
    return {
      userId: id,
      name: u ? `${u.firstName} ${u.lastName}` : '—',
      position: positions.find((p) => p.id === positionId)?.name ?? null,
      scheduled: !!shift,
      clockedIn: !!punch,
      clockedInAt: punch ? localIso(punch.clockIn, facility.timezone) : null,
      locationStatus: punch?.locationStatus ?? null,
      station: station?.name ?? (rot ? null : undefined),
      onStationSince: rot ? localIso(rot.startedAt, facility.timezone) : null,
      certifications,
    };
  });

  const poolRows = await Promise.all(
    pools.map(async (p) => {
      const [count, reading, closure] = await Promise.all([
        tx.headCount.findFirst({ where: { poolBodyId: p.id, recordedAt: { lte: at, gte: new Date(at.getTime() - 3 * H) } }, orderBy: { recordedAt: 'desc' } }),
        tx.chemicalReading.findFirst({ where: { poolBodyId: p.id, recordedAt: { lte: at, gte: new Date(at.getTime() - 6 * H) } }, orderBy: { recordedAt: 'desc' } }),
        tx.poolClosure.findFirst({
          where: { poolBodyId: p.id, recommendedAt: { lte: at }, AND: [{ OR: [{ reopenedAt: null }, { reopenedAt: { gt: at } }] }, { OR: [{ dismissedAt: null }, { dismissedAt: { gt: at } }] }] },
          orderBy: { recommendedAt: 'desc' },
        }),
      ]);
      const required = count ? lifeguardsRequired(count.count, p.bathersPerLifeguard) : null;
      const poolStations = stations.filter((s) => s.poolBodyId === p.id || s.poolBodyId === null).map((s) => s.id);
      const onStations = rotations.filter((r) => r.stationId && poolStations.includes(r.stationId)).length;
      return {
        id: p.id,
        name: p.name,
        headcount: count ? { count: count.count, at: localIso(count.recordedAt, facility.timezone), maxCapacity: p.maxCapacity, overCapacity: count.overCapacity } : null,
        lifeguardsRequired: required,
        lifeguardsOnStation: rotations.length ? onStations : null,
        chemistry: reading ? { at: localIso(reading.recordedAt, facility.timezone), freeChlorinePpm: reading.freeChlorinePpm?.toString() ?? null, ph: reading.ph?.toString() ?? null, outOfRange: reading.outOfRange, signedOff: !!reading.signedOffAt } : null,
        closure: closure ? { reason: closure.reason, since: localIso(closure.recommendedAt, facility.timezone), confirmed: !!closure.confirmedAt && closure.confirmedAt <= at } : null,
      };
    }),
  );

  const issues: Array<{ code: string; detail: string }> = [];
  for (const p of people) {
    for (const c of p.certifications) if (c.status !== 'VALID') issues.push({ code: `CERT_${c.status}`, detail: `${p.name}: ${c.name}` });
    if (p.scheduled && !p.clockedIn) issues.push({ code: 'SCHEDULED_NOT_CLOCKED_IN', detail: p.name });
  }
  for (const p of poolRows) {
    if (p.headcount?.overCapacity) issues.push({ code: 'OVER_CAPACITY', detail: p.name });
    if (p.lifeguardsRequired !== null && p.lifeguardsOnStation !== null && p.lifeguardsOnStation < p.lifeguardsRequired) issues.push({ code: 'UNDERSTAFFED', detail: `${p.name}: ${p.lifeguardsOnStation}/${p.lifeguardsRequired}` });
    if (p.chemistry?.outOfRange) issues.push({ code: 'CHEMISTRY_OUT_OF_RANGE', detail: p.name });
    if (!p.chemistry) issues.push({ code: 'NO_RECENT_CHEMISTRY', detail: p.name });
  }

  return {
    facility: { id: facility.id, name: facility.name, province: facility.province },
    at: at.toISOString(),
    localAt: localIso(at, facility.timezone),
    people,
    pools: poolRows,
    incidents: incidents.map((i) => ({ id: i.id, category: i.category, at: localIso(i.occurredAt, facility.timezone) })),
    issues,
    rotationLogged: rotations.length > 0,
  };
}
