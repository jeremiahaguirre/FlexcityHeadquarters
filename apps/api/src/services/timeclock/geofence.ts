/**
 * Geofence verification for punches.
 *
 * GPS is a SIGNAL, not proof: it can be spoofed and is unreliable indoors.
 * Out-of-radius or low-accuracy punches are flagged for review, never rejected,
 * and location is captured only at the moment of the punch (no tracking).
 */
import type { PunchLocationStatus } from '@prisma/client';

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Readings worse than this are too vague to judge. */
export const MAX_ACCEPTABLE_ACCURACY_M = 100;

export function classifyPunchLocation(
  facility: { lat: number | null; lon: number | null; radiusM: number },
  device: { lat: number; lon: number; accuracyM: number | null } | null,
): { status: PunchLocationStatus; distanceM: number | null } {
  if (facility.lat === null || facility.lon === null) return { status: 'FACILITY_NOT_CONFIGURED', distanceM: null };
  if (!device) return { status: 'NO_LOCATION', distanceM: null };
  const distanceM = Math.round(haversineMeters({ lat: facility.lat, lon: facility.lon }, device));
  if (device.accuracyM === null || device.accuracyM > MAX_ACCEPTABLE_ACCURACY_M) {
    return { status: 'LOW_ACCURACY', distanceM };
  }
  // Give the benefit of the doubt up to the reported accuracy.
  return { status: distanceM - device.accuracyM <= facility.radiusM ? 'VERIFIED' : 'OUTSIDE_RADIUS', distanceM };
}
