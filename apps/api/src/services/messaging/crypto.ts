/**
 * Message sealing. Each conversation has one 256-bit data key, wrapped by the organization's key
 * (KMS in production, services/crypto/envelope.ts) and stored only wrapped. A message's text (and
 * any file sent with it) is sealed with AES-256-GCM under that key, with a fresh IV and an AAD naming
 * the organization, conversation and message, so a sealed text can't be moved to another row.
 *
 * One key per conversation rather than per message: opening a page of 50 messages costs one KMS
 * call, not 50. The unwrapped key lives only for the request and is wiped after.
 *
 * Search: message text is never searchable on the server (that would need it unsealed or indexed).
 * People find conversations by name and member; within an open conversation the browser can search
 * what it already shows.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { keys, tenantKekId } from '../../routes/context.js';

export interface SealedText { ciphertext: Buffer; iv: Buffer; authTag: Buffer }

export async function newConversationKey(tenantId: string): Promise<{ wrappedKey: Buffer; kekId: string }> {
  const kekId = tenantKekId(tenantId);
  const { plaintext, wrapped } = await keys().generateDataKey(kekId);
  plaintext.fill(0);
  return { wrappedKey: wrapped, kekId };
}

/** Runs `fn` with the conversation's unwrapped key, then wipes it. */
export async function withConversationKey<T>(c: { wrappedKey: Buffer | Uint8Array; kekId: string }, fn: (key: Buffer) => Promise<T> | T): Promise<T> {
  const key = await keys().unwrapDataKey(c.kekId, Buffer.from(c.wrappedKey));
  try {
    return await fn(key);
  } finally {
    key.fill(0);
  }
}

export const messageAad = (tenantId: string, conversationId: string, messageId: string, part: 'text' | 'original' | 'file' | 'name') => `msg:${part}:${tenantId}:${conversationId}:${messageId}`;

export function sealWith(key: Buffer, data: string | Buffer, aad: string): SealedText {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([c.update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data), c.final()]);
  return { ciphertext, iv, authTag: c.getAuthTag() };
}

export function openWith(key: Buffer, s: { ciphertext: Buffer | Uint8Array; iv: Buffer | Uint8Array; authTag: Buffer | Uint8Array }, aad: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(s.authTag));
  return Buffer.concat([d.update(Buffer.from(s.ciphertext)), d.final()]);
}
