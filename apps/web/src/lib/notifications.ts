'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, streamNotifications } from './api';

export interface AppNotification {
  id: string;
  type: string;
  params: Record<string, unknown>;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Unread count + recent items; refreshes live when the server signals a new one. */
export function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ items: AppNotification[]; unreadCount: number }>('/api/notifications');
      setItems(r.items);
      setUnread(r.unreadCount);
    } catch {
      /* the bell is non-critical; try again on the next signal */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const stop = streamNotifications(() => void refresh());
    const poll = setInterval(() => void refresh(), 120_000); // safety net if the stream drops
    return () => {
      stop();
      clearInterval(poll);
    };
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    setUnread(0);
    await api('/api/notifications/read', { method: 'POST', body: { all: true } }).catch(() => undefined);
    void refresh();
  }, [refresh]);

  return { items, unread, refresh, markAllRead };
}
