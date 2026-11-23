export type VehicleStatus = 'READY' | 'NEEDS_INSPECTION' | 'OUT_OF_SERVICE';
export interface Vehicle { id: string; unit: string; description: string; plate: string | null; facilityId: string | null; certificationId: string | null; active: boolean; outOfService: boolean; outOfServiceReason: string | null; outOfServiceAt: string | null; lastInspection: { at: string; result: 'PASS' | 'MINOR' | 'MAJOR' } | null; status: VehicleStatus }
export const STATUS_TONE = { READY: 'ok', NEEDS_INSPECTION: 'warn', OUT_OF_SERVICE: 'danger' } as const;

/** The vehicle form as the API takes it: blanks are "none", so clearing a plate, licence or yard removes it. */
export function vehicleBody(f: FormData) {
  const s = (k: string) => String(f.get(k) ?? '').trim();
  return { unit: s('unit'), description: s('description'), plate: s('plate') || null, certificationId: s('cert') || null, facilityId: s('facility') || null };
}
