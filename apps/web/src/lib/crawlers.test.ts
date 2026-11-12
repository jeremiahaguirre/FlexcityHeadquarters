import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_CRAWLER_AGENTS, DEMO_ROBOTS_TXT, PRIVATE_ROBOTS, PUBLIC_ROBOTS, appRobotsTxt } from './crawlers';

const WEB = resolve(__dirname, '../..');
const REPO = resolve(WEB, '../..');

/** robots.txt groups: agents → rules. */
function groups(txt: string) {
  const out: Array<{ agents: string[]; rules: string[] }> = [];
  for (const block of txt.trim().split(/\n\n+/)) {
    const lines = block.split('\n');
    const agents = lines.filter((l) => l.startsWith('User-agent: ')).map((l) => l.slice(12));
    if (agents.length) out.push({ agents, rules: lines.filter((l) => !l.startsWith('User-agent: ')) });
  }
  return out;
}

describe('app robots.txt', () => {
  const txt = appRobotsTxt('https://kelowna.example.ca');
  it('search engines may read only job postings and sign-up', () => {
    const star = groups(txt).find((g) => g.agents.includes('*'))!;
    expect(star.rules).toEqual(['Allow: /jobs', 'Allow: /signup', 'Allow: /_next/static/', 'Allow: /api/public/logo', 'Disallow: /']);
  });
  it('AI crawlers get nothing, job postings included', () => {
    const ai = groups(txt).find((g) => g.agents.includes('GPTBot'))!;
    expect(ai.rules).toEqual(['Disallow: /']);
    for (const bot of ['ClaudeBot', 'CCBot', 'Google-Extended', 'PerplexityBot', 'ChatGPT-User', 'Bytespider']) expect(ai.agents).toContain(bot);
    expect(ai.agents).toEqual([...AI_CRAWLER_AGENTS]);
  });
  it('names the sitemap only when the address is known', () => {
    expect(txt).toContain('Sitemap: https://kelowna.example.ca/sitemap.xml');
    expect(appRobotsTxt(null)).not.toContain('Sitemap');
  });
  it('the demo disallows everything', () => {
    expect(DEMO_ROBOTS_TXT).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('noindex everywhere but the public pages', () => {
  it('private pages: noindex and no AI use', () => {
    for (const d of ['noindex', 'nofollow', 'noarchive', 'nosnippet', 'noimageindex', 'noai', 'noimageai']) expect(PRIVATE_ROBOTS).toContain(d);
    expect(PUBLIC_ROBOTS).toBe('index, follow, noai, noimageai');
  });
  it('next.config.mjs sends the same X-Robots-Tag values (it cannot import TypeScript)', () => {
    const cfg = readFileSync(join(WEB, 'next.config.mjs'), 'utf8');
    expect(cfg).toContain(`const PRIVATE_ROBOTS = '${PRIVATE_ROBOTS}'`);
    expect(cfg).toContain(`const PUBLIC_ROBOTS = '${PUBLIC_ROBOTS}'`);
  });
  it('the AI crawler list is the website’s, unchanged', () => {
    const site = readFileSync(join(REPO, 'apps/site/src/lib/aiCrawlers.json'), 'utf8');
    expect(JSON.parse(readFileSync(join(WEB, 'src/lib/aiCrawlers.json'), 'utf8'))).toEqual(JSON.parse(site));
  });
});
