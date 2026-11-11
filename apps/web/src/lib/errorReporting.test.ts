import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReport, installErrorReporting, reportError, resetErrorReporting, routeOf } from './errorReporting';

const fakeWindow = (hostname = 'kelowna.localhost', pathname = '/manage/people/5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6') => {
  const listeners = new Map<string, (e: unknown) => void>();
  const w = {
    location: { hostname, pathname },
    addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f),
    removeEventListener: (t: string) => listeners.delete(t),
  };
  vi.stubGlobal('window', w);
  return { w, listeners };
};

describe('browser error reports', () => {
  afterEach(() => {
    resetErrorReporting();
    vi.unstubAllGlobals();
  });

  it('sends the page’s path without ids or query string', () => {
    expect(routeOf('/manage/people/5f0c2a8e-1b2c-4d3e-8f90-a1b2c3d4e5f6/edit?q=avery')).toBe('/manage/people/:id/edit');
    expect(routeOf('/schedule')).toBe('/schedule');
    expect(routeOf('/r/avery%40city.ca')).toBe('/r/:id');
  });

  it('carries the error, the route and the build, and nothing else', () => {
    const r = buildReport('boundary', new TypeError('x is undefined'), '/today?tab=2', 'abc123');
    expect(Object.keys(r).sort()).toEqual(['digest', 'kind', 'message', 'name', 'release', 'route', 'stack']);
    expect(r).toMatchObject({ kind: 'boundary', name: 'TypeError', message: 'x is undefined', route: '/today', digest: 'abc123' });
    expect(r.release).toBeTruthy();
    expect(buildReport('unhandledrejection', { status: 500 }, '/').message).toBe('non-error rejection (object)');
  });

  it('posts each distinct error once, to the API, with the organization header', () => {
    fakeWindow();
    const send = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    expect(reportError('error', new Error('boom'), { send })).toBe(true);
    expect(reportError('error', new Error('boom'), { send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/client-errors');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit', headers: { 'x-tenant-subdomain': 'kelowna' } });
    expect(JSON.parse(String(init.body))).toMatchObject({ kind: 'error', message: 'boom', route: '/manage/people/:id' });
  });

  it('stops after ten reports a page', () => {
    fakeWindow('localhost', '/platform');
    const send = vi.fn(() => Promise.resolve(new Response(null)));
    for (let i = 0; i < 15; i++) reportError('error', new Error(`e${i}`), { send });
    expect(send).toHaveBeenCalledTimes(10);
  });

  it('listens for uncaught errors and rejections, and stops when asked', () => {
    const { w, listeners } = fakeWindow();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null))));
    const stop = installErrorReporting(w as unknown as Window);
    listeners.get('error')!({ message: 'Script error.', error: null });
    listeners.get('unhandledrejection')!({ reason: new Error('rejected') });
    expect(fetch).toHaveBeenCalledTimes(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});
