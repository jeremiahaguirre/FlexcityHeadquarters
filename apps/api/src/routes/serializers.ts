import type { Facility, Position, Shift, User } from '../generated/prisma/client.js';
import { localIso } from '../lib/time.js';
import { breakMinutesOf } from '../services/scheduling/workRules.js';

type ShiftWith = Shift & {
  facility: Pick<Facility, 'id' | 'name' | 'timezone'>;
  position: Pick<Position, 'id' | 'name' | 'nameFr'> & Partial<Pick<Position, 'unpaidBreakMinutes' | 'neverAlone'>>;
  user?: Pick<User, 'id' | 'firstName' | 'lastName'> | null;
};

/**
 * Shift as the web app needs it: facility-local times for display, and the
 * assignee as first name + last initial unless the viewer may see full names.
 */
export function shiftView(s: ShiftWith, opts: { fullNames: boolean }) {
  return {
    id: s.id,
    facilityId: s.facilityId,
    positionId: s.positionId,
    userId: s.userId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    localStartsAt: localIso(s.startsAt, s.facility.timezone),
    localEndsAt: localIso(s.endsAt, s.facility.timezone),
    status: s.status,
    shiftType: s.shiftType,
    customTitle: s.customTitle,
    premiumPerHour: s.premiumPerHour?.toString() ?? null,
    conflictReason: s.conflictReason,
    version: s.version,
    /** Paid hours: length − unpaid meal break (the shift's, else its position's). */
    hours: (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000 - breakMinutesOf(s, s.position) / 60,
    unpaidBreakMinutes: breakMinutesOf(s, s.position),
    ownBreakMinutes: s.unpaidBreakMinutes,
    neverAlone: s.neverAlone ?? s.position.neverAlone ?? false,
    ownNeverAlone: s.neverAlone,
    callBack: s.callBack,
    facility: { id: s.facility.id, name: s.facility.name, timezone: s.facility.timezone },
    position: { id: s.position.id, name: s.position.name, nameFr: s.position.nameFr },
    assignee: s.user
      ? { id: s.user.id, name: opts.fullNames ? `${s.user.firstName} ${s.user.lastName}` : `${s.user.firstName} ${s.user.lastName.slice(0, 1)}.` }
      : null,
  };
}

export const shiftInclude = {
  facility: { select: { id: true, name: true, timezone: true } },
  position: { select: { id: true, name: true, nameFr: true, unpaidBreakMinutes: true, neverAlone: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
} as const;
