'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api, logout } from './api';
import { setTimeFormat } from './format';
import { LOCALE_COOKIE } from './i18n';

export interface Me {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  locale: 'en-CA' | 'fr-CA';
  /** The city's clock: "auto" (the language's usual style), "12h" or "24h". */
  timeFormat?: 'auto' | '12h' | '24h';
  roles: string[];
  customRoles?: Array<{ id: string; name: string; nameFr: string | null }>;
  permissions: string[];
  /** Menu items the city hid for this person's roles (Dev console). */
  hiddenMenu?: string[];
  /** The organization requires a passkey for this account and this session hasn't used one. */
  mfaRequired?: boolean;
  /** For whoever handles billing: screens their plan doesn't include yet, and the add-on that unlocks each. */
  lockedMenu?: Array<{ href: string; key: string; group: 'mine' | 'deck' | 'manage' | 'union'; addOn: 'hr' | 'ops' | 'union' }>;
  billing?: { stage: 'unbilled' | 'trial' | 'ok' | 'overdue' | 'suspended'; overdueSince: string | null; suspendsOn: string | null; trialEndsAt: string | null; canPay: boolean };
  /** An FH support visit (read-only, with the organization's consent). */
  support?: { admin: string; level: 'SETUP' | 'FULL'; endsAt: string };
  /** The organization is closed (offboarded): only the data export is open. */
  closed?: { exportUntil: string | null };
  employmentStatus: string;
  positions: Array<{ id: string; name: string; nameFr: string | null }>;
  certifications: Array<{ id: string; certification: { id: string; name: string; nameFr: string | null }; issueDate: string; expiryDate: string | null; verified: boolean }>;
}

interface SessionValue {
  me: Me | null;
  can: (permission: string) => boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionValue>({ me: null, can: () => false, reload: async () => undefined, signOut: async () => undefined });

/** Loads the signed-in person once for every app screen; sends anyone signed out to /login. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { i18n } = useTranslation();

  const reload = useCallback(async () => {
    try {
      const m = await api<Me>('/api/me');
      setTimeFormat(m.timeFormat);
      setMe(m);
      // Use the person's own language unless they picked one on this device.
      const chosen = document.cookie.includes(`${LOCALE_COOKIE}=`);
      if (!chosen && m.locale !== i18n.language) {
        document.documentElement.lang = m.locale;
        void i18n.changeLanguage(m.locale);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      else throw e;
    }
  }, [i18n, pathname, router]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: SessionValue = {
    me,
    can: (p) => !!me?.permissions.includes(p),
    reload,
    signOut: async () => {
      await logout();
      router.replace('/login');
    },
  };
  return <Ctx.Provider value={value}>{me ? children : fallback}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
