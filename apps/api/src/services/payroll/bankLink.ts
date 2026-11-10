/**
 * Sending deposit files straight to the city's bank (host-to-host SFTP), so an
 * approved pay run reaches the bank without anyone downloading and uploading it.
 *
 * Canadian banks take payroll files (CPA-005) over SFTP, most asking for each
 * file to be PGP-encrypted with the bank's public key. Safeguards:
 * - the bank's server is pinned by its host-key fingerprint, so a look-alike
 *   server can't receive the file;
 * - the login password or private key is sealed with the city's key;
 * - each run is sent once; a failed attempt can be retried, a sent one can't.
 */
import { createHash } from 'node:crypto';
import * as openpgp from 'openpgp';
import { Client, type ConnectConfig } from 'ssh2';
import { HttpError } from '../../lib/errors.js';
import { keys, tenantKekId } from '../../routes/context.js';
import { open, seal } from '../crypto/envelope.js';

export interface BankLink {
  host: string;
  port: number;
  username: string;
  remoteDir: string;
  /** SHA256 fingerprint of the bank's host key, as `ssh-keygen -lf` prints it (without the "SHA256:" prefix). */
  hostKeySha256: string;
  /** The bank's PGP public key (armored); files are encrypted with it when present. */
  pgpPublicKey?: string;
  pgpFingerprint?: string;
  /** Send automatically when a pay run is approved. */
  autoSend: boolean;
  credentialKind: 'password' | 'privateKey';
  /** Sealed password or private key. */
  credential: { c: string; iv: string; t: string; k: string; kek: string };
}

const aad = (tenantId: string) => `bank-link:${tenantId}`;

export async function sealCredential(tenantId: string, secret: string) {
  const s = await seal(keys(), tenantKekId(tenantId), secret, aad(tenantId));
  return { c: s.ciphertext.toString('base64'), iv: s.iv.toString('base64'), t: s.authTag.toString('base64'), k: s.wrappedDataKey.toString('base64'), kek: s.kekId };
}

async function openCredential(tenantId: string, c: BankLink['credential']) {
  return open(keys(), { ciphertext: Buffer.from(c.c, 'base64'), iv: Buffer.from(c.iv, 'base64'), authTag: Buffer.from(c.t, 'base64'), wrappedDataKey: Buffer.from(c.k, 'base64'), kekId: c.kek }, aad(tenantId));
}

/** Reads the bank's PGP key, refusing private keys and anything that isn't a key. */
export async function checkPgpKey(armored: string): Promise<string> {
  try {
    const key = await openpgp.readKey({ armoredKey: armored });
    if (key.isPrivate()) throw new Error('private');
    return key.getFingerprint().toUpperCase();
  } catch {
    throw new HttpError(400, 'BAD_PGP_KEY', 'That isn’t a PGP public key. Paste the public key your bank gave you, including the BEGIN and END lines.');
  }
}

export const normalizeFingerprint = (f: string) => f.trim().replace(/^SHA256:/i, '').replace(/=+$/, '');

/** Encrypts a file for the bank (binary OpenPGP message). */
export async function encryptForBank(content: string, armoredKey: string): Promise<Buffer> {
  const encryptionKeys = await openpgp.readKey({ armoredKey });
  const message = await openpgp.createMessage({ binary: Buffer.from(content, 'latin1') });
  const out = await openpgp.encrypt({ message, encryptionKeys, format: 'binary' });
  return Buffer.from(out as Uint8Array);
}

async function connect(tenantId: string, link: BankLink): Promise<Client> {
  const secret = await openCredential(tenantId, link.credential);
  const want = normalizeFingerprint(link.hostKeySha256);
  return new Promise((resolve, reject) => {
    const c = new Client();
    let seen = '';
    const cfg: ConnectConfig = {
      host: link.host,
      port: link.port,
      username: link.username,
      readyTimeout: 20_000,
      ...(link.credentialKind === 'password' ? { password: secret } : { privateKey: secret }),
      // Pin the bank's server: refuse anything whose host key doesn't match.
      hostVerifier: (key: Buffer) => {
        seen = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
        return seen === want;
      },
    };
    c.on('ready', () => resolve(c));
    c.on('error', (e) => {
      if (seen && seen !== want) reject(new HttpError(502, 'BANK_HOST_MISMATCH', `The bank’s server identified itself as SHA256:${seen}, not the fingerprint on file. Nothing was sent. Confirm the fingerprint with your bank.`));
      else reject(new HttpError(502, 'BANK_UNREACHABLE', `Couldn’t connect to the bank: ${e.message}`));
    });
    c.connect(cfg);
  });
}

function sftp(c: Client): Promise<import('ssh2').SFTPWrapper> {
  return new Promise((resolve, reject) => c.sftp((e, s) => (e ? reject(e) : resolve(s))));
}

/** Connects, checks the folder exists, and lists how many files are in it. Sends nothing. */
export async function testBankLink(tenantId: string, link: BankLink): Promise<{ ok: true; files: number }> {
  const c = await connect(tenantId, link);
  try {
    const s = await sftp(c);
    const list = await new Promise<unknown[]>((resolve, reject) => s.readdir(link.remoteDir, (e, l) => (e ? reject(new HttpError(502, 'BANK_FOLDER', `Connected, but the folder ${link.remoteDir} couldn’t be opened: ${e.message}`)) : resolve(l))));
    return { ok: true, files: list.length };
  } finally {
    c.end();
  }
}

/** Uploads one file to the bank's folder. Refuses to overwrite a file of the same name. */
export async function uploadToBank(tenantId: string, link: BankLink, fileName: string, content: Buffer): Promise<void> {
  const c = await connect(tenantId, link);
  try {
    const s = await sftp(c);
    const path = `${link.remoteDir.replace(/\/+$/, '')}/${fileName}`;
    await new Promise<void>((resolve, reject) => {
      // 'wx': create only; a file already there means it was sent before.
      s.open(path, 'wx', (e, handle) => {
        if (e) return reject(new HttpError(502, 'BANK_UPLOAD', `The bank didn’t accept ${fileName}: ${e.message}`));
        s.write(handle, content, 0, content.length, 0, (we) => {
          s.close(handle, (ce) => (we || ce ? reject(new HttpError(502, 'BANK_UPLOAD', `Sending ${fileName} failed part-way: ${(we ?? ce)!.message}`)) : resolve()));
        });
      });
    });
  } finally {
    c.end();
  }
}

export const linkView = (l: BankLink | undefined) =>
  l
    ? { configured: true, host: l.host, port: l.port, username: l.username, remoteDir: l.remoteDir, hostKeySha256: l.hostKeySha256, pgpFingerprint: l.pgpFingerprint ?? null, autoSend: l.autoSend, credentialKind: l.credentialKind }
    : { configured: false };
