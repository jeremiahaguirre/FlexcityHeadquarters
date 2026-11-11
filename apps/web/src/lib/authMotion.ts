/** Lets the sign-in form tell the logo above it what is happening (they live in different components). */
export type AuthMotion = 'idle' | 'working' | 'done';
export const AUTH_MOTION_EVENT = 'fh-auth-motion';
export function setAuthMotion(state: AuthMotion) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<AuthMotion>(AUTH_MOTION_EVENT, { detail: state }));
}
/** A short pause so the finishing flourish is seen; none for reduced motion. */
export const doneBeat = () => new Promise<void>((r) => setTimeout(r, typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450));
