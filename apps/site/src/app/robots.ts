import type { MetadataRoute } from 'next';
import { robotsFor } from '../lib/crawlers';

export const dynamic = 'force-static';

/** Search engines welcome; AI training crawlers (and, by default, AI assistants) not: src/lib/crawlers.ts. */
export default function robots(): MetadataRoute.Robots {
  return robotsFor();
}
