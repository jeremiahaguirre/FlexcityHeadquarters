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
  shareLocation: boolean;
  locationAt: string | null;
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

/**
 * Keeps the session's location up to date while the app is open (and the screen on). Browsers
 * stop sharing location when the app is in the background or the phone is locked; no web app
 * can do more, so the check-in timer and push reminders remain the safety net.
 */
export function watchLocation(send: (p: { latitude: number; longitude: number }) => void, onError: (denied: boolean) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError(false);
    return () => undefined;
  }
  let last = 0;
  const id = navigator.geolocation.watchPosition(
    (p) => {
      if (Date.now() - last < 30_000) return;
      last = Date.now();
      send({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)) });
    },
    (e) => onError(e.code === e.PERMISSION_DENIED),
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: 60_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
