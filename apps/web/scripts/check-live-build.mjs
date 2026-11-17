#!/usr/bin/env node
// A live (production) build carries none of the demo (ARCHITECTURE-REVIEW A15): not the demo
// password, the sample organization and its logo, the recorded sample data, the demo's request
// handlers, or the API code the demo borrows. Run after `next build`:
//   node scripts/check-live-build.mjs [.next]
// The locale files' demo strings (the banner, "sign in as guard@demo.flexcity") are ordinary text
// in both dictionaries and are not checked here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.next';
const FORBIDDEN = {
  'the demo password': 'flexcity-dev',
  'the sample organization': 'City of Lakeview (demo)',
  'the sample organization logo': 'iVBORw0KGgoAAAANSUhEUgAAAWgAAADI',
  'the recorded sample data': 'demo-fixtures/',
  "the demo's request handlers": 'demoPlatformFile',
  'the API code the demo borrows': 'previewImport',
};

function files(d) {
  return readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) return f === 'cache' ? [] : files(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

const all = files(dir);
const problems = [];
for (const f of all) {
  const text = readFileSync(f, 'utf8');
  for (const [what, needle] of Object.entries(FORBIDDEN)) if (text.includes(needle)) problems.push(`${f}: ${what} ("${needle}")`);
}
if (!all.length) {
  console.error(`No JavaScript under ${dir}: build first.`);
  process.exit(1);
}
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\nThe live build contains demo code or data (${problems.length}). See next.config.mjs and src/lib/stubs/demoApi.ts.`);
  process.exit(1);
}
console.log(`${all.length} files in the live build: no demo password, sample data, handlers or borrowed API code.`);
