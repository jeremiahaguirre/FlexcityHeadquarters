'use client';

import { api } from './api';
import { DEMO } from './demo';

/** Installing the app (no app store) and push notifications, as far as each browser allows. */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
declare global {
  interface Window {
    fhInstallPrompt?: InstallPromptEvent | null;
  }
}

/** Android Chrome, Edge, Samsung: the browser offers an install prompt we can trigger. Kept from page load. */
export function captureInstallPrompt() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.fhInstallPrompt = e as InstallPromptEvent;
    window.dispatchEvent(new Event('fh-install-ready'));
  });
  window.addEventListener('appinstalled', () => {
    window.fhInstallPrompt = null;
    window.dispatchEvent(new Event('fh-install-ready'));
  });
}

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const isIos = () =>
  typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const isAndroid = () => typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);

export type InstallWay = 'installed' | 'prompt' | 'ios' | 'android-menu' | 'none';
export function installWay(): InstallWay {
  if (DEMO || typeof window === 'undefined') return 'none';
  if (isStandalone()) return 'installed';
  if (window.fhInstallPrompt) return 'prompt';
  if (isIos()) return 'ios';
  if (isAndroid()) return 'android-menu';
  return 'none';
}

export async function promptInstall(): Promise<boolean> {
  const e = window.fhInstallPrompt;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  window.fhInstallPrompt = null;
  return outcome === 'accepted';
}

// ---------- Push ----------

export type PushState = 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on' | 'unavailable';

export const pushSupported = () =>
  !DEMO && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register('/sw.js');
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${os}${browser ? ` · ${browser}` : ''}`;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const { publicKey } = await api<{ publicKey: string | null }>('/api/push/key');
  if (!publicKey) return 'unavailable';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function send(sub: PushSubscription) {
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/api/me/push', { method: 'POST', body: { endpoint: j.endpoint, keys: j.keys, device: deviceLabel() } });
}

/** Asks for permission (must follow a tap) and registers this device. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const { publicKey } = await api<{ publicKey: string | null }>('/api/push/key');
  if (!publicKey) return 'unavailable';
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  await send(sub);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return pushState();
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await api('/api/me/push', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return 'off';
}

/**
 * On each app start: re-send this device's subscription for whoever is signed in (the browser may
 * have rotated its keys, or someone else signed in on a shared tablet).
 */
export async function syncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await send(sub);
  } catch {
    /* best effort */
  }
}

/** On sign-out: this device stops getting the person's notifications. */
export async function forgetPushDevice() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/api/me/push', { method: 'DELETE', body: { endpoint: sub.endpoint } }, false).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
  } catch {
    /* best effort */
  }
}

// ---------- Screen wake lock (keeps the app in front, so location keeps updating) ----------

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;
export async function keepAwake(): Promise<(() => void) | null> {
  if (!wakeLockSupported()) return null;
  try {
    let lock: WakeLockSentinel | null = await navigator.wakeLock.request('screen');
    // The lock drops when the app goes to the background; take it again on return.
    const again = async () => {
      if (document.visibilityState === 'visible' && lock?.released !== false) lock = await navigator.wakeLock.request('screen').catch(() => null);
    };
    document.addEventListener('visibilitychange', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      void lock?.release().catch(() => undefined);
      lock = null;
    };
  } catch {
    return null;
  }
}
