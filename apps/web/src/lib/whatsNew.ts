'use client';

import { useCallback } from 'react';
import { api } from './api';
import { useQuery } from './useQuery';
import { useLiveChange } from './useLiveChange';

/** FH's What's new notes for the signed-in person (API routes/updates.ts). */
export interface StaffNote { id: string; title: { en: string; fr: string }; body: { en: string; fr: string }; publishAt: string; readAt: string | null }
export interface WhatsNew { notes: StaffNote[]; unseen: string[] }

export { type Block, noteDate, parseNoteBody, pick } from './noteText';

export function useWhatsNew(enabled = true) {
  const q = useQuery<WhatsNew>(enabled ? '/api/me/whats-new' : null);
  // A note published while the app is open appears without a reload.
  useLiveChange('updates', q.reload);
  const markRead = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      await api('/api/me/whats-new/read', { method: 'POST', body: { ids } }).catch(() => undefined);
      await q.reload();
    },
    [q],
  );
  return { ...q, markRead };
}
