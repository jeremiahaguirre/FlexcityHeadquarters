/**
 * Team messaging and staff surveys under load, against a running API (LOAD_API, default
 * http://localhost:4200) on the database seed.ts and seed-comms.ts made. Tokens are minted directly
 * (same JWT_SECRET); message history is sealed directly (same LOCAL_KEK_BASE64 as the API).
 *
 *   JWT_SECRET=… LOCAL_KEK_BASE64=… DATABASE_URL=…/flexcity_load npx tsx test/load/comms.ts \
 *     [--log api.log] [--metrics-token …] [--msg-seconds 300] [--active 0.1] [--sse-cities 3] \
 *     [--answer-rate 10] [--answer-seconds 240] [--only messaging|surveys] [--client coalesce|each]
 *
 * Messaging:
 *  M0. Set-up: today's shifts (six crews of ~50 per city), each city's six department conversations
 *      and six shift conversations opened by a member, and a 200-person group made by HR; 400
 *      sealed messages of history in every department conversation (for paging).
 *  M1. Peak five minutes: 10% of the 9,000 staff (--active) send 1–4 messages each in their shift or
 *      department conversation, 40% of them arriving in the first minute (the shift change). Each
 *      opens the unread badge, the list and the thread, sends, marks read; one in ten pages back
 *      through the department history; 2% of messages carry a 40 KB image, which the sender opens.
 *      Meanwhile every worker of --sse-cities cities holds the live stream open and reacts the way the
 *      web app does: a "messages" change refetches the badge; the 30% who have their department's
 *      conversation open also refetch the list and the thread and mark it read when it has a new
 *      message; a notification refetches the bell. Signals for one topic within 250 ms refetch once, as
 *      in the web app (lib/coalesce.ts); --client each replays the earlier app, one refetch per signal.
 *  M2. Fan-out: the 200 group members hold streams open (passively) alongside the reacting ones;
 *      HR sends 30 messages into the group, one every 2 s, first on a quiet system, then with
 *      background senders in other cities (--bg-rate a second). Measured: send to each member's
 *      `event: change`.
 * Surveys (the "loadpulse" organization, 3,000 staff in twelve departments of 5 to 600):
 *  S1. HR sends an organization-wide pulse (eight questions, broken down by department).
 *  S2. Answers arrive at --answer-rate a second for --answer-seconds (each opens /me/surveys, then answers).
 *  S3. HR closes it, opens the results (alone, then five at once) and downloads the CSV.
 * Each scenario reports p50/p95/p99/max, errors by status, throughput, the API's event-loop delay
 * and memory (from /metrics, with --metrics-token) and its slow queries (from --log, with
 * SLOW_QUERY_MS set on the API), plus this load generator's own event-loop delay.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createPrismaClient } from '../../src/lib/prismaClient.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { messageAad, sealWith, withConversationKey } from '../../src/services/messaging/crypto.js';

const API = process.env.LOAD_API ?? 'http://localhost:4200';
const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] ?? '']] : a), []));
const LOG = args.log ?? '';
const METRICS_TOKEN = args['metrics-token'] ?? process.env.METRICS_TOKEN ?? '';
const MSG_SECONDS = Number(args['msg-seconds'] ?? 300);
const ACTIVE = Number(args.active ?? 0.1);
const SSE_CITIES = Number(args['sse-cities'] ?? 3);
const BG_RATE = Number(args['bg-rate'] ?? 5);
const ANSWER_RATE = Number(args['answer-rate'] ?? 10);
const ANSWER_SECONDS = Number(args['answer-seconds'] ?? 240);
const ONLY = args.only ?? '';
/** How the simulated web app reacts to live signals: 'coalesce' (current) or 'each' (every signal refetches, before lib/coalesce.ts). */
const CLIENT = args.client ?? 'coalesce';
const HISTORY = 400;

type City = { sub: string; tenantId: string; hr: string; sup: string; workers: string[]; facilities: string[]; positions: string[] };
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8')) as { cities: City[] };
const comms = JSON.parse(readFileSync(new URL('./comms-plan.json', import.meta.url), 'utf8')) as {
  cities: Array<{ sub: string; tenantId: string; departments: string[] }>;
  pulse: { sub: string; tenantId: string; hr: string; workers: string[]; departments: Array<{ id: string; size: number }> };
};
const big = plan.cities.filter((c) => c.sub !== 'loadsmall');
const deptsOf = new Map(comms.cities.map((c) => [c.tenantId, c.departments]));

// ------------------------------------------------------------------ measuring
type Sample = { name: string; ms: number; status: number };
const samples: Sample[] = [];
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tokens = new Map<string, Promise<string>>();
const tokenFor = (tenantId: string, userId: string, roles: string[]) => {
  const k = `${tenantId}:${userId}`;
  if (!tokens.has(k)) tokens.set(k, signAccessToken({ sub: userId, tid: tenantId, roles: roles as never, aat: now(), ...(roles.includes('HR_ADMIN') ? { mfa: true } : {}) }));
  return tokens.get(k)!;
};
type Who = { sub: string; tenantId: string; userId: string; roles?: string[] };
async function call<T = unknown>(name: string, who: Who, method: string, path: string, body?: unknown, parse = false): Promise<{ status: number; json?: T; ms: number }> {
  const token = await tokenFor(who.tenantId, who.userId, who.roles ?? ['STAFF']);
  const t = performance.now();
  let status = 0;
  let json: T | undefined;
  try {
    const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'x-tenant-subdomain': who.sub, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    status = r.status;
    if (parse && r.ok) json = (await r.json()) as T;
    else await r.arrayBuffer();
  } catch {
    status = -1;
  }
  const ms = performance.now() - t;
  samples.push({ name, ms, status });
  return { status, json, ms };
}
async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;
const sorted = (xs: number[]) => xs.slice().sort((a, b) => a - b);

/** The API's /metrics every 2 s while a scenario runs: event-loop delay (worst p99 and max) and memory (peak). */
function apiProbe() {
  const out = { loopP99: 0, loopMax: 0, rss: 0, heap: 0, scrapes: 0 };
  if (!METRICS_TOKEN) return { stop: async () => out };
  let on = true;
  const scrape = async () => {
    try {
      const t = await (await fetch(`${API}/metrics`, { headers: { authorization: `Bearer ${METRICS_TOKEN}` } })).text();
      const g = (re: RegExp) => Number(re.exec(t)?.[1] ?? 0);
      out.loopP99 = Math.max(out.loopP99, g(/fh_event_loop_delay_seconds\{quantile="0.99"\} ([\d.e+-]+)/));
      out.loopMax = Math.max(out.loopMax, g(/fh_event_loop_delay_seconds\{quantile="1"\} ([\d.e+-]+)/));
      out.rss = Math.max(out.rss, g(/fh_process_resident_memory_bytes ([\d.e+-]+)/));
      out.heap = Math.max(out.heap, g(/fh_process_heap_used_bytes ([\d.e+-]+)/));
      out.scrapes++;
    } catch {
      /* a missed scrape */
    }
  };
  const loop = (async () => {
    await scrape(); // resets the API's event-loop histogram
    out.loopP99 = out.loopMax = 0;
    while (on) {
      await sleep(2000);
      await scrape();
    }
  })();
  return {
    stop: async () => {
      on = false;
      await loop;
      return out;
    },
  };
}

/** Slow queries the API logged (SLOW_QUERY_MS) since `from` bytes into --log. */
function logSize() {
  try {
    return LOG ? statSync(LOG).size : 0;
  } catch {
    return 0;
  }
}
function slowSince(from: number): { n: number; top: Array<[string, number, number]> } {
  if (!LOG) return { n: 0, top: [] };
  const size = logSize();
  if (size <= from) return { n: 0, top: [] };
  const fd = openSync(LOG, 'r');
  const buf = Buffer.alloc(size - from);
  readSync(fd, buf, 0, buf.length, from);
  closeSync(fd);
  const by = new Map<string, [number, number]>();
  let n = 0;
  for (const line of buf.toString('utf8').split('\n')) {
    const m = /\[slow-query\] (\d+) ms: (.*)$/.exec(line);
    if (!m) continue;
    n++;
    const k = m[2]!.slice(0, 160);
    const v = by.get(k) ?? [0, 0];
    by.set(k, [v[0] + 1, Math.max(v[1], Number(m[1]))]);
  }
  return { n, top: [...by.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 5).map(([k, [c, mx]]) => [k, c, mx]) };
}

const genLoop = monitorEventLoopDelay({ resolution: 20 });
genLoop.enable();
function scenario(title: string) {
  const mark = samples.length;
  const t0 = performance.now();
  const logFrom = logSize();
  const probe = apiProbe();
  genLoop.reset();
  return async (extra: string[] = []) => {
    const seconds = (performance.now() - t0) / 1000;
    const p = await probe.stop();
    const mine = samples.slice(mark);
    const names = [...new Set(mine.map((s) => s.name))];
    console.log(`\n## ${title} (${mine.length} requests in ${seconds.toFixed(1)} s, ${(mine.length / seconds).toFixed(0)} req/s)`);
    console.log('| Request | n | p50 ms | p95 ms | p99 ms | max ms | errors |');
    console.log('| --- | --- | --- | --- | --- | --- | --- |');
    for (const n of names) {
      const s = mine.filter((x) => x.name === n);
      const ms = sorted(s.map((x) => x.ms));
      const errs = s.filter((x) => x.status < 200 || x.status >= 400);
      const byStatus = [...new Set(errs.map((e) => e.status))].map((st) => `${st}×${errs.filter((e) => e.status === st).length}`).join(' ');
      console.log(`| ${n} | ${s.length} | ${pct(ms, 50).toFixed(0)} | ${pct(ms, 95).toFixed(0)} | ${pct(ms, 99).toFixed(0)} | ${ms[ms.length - 1]!.toFixed(0)} | ${byStatus || '0'} |`);
    }
    for (const e of extra) console.log(e);
    // Each send, thread read and file read unwraps the conversation's key: one KMS Decrypt in production.
    const unwraps = mine.filter((x) => x.status >= 200 && x.status < 300 && /POST message|conversations\/:id(?!\/read)|\/file/.test(x.name)).length;
    if (unwraps) console.log(`conversation-key unwraps (one KMS Decrypt each in production): ${unwraps}, ${(unwraps / seconds).toFixed(1)} a second on average`);
    if (METRICS_TOKEN) console.log(`API process: event-loop delay worst p99 ${(p.loopP99 * 1000).toFixed(0)} ms, max ${(p.loopMax * 1000).toFixed(0)} ms; peak RSS ${(p.rss / 2 ** 20).toFixed(0)} MB, heap ${(p.heap / 2 ** 20).toFixed(0)} MB (${p.scrapes} scrapes)`);
    const slow = slowSince(logFrom);
    if (LOG) {
      console.log(`slow queries logged: ${slow.n}`);
      for (const [q, c, mx] of slow.top) console.log(`  ${c}× (max ${mx} ms) ${q}`);
    }
    console.log(`load generator event-loop delay: p99 ${(genLoop.percentile(99) / 1e6).toFixed(0)} ms, max ${(genLoop.max / 1e6).toFixed(0)} ms`);
  };
}

// ------------------------------------------------------------------ live streams
interface Stream { who: Who; changes: number[]; notifications: number; close: () => void }
const streams: Stream[] = [];
/** Opens the live stream like the web app (fetch with the token), resolves once it says ready. */
async function openStream(who: Who, react?: (ev: 'change' | 'notification', topic: string) => void): Promise<Stream> {
  const token = await tokenFor(who.tenantId, who.userId, who.roles ?? ['STAFF']);
  const ac = new AbortController();
  const s: Stream = { who, changes: [], notifications: 0, close: () => ac.abort() };
  const t = performance.now();
  let ready!: () => void;
  let failed!: (e: unknown) => void;
  const isReady = new Promise<void>((res, rej) => ((ready = res), (failed = rej)));
  void (async () => {
    try {
      const r = await fetch(`${API}/api/notifications/stream`, { headers: { authorization: `Bearer ${token}`, 'x-tenant-subdomain': who.sub }, signal: ac.signal });
      if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const at = performance.now();
        buf += dec.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const e of events) {
          if (e.startsWith('event: ready')) {
            samples.push({ name: 'GET /notifications/stream (until ready)', ms: performance.now() - t, status: 200 });
            ready();
          } else if (e.startsWith('event: change')) {
            const topic = /"topic":"(\w+|\*)"/.exec(e)?.[1] ?? '';
            if (topic === 'messages') s.changes.push(at);
            react?.('change', topic);
          } else if (e.startsWith('event: notification')) {
            s.notifications++;
            react?.('notification', '');
          }
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        samples.push({ name: 'GET /notifications/stream (until ready)', ms: performance.now() - t, status: -1 });
        failed(e);
      }
    }
  })();
  await isReady;
  streams.push(s);
  return s;
}

// ------------------------------------------------------------------ set-up
const owner = createPrismaClient(process.env.DATABASE_URL!);
const PNG = (() => {
  const b = randomBytes(40 * 1024);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return `data:image/png;base64,${b.toString('base64')}`;
})();
const words = 'pool deck shift cover lane swim lesson break schedule chlorine gate towel rescue whistle backwash test'.split(' ');
const text = () => Array.from({ length: 6 + Math.floor(Math.random() * 18) }, () => words[Math.floor(Math.random() * words.length)]).join(' ');

/** Rate-limit hits from earlier runs (per-person message limits), so a repeat run starts clean. */
await owner.rateLimitHit.deleteMany({});
console.log(`# Messaging and surveys load run against ${API}: ${big.length} cities, ${big.reduce((a, c) => a + c.workers.length, 0)} workers; pulse organization ${comms.pulse.workers.length} workers`);

const crewOf = (i: number) => (i % 2) * 3 + (Math.floor(i / 6) % 3);
const deptOfIdx = (i: number) => i % 6;
type CityConvs = { city: City; dept: string[]; shift: string[]; group: string | null; groupMembers: string[] };
const convs: CityConvs[] = [];

if (ONLY !== 'surveys') {
  const done = scenario('M0. Set-up: open department and shift conversations, a 200-person group');
  const base = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 2 * 3_600_000);
  for (const c of big) {
    const teamPositions = await owner.position.findMany({ where: { tenantId: c.tenantId, name: { startsWith: 'Team ' } }, orderBy: { name: 'asc' }, select: { id: true } });
    // Today's crews: earlier runs' crews go first, so crews stay ~50.
    await owner.shift.deleteMany({ where: { tenantId: c.tenantId, positionId: { in: teamPositions.map((p) => p.id) } } });
    const shifts = c.workers.map((userId, i) => {
      const slot = Math.floor(i / 6) % 3;
      const startsAt = new Date(base.getTime() + slot * 8 * 3_600_000);
      return { id: randomUUID(), tenantId: c.tenantId, facilityId: c.facilities[i % 2]!, positionId: teamPositions[deptOfIdx(i)]!.id, userId, startsAt, endsAt: new Date(startsAt.getTime() + 8 * 3_600_000), status: 'PUBLISHED' as const };
    });
    await owner.shift.createMany({ data: shifts });
    convs.push({ city: c, dept: [], shift: [], group: null, groupMembers: c.workers.slice(0, 200) });
    (convs.at(-1) as CityConvs & { shiftIds: string[] }).shiftIds = shifts.map((s) => s.id);
  }
  await pool(convs, 20, async (cv) => {
    const c = cv.city;
    const depts = deptsOf.get(c.tenantId)!;
    for (let d = 0; d < 6; d++) {
      const r = await call<{ id: string }>('POST /messages/department (~50 members)', { sub: c.sub, tenantId: c.tenantId, userId: c.workers[d]! }, 'POST', '/api/messages/department', { departmentId: depts[d] }, true);
      cv.dept[d] = r.json?.id ?? '';
    }
    const ids = (cv as CityConvs & { shiftIds: string[] }).shiftIds;
    for (let k = 0; k < 6; k++) {
      const i = c.workers.findIndex((_, j) => crewOf(j) === k);
      const r = await call<{ id: string }>('POST /messages/shift (crew of ~50)', { sub: c.sub, tenantId: c.tenantId, userId: c.workers[i]! }, 'POST', '/api/messages/shift', { shiftId: ids[i] }, true);
      cv.shift[k] = r.json?.id ?? '';
    }
    const g = await call<{ id: string }>('POST /messages/groups (HR, 200 members)', { sub: c.sub, tenantId: c.tenantId, userId: c.hr, roles: ['HR_ADMIN'] }, 'POST', '/api/messages/groups', { title: `Load group ${Date.now()}`, memberIds: cv.groupMembers }, true);
    cv.group = g.json?.id ?? null;
  });
  // History to page through: HISTORY sealed messages in each department conversation (once).
  let sealed = 0;
  for (const cv of convs) {
    for (const id of cv.dept) {
      if (!id) continue;
      const have = await owner.message.count({ where: { conversationId: id } });
      if (have >= HISTORY) continue;
      const conv = await owner.conversation.findUniqueOrThrow({ where: { id }, select: { wrappedKey: true, kekId: true, members: { select: { userId: true } } } });
      const authors = conv.members.map((m) => m.userId);
      const start = Date.now() - 3 * 86_400_000;
      const rows = await withConversationKey(conv, (key) =>
        Array.from({ length: HISTORY - have }, (_, k) => {
          const mid = randomUUID();
          const s = sealWith(key, text(), messageAad(cv.city.tenantId, id, mid, 'text'));
          return { id: mid, tenantId: cv.city.tenantId, conversationId: id, authorId: authors[k % authors.length]!, ciphertext: s.ciphertext, iv: s.iv, authTag: s.authTag, createdAt: new Date(start + k * 60_000) };
        }),
      );
      await owner.message.createMany({ data: rows });
      sealed += rows.length;
    }
  }
  // Everyone has read what was there before the run.
  await owner.conversationMember.updateMany({ where: { tenantId: { in: big.map((c) => c.tenantId) } }, data: { lastReadAt: new Date() } });
  await done([`history sealed: ${sealed} messages; conversations: ${convs.reduce((a, c) => a + c.dept.filter(Boolean).length + c.shift.filter(Boolean).length + (c.group ? 1 : 0), 0)}`]);
}

// ------------------------------------------------------------------ M1. Peak five minutes
if (ONLY !== 'surveys') {
  // Live streams: every worker of the first --sse-cities cities after loadbig0, reacting like the web app.
  const reactive = convs.slice(1, 1 + SSE_CITIES).flatMap((cv) => cv.city.workers.map((userId, i) => ({ cv, userId, i, viewer: i % 10 < 3 })));
  const open1 = scenario(`M1a. ${reactive.length} live streams connect`);
  await pool(reactive, 50, async (r) => {
    const who = { sub: r.cv.city.sub, tenantId: r.cv.city.tenantId, userId: r.userId };
    const thread = r.cv.dept[deptOfIdx(r.i)]!;
    let lastId: string | null = null;
    let refetching = false;
    const refetchThread = () => {
      if (refetching) return;
      refetching = true;
      void call<{ messages: Array<{ id: string }> }>('live: GET /messages/conversations/:id', who, 'GET', `/api/messages/conversations/${thread}`, undefined, true).then(async (t) => {
        const last = t.json?.messages.at(-1)?.id ?? null;
        refetching = false;
        // The web app marks the open conversation read when a new message shows up in it.
        if (last && last !== lastId) {
          lastId = last;
          await call('live: POST /conversations/:id/read', who, 'POST', `/api/messages/conversations/${thread}/read`);
        }
      });
    };
    const onTopic = (topic: string) => {
      if (topic === 'receipts') return void (r.viewer && refetchThread()); // only the open conversation's "seen by"
      if (topic !== 'messages' && topic !== '*') return;
      void call('live: GET /messages/unread', who, 'GET', '/api/messages/unread');
      if (!r.viewer) return;
      void call('live: GET /messages/conversations', who, 'GET', '/api/messages/conversations');
      refetchThread();
    };
    // --client coalesce (the web app since this run, lib/coalesce.ts): signals for a topic within 250 ms refetch once.
    const pending = new Set<string>();
    await openStream(who, (ev, topic) => {
      if (ev === 'notification') return void call('live: GET /notifications', who, 'GET', '/api/notifications');
      if (CLIENT !== 'coalesce') return onTopic(topic);
      if (pending.has(topic)) return;
      pending.add(topic);
      setTimeout(() => (pending.delete(topic), onTopic(topic)), 250);
    });
  });
  await open1([`streams open: ${streams.length}`]);

  const peak = scenario(`M1b. Peak ${MSG_SECONDS} s: ${Math.round(ACTIVE * 100)}% of staff send in shift and department conversations, ${streams.length} live streams reacting`);
  const senders = convs.flatMap((cv) => cv.city.workers.map((userId, i) => ({ cv, userId, i }))).filter(() => Math.random() < ACTIVE);
  let attachments = 0;
  let sent = 0;
  const burst = 0.4; // share arriving in the first minute (the shift change)
  const firstMin = Math.min(60, MSG_SECONDS);
  await Promise.all(senders.map(async (s, k) => {
    const inBurst = k < senders.length * burst;
    const at = inBurst ? Math.random() * firstMin : firstMin + Math.random() * (MSG_SECONDS - firstMin);
    await sleep(at * 1000);
    const who = { sub: s.cv.city.sub, tenantId: s.cv.city.tenantId, userId: s.userId };
    const conv = Math.random() < 0.7 ? s.cv.shift[crewOf(s.i)]! : s.cv.dept[deptOfIdx(s.i)]!;
    await Promise.all([call('GET /messages/unread', who, 'GET', '/api/messages/unread'), call('GET /messages/conversations', who, 'GET', '/api/messages/conversations')]);
    const page = await call<{ messages: Array<{ createdAt: string }>; more: boolean }>('GET /messages/conversations/:id (newest 50)', who, 'GET', `/api/messages/conversations/${conv}`, undefined, true);
    if (s.i % 10 === 0) {
      // Paging back through the department's history.
      const dept = s.cv.dept[deptOfIdx(s.i)]!;
      let before: string | undefined;
      for (let p = 0; p < 3; p++) {
        const r = await call<{ messages: Array<{ createdAt: string }>; more: boolean }>('GET /messages/conversations/:id?before= (older page)', who, 'GET', `/api/messages/conversations/${dept}${before ? `?before=${encodeURIComponent(before)}` : ''}`, undefined, true);
        before = r.json?.messages[0]?.createdAt;
        if (!r.json?.more || !before) break;
      }
    }
    void page;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let m = 0; m < n; m++) {
      const withFile = Math.random() < 0.02;
      const r = await call<{ id: string }>(withFile ? 'POST message with 40 KB image' : 'POST message', who, 'POST', `/api/messages/conversations/${conv}/messages`, { text: text(), ...(withFile ? { attachment: { fileName: 'deck.png', data: PNG } } : {}) }, true);
      sent++;
      if (withFile && r.json?.id) {
        attachments++;
        await call('GET /messages/:id/file (40 KB)', who, 'GET', `/api/messages/${r.json.id}/file`);
      }
      await call('POST /conversations/:id/read', who, 'POST', `/api/messages/conversations/${conv}/read`);
      if (m < n - 1) await sleep(5000 + Math.random() * 15000);
    }
  }));
  await sleep(3000); // let the last reactions finish
  const ch = streams.reduce((a, s) => a + s.changes.length, 0);
  const nt = streams.reduce((a, s) => a + s.notifications, 0);
  await peak([`senders: ${senders.length}, messages sent: ${sent} (${attachments} with an image); live events received: ${ch} "messages" changes, ${nt} notifications, over ${streams.length} streams`]);

  // ---------------------------------------------------------------- M2. Fan-out to a 200-person group
  const g = convs[0]!;
  const hr = { sub: g.city.sub, tenantId: g.city.tenantId, userId: g.city.hr, roles: ['HR_ADMIN'] };
  const open2 = scenario('M2a. The 200 group members connect (passive streams)');
  const passive: Stream[] = [];
  await pool(g.groupMembers, 50, async (userId) => void passive.push(await openStream({ sub: g.city.sub, tenantId: g.city.tenantId, userId })));
  await open2([`streams open: ${streams.length} (${passive.length} group members)`]);

  async function probe(title: string, background: boolean) {
    const done = scenario(title);
    for (const s of passive) s.changes.length = 0;
    let bg = true;
    let bgSent = 0;
    const bgLoop = background
      ? (async () => {
          const others = convs.slice(1);
          while (bg) {
            await sleep(1000 / BG_RATE);
            const cv = others[Math.floor(Math.random() * others.length)]!;
            const i = Math.floor(Math.random() * cv.city.workers.length);
            const who = { sub: cv.city.sub, tenantId: cv.city.tenantId, userId: cv.city.workers[i]! };
            void call('background: POST message', who, 'POST', `/api/messages/conversations/${cv.shift[crewOf(i)]}/messages`, { text: text() }).then(() => bgSent++);
          }
        })()
      : Promise.resolve();
    if (background) await sleep(5000);
    const sends: Array<{ start: number; end: number }> = [];
    for (let k = 0; k < 30; k++) {
      const start = performance.now();
      await call('POST message to the 200-person group', hr, 'POST', `/api/messages/conversations/${g.group}/messages`, { text: text() });
      sends.push({ start, end: performance.now() });
      await sleep(2000);
    }
    bg = false;
    await bgLoop;
    // Each send: the first "messages" change each member's stream got after it started (before the next send).
    const fromStart: number[] = [];
    const fromCommit: number[] = [];
    const lastMember: number[] = [];
    let missed = 0;
    sends.forEach((s, k) => {
      const until = sends[k + 1]?.start ?? Infinity;
      let worst = 0;
      for (const p of passive) {
        const e = p.changes.find((t) => t >= s.start && t < until);
        if (e === undefined) {
          missed++;
          continue;
        }
        fromStart.push(e - s.start);
        fromCommit.push(Math.max(0, e - s.end));
        worst = Math.max(worst, e - s.start);
      }
      lastMember.push(worst);
    });
    const f = sorted(fromStart);
    const c = sorted(fromCommit);
    const l = sorted(lastMember);
    await done([
      `fan-out over ${sends.length} sends × ${passive.length} members (${streams.length} streams open${background ? `, ${bgSent} background messages` : ''}):`,
      `  send started → member's stream got the change: p50 ${pct(f, 50).toFixed(0)} ms, p95 ${pct(f, 95).toFixed(0)} ms, p99 ${pct(f, 99).toFixed(0)} ms, max ${(f.at(-1) ?? 0).toFixed(0)} ms`,
      `  send answered → member got it: p50 ${pct(c, 50).toFixed(0)} ms, p95 ${pct(c, 95).toFixed(0)} ms, p99 ${pct(c, 99).toFixed(0)} ms (0 = before the sender read its answer)`,
      `  last of the ${passive.length} members, per send: p50 ${pct(l, 50).toFixed(0)} ms, max ${(l.at(-1) ?? 0).toFixed(0)} ms; missed: ${missed}`,
    ]);
  }
  await probe('M2b. Fan-out on a quiet system: HR sends 30 messages to the 200-person group', false);
  await probe(`M2c. Fan-out with background senders (${BG_RATE} a second in other cities)`, true);
  for (const s of streams) s.close();
  streams.length = 0;
}

// ------------------------------------------------------------------ Surveys
if (ONLY !== 'messaging') {
  const P = comms.pulse;
  const hr = { sub: P.sub, tenantId: P.tenantId, userId: P.hr, roles: ['HR_ADMIN'] };
  const s1 = scenario(`S1. HR sends an organization-wide pulse to ${P.workers.length} people`);
  const questions = [
    ...['I feel safe at work.', 'I have what I need to do my job well.', 'My schedule works for my life.', 'My supervisor listens to me.', 'I’d recommend working here.'].map((t) => ({ type: 'RATING', text: t, required: true })),
    { type: 'CHOICE', text: 'How many shifts a week would you like?', options: ['1–2', '3–4', '5 or more'], required: true },
    { type: 'MULTI', text: 'What would help most?', options: ['More notice of shifts', 'Training', 'Equipment', 'Breaks'], required: false },
    { type: 'TEXT', text: 'Anything else?', required: false },
  ];
  const draft = await call<{ id: string }>('POST /surveys (draft)', hr, 'POST', '/api/surveys', { kind: 'PULSE', title: `Load pulse ${new Date().toISOString()}`, questions, closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), breakdown: 'DEPARTMENT' }, true);
  const id = draft.json!.id;
  const pub = await call<{ invited: number }>(`POST /surveys/:id/publish (${P.workers.length} people)`, hr, 'POST', `/api/surveys/${id}/publish`, undefined, true);
  await s1([`invited: ${pub.json?.invited ?? `failed (${pub.status})`}`]);

  const n = Math.min(P.workers.length, ANSWER_RATE * ANSWER_SECONDS);
  const s2 = scenario(`S2. Answer burst: ${ANSWER_RATE} a second (${ANSWER_RATE * 60} a minute) for ${Math.round(n / ANSWER_RATE)} s`);
  const respondents = P.workers.slice().sort(() => Math.random() - 0.5).slice(0, n);
  let answered = 0;
  await Promise.all(respondents.map(async (userId, k) => {
    await sleep((k / ANSWER_RATE) * 1000);
    const who = { sub: P.sub, tenantId: P.tenantId, userId };
    const mine = await call<Array<{ id: string; questions: Array<{ id: string; type: string; options?: string[] }> }>>('GET /me/surveys', who, 'GET', '/api/me/surveys', undefined, true);
    const s = mine.json?.find((x) => x.id === id);
    if (!s) return;
    const answers = Object.fromEntries(s.questions.map((q) => [q.id, q.type === 'RATING' ? 1 + Math.floor(Math.random() * 5) : q.type === 'CHOICE' ? q.options![Math.floor(Math.random() * q.options!.length)] : q.type === 'MULTI' ? q.options!.filter(() => Math.random() < 0.4) : Math.random() < 0.2 ? text() : '']));
    const r = await call('POST /me/surveys/:id/answers', who, 'POST', `/api/me/surveys/${id}/answers`, { answers });
    if (r.status === 201) answered++;
  }));
  await s2([`answers stored: ${answered} of ${n}`]);

  const s3 = scenario('S3. Close, results with the department breakdown, CSV');
  await call('POST /surveys/:id/close', hr, 'POST', `/api/surveys/${id}/close`);
  const res = await call<{ total: number; breakdown?: { groups: unknown[]; hidden: number } }>('GET /surveys/:id/results (alone)', hr, 'GET', `/api/surveys/${id}/results`, undefined, true);
  for (let k = 0; k < 4; k++) await call('GET /surveys/:id/results (alone)', hr, 'GET', `/api/surveys/${id}/results`);
  await Promise.all(Array.from({ length: 5 }, () => call('GET /surveys/:id/results (5 at once)', hr, 'GET', `/api/surveys/${id}/results`)));
  for (let k = 0; k < 3; k++) await call('GET /surveys/:id/results.csv', hr, 'GET', `/api/surveys/${id}/results.csv`);
  await call('GET /surveys (list)', hr, 'GET', '/api/surveys');
  await s3([`results: ${res.json?.total ?? '?'} responses, ${res.json?.breakdown?.groups.length ?? 0} departments shown, ${res.json?.breakdown?.hidden ?? 0} responses in no group shown`]);
}
await owner.$disconnect();
process.exit(0);
