export type LoneStatus = 'ACTIVE' | 'OVERDUE' | 'ESCALATED' | 'HELP' | 'ENDED';
export interface LoneSession {
  id: string;
  userId: string;
  person?: string;
  phone: string | null;
  facilityId: string | null;
  location: string;
  task: string | null;
  intervalMinutes: number;
  status: LoneStatus;
  startedAt: string;
  lastCheckInAt: string;
  nextDueAt: string;
  helpNote: string | null;
  latitude: number | null;
  longitude: number | null;
  responder: string | null;
  endedAt: string | null;
}
export const INTERVALS = [15, 30, 60, 90, 120] as const;

/** The device's position, if the person allows it; never blocks the action. */
export function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60_000 },
    );
  });
}

export const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
