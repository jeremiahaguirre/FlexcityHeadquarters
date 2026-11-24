import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as app from '../../../web/src/lib/browserCheck';
import { copy } from '../content/copy';
import { BROWSER_CHECK_SCRIPT, OLD_BROWSER_ATTR, OLD_BROWSER_CSS } from './browserCheck';

/** Runs the check against a fake browser; returns the attribute it set on <html> (null: none). */
function run(b: { lookbehind?: boolean; trig?: boolean; containers?: boolean } = {}): string | null {
  const attrs: Record<string, string> = {};
  const supports = (prop: string, value: string) => (value.includes('sin(') ? (b.trig ?? true) : prop === 'container-type' ? (b.containers ?? true) : false);
  const FakeRegExp = function (pattern: string) {
    if (pattern.includes('(?<') && !(b.lookbehind ?? true)) throw new SyntaxError('invalid group specifier name');
    return new RegExp(pattern);
  };
  const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
  new Function('window', 'document', 'location', 'RegExp', BROWSER_CHECK_SCRIPT)({ CSS: { supports } }, document, { pathname: '/en/' }, FakeRegExp);
  return attrs[OLD_BROWSER_ATTR] ?? null;
}

describe('browser check (site)', () => {
  it('is the same check and notice CSS as the app’s', () => {
    expect(BROWSER_CHECK_SCRIPT).toBe(app.BROWSER_CHECK_SCRIPT);
    expect(OLD_BROWSER_CSS).toBe(app.OLD_BROWSER_CSS);
    expect(OLD_BROWSER_ATTR).toBe(app.OLD_BROWSER_ATTR);
  });

  it('passes supported browsers and marks Safari < 16.4, Chrome/Edge < 111 and Firefox < 110', () => {
    expect(run()).toBeNull();
    expect(run({ lookbehind: false })).toBe('');
    expect(run({ trig: false })).toBe('');
    expect(run({ containers: false })).toBe('');
  });

  it('is plain ES5', () => {
    const out = (target: ts.ScriptTarget) => ts.transpileModule(BROWSER_CHECK_SCRIPT, { compilerOptions: { target, module: ts.ModuleKind.None } }).outputText;
    expect(out(ts.ScriptTarget.ES5)).toBe(out(ts.ScriptTarget.ESNext));
  });

  it('keeps the hidden notice out of search snippets (the site is indexed)', () => {
    const src = readFileSync(join(__dirname, '../components/OldBrowser.tsx'), 'utf8');
    expect(src).toMatch(/<div id="fh-old-browser" data-nosnippet=""/);
  });

  it('names the minimum versions in both languages', () => {
    expect(copy('en').oldBrowser.body).toContain('Chrome, Edge or Firefox 111 or newer, or Safari 16.4 or newer');
    expect(copy('fr').oldBrowser.body).toContain('Chrome, Edge ou Firefox 111 ou plus récent, ou Safari 16.4 ou plus récent');
  });
});
