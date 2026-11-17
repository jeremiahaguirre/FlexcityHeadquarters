/**
 * Live builds use this instead of demoApi.ts (next.config.mjs): the demo's request handlers, its
 * recorded sample data (about 2 MB), its simulations and the API code it borrows never reach a
 * production bundle (ARCHITECTURE-REVIEW A15). Nothing calls these outside the demo (DEMO is false).
 */
const notInLiveBuilds = (): never => {
  throw new Error('The demo is not part of this build');
};

export async function demoApi<T>(_path: string, _init: { method?: string; body?: unknown } = {}): Promise<T> {
  return notInLiveBuilds();
}

export async function demoPlatformApi<T>(_path: string, _init: { method?: string; body?: unknown } = {}): Promise<T> {
  return notInLiveBuilds();
}

export function demoPlatformFile(_name: string): Blob {
  return notInLiveBuilds();
}

export function nearest(_data: unknown, _path: string): unknown {
  return notInLiveBuilds();
}
