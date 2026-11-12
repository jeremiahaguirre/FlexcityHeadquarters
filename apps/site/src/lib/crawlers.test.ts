import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import robots from '../app/robots';
import { AI_ASSISTANT_CRAWLERS, AI_TRAINING_CRAWLERS, ALLOW_AI_ASSISTANTS, SITE_ROBOTS, blockedAgents, robotsFor } from './crawlers';

const SITE = resolve(__dirname, '../..');
type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const rules = (r: ReturnType<typeof robots>) => (Array.isArray(r.rules) ? r.rules : [r.rules]) as Rule[];
const agentsOf = (rule: Rule) => [rule.userAgent ?? []].flat();

describe('robots.txt', () => {
  it('lets ordinary search engines index everything', () => {
    const star = rules(robots()).find((r) => agentsOf(r).includes('*'))!;
    expect(star.allow).toBe('/');
    expect(star.disallow).toBeUndefined();
    for (const engine of ['Googlebot', 'Bingbot', 'DuckDuckBot', 'Applebot', 'YandexBot']) expect(blockedAgents().map((a) => a.toLowerCase())).not.toContain(engine.toLowerCase());
  });

  it('keeps AI training crawlers out of the whole site', () => {
    const blocked = rules(robots()).find((r) => r.disallow === '/')!;
    for (const bot of ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'meta-externalagent', 'cohere-ai', 'Diffbot', 'img2dataset']) expect(agentsOf(blocked)).toContain(bot);
    expect(agentsOf(blocked)).toEqual(expect.arrayContaining([...AI_TRAINING_CRAWLERS]));
  });

  it('blocks AI search and assistants by default, and the switch lets only them back in', () => {
    expect(ALLOW_AI_ASSISTANTS).toBe(false);
    expect(blockedAgents()).toEqual(expect.arrayContaining(['ChatGPT-User', 'OAI-SearchBot', 'PerplexityBot', 'Perplexity-User', 'Claude-SearchBot', 'Claude-User', 'DuckAssistBot', 'MistralAI-User']));
    const open = agentsOf(rules(robotsFor(true)).find((r) => r.disallow === '/')!);
    expect(open).toEqual([...AI_TRAINING_CRAWLERS]);
    for (const a of AI_ASSISTANT_CRAWLERS) expect(open).not.toContain(a);
  });

  it('names each agent once (the firewall rule is built from the same list)', () => {
    const all = [...AI_TRAINING_CRAWLERS, ...AI_ASSISTANT_CRAWLERS];
    expect(new Set(all.map((a) => a.toLowerCase())).size).toBe(all.length);
    // AWS WAF regex patterns are built from these: plain names only.
    for (const a of all) expect(a).toMatch(/^[A-Za-z0-9][A-Za-z0-9 -]*$/);
  });

  it('points at the sitemap', () => {
    expect(robots().sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe('AI training opt-out signals', () => {
  it('TDMRep: the whole site is reserved', () => {
    expect(JSON.parse(readFileSync(join(SITE, 'public/.well-known/tdmrep.json'), 'utf8'))).toEqual([{ location: '/', 'tdm-reservation': 1 }]);
  });

  it('Vercel sends tdm-reservation and noai, without noindex', () => {
    const v = JSON.parse(readFileSync(join(SITE, 'vercel.json'), 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
    const all = v.headers.find((h) => h.source === '/(.*)')!.headers;
    const get = (k: string) => all.find((h) => h.key.toLowerCase() === k)?.value;
    expect(get('tdm-reservation')).toBe('1');
    expect(get('x-robots-tag')).toBe('noai, noimageai');
    expect(get('x-robots-tag')).not.toMatch(/noindex|nofollow/);
    expect(get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('page meta keeps the site indexable', () => {
    expect(SITE_ROBOTS).toMatch(/^index, follow/);
    expect(SITE_ROBOTS).toContain('noai');
    expect(SITE_ROBOTS).not.toMatch(/noindex|nofollow/);
  });
});
