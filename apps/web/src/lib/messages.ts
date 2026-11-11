'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { useLiveChange } from './useLiveChange';

/** Team messaging (API: routes/messages.ts). Shapes the screens use. */
export type ConversationKind = 'DIRECT' | 'SHIFT' | 'DEPARTMENT' | 'GROUP';
export type ReadOnly = null | 'archived' | 'safeguarding' | 'inactive' | 'alone' | 'notAllowed';

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  title: string | null;
  titleFr?: string | null;
  otherId?: string | null;
  shift?: { startsAt: string; endsAt: string; timezone: string | null };
  memberCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  unread: number;
  muted: boolean;
  readOnly: ReadOnly;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  author: string | null;
  mine: boolean;
  text: string | null;
  removed: boolean;
  createdAt: string;
  editedAt: string | null;
  attachment: { fileName: string; contentType: string; size: number } | null;
  canEdit: boolean;
  /** Investigation only: the first version of an edited message. */
  original?: string | null;
}

export interface ConversationDetail extends Omit<ConversationSummary, 'unread' | 'memberCount' | 'lastMessageAt' | 'createdAt'> {
  closesAt: string | null;
  owner: boolean;
  investigation: { reason: string; expiresAt: string } | null;
  members: Array<{ id: string; name: string | null; lastReadAt: string | null; owner: boolean; active: boolean }>;
  messages: ChatMessage[];
  more: boolean;
}

export interface DirectoryPerson { id: string; name: string; direct: boolean; directBlocked: 'safeguarding' | null; group: boolean; hr: boolean }
export interface Directory { people: DirectoryPerson[]; canGroup: boolean; departments: Array<{ id: string; name: string; nameFr: string | null }> }

export const MAX_TEXT = 2000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** A conversation's name on screen. */
export function conversationTitle(c: Pick<ConversationSummary, 'kind' | 'title' | 'titleFr'>, lng: string, fallback: string): string {
  if (c.kind === 'DEPARTMENT' && lng === 'fr-CA' && c.titleFr) return c.titleFr;
  return c.title || fallback;
}

/** Who has seen a message: members other than the author whose read receipt is at or after it. */
export function seenBy(m: Pick<ChatMessage, 'createdAt' | 'authorId'>, members: ConversationDetail['members']): string[] {
  const at = new Date(m.createdAt).getTime();
  return members.filter((x) => x.id !== m.authorId && x.lastReadAt && new Date(x.lastReadAt).getTime() >= at).map((x) => x.name ?? '');
}

/** Messages from the same person within five minutes sit together under one name. */
export function startsGroup(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  return !prev || prev.authorId !== m.authorId || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
}

/** Unread messages for the menu badge, refreshed live (no polling). Null until known or without messaging. */
export function useUnreadMessages(enabled: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  const load = () => {
    if (!enabled) return;
    api<{ total: number }>('/api/messages/unread').then((r) => setN(r.total), () => undefined);
  };
  useEffect(load, [enabled]);
  useLiveChange('messages', load);
  return enabled ? n : null;
}

/** A picked file as the data URL the API takes. */
export function readFile(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}
