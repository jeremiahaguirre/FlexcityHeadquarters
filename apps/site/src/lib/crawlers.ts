import type { MetadataRoute } from 'next';
import AI_CRAWLERS from './aiCrawlers.json';
import { SITE_URL } from './seo';

/**
 * AI search engines and assistants that fetch pages to answer people (ChatGPT search, Perplexity, Claude,
 * DuckDuckGo's assistant…). Blocked by default; set to true to let them read the site (and cite it) while
 * training crawlers stay blocked. The same list (src/lib/aiCrawlers.json) feeds the AWS firewall rule
 * (ops/terraform/edge.tf, variable waf_block_ai_assistants) and the app's robots.txt.
 */
export const ALLOW_AI_ASSISTANTS = false;

/** Every page's robots meta tag: indexed and followed; no AI training on text or images (TDM opt-out). */
export const SITE_ROBOTS = 'index, follow, noai, noimageai';

/** Crawlers that collect pages to train AI models. Always blocked. */
export const AI_TRAINING_CRAWLERS: readonly string[] = AI_CRAWLERS.training;
/** AI search / assistants: fetch pages to answer a person's question. Blocked unless ALLOW_AI_ASSISTANTS. */
export const AI_ASSISTANT_CRAWLERS: readonly string[] = AI_CRAWLERS.assistants;

/** User agents told to stay away from the whole site. */
export function blockedAgents(allowAssistants = ALLOW_AI_ASSISTANTS): string[] {
  return [...AI_TRAINING_CRAWLERS, ...(allowAssistants ? [] : AI_ASSISTANT_CRAWLERS)];
}

/**
 * Ordinary search engines (Googlebot, Bingbot, DuckDuckBot, Applebot, Yandex…) fall under "*" and may index
 * everything. AI crawlers each get "Disallow: /". robots.txt is a request, not a lock: the firewall enforces it
 * where the site runs on AWS, and Vercel's AI-bot rules where it runs on Vercel (README, Deployment).
 */
export function robotsFor(allowAssistants = ALLOW_AI_ASSISTANTS): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }, { userAgent: blockedAgents(allowAssistants), disallow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
