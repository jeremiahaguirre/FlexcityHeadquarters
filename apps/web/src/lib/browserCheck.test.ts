import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { BROWSER_CHECK_SCRIPT, OLD_BROWSER_ATTR, OLD_BROWSER_CSS } from './browserCheck';

/** A browser as the check sees it: what CSS.supports accepts and whether RegExp knows lookbehind. */
interface Fake {
  lookbehind?: boolean;
  trig?: boolean;
  containers?: boolean;
  css?: 'missing' | 'throws';
  path?: string;
}

/** Runs the check against a fake browser; returns the attribute it set on <html> (null: none). */
function run(b: Fake = {}): string | null {
  const attrs: Record<string, string> = {};
  const supports = (prop: string, value: string) => {
    if (b.css === 'throws') throw new Error('boom');
    if (value.includes('sin(')) return b.trig ?? true;
    if (prop === 'container-type') return b.containers ?? true;
    return false;
  };
  const window = { CSS: b.css === 'missing' ? undefined : { supports } };
  const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
  const FakeRegExp = function (pattern: string) {
    if (pattern.includes('(?<') && !(b.lookbehind ?? true)) throw new SyntaxError('Invalid regular expression: invalid group specifier name');
    return new RegExp(pattern);
  };
  new Function('window', 'document', 'location', 'RegExp', BROWSER_CHECK_SCRIPT)(window, document, { pathname: b.path ?? '/login/' }, FakeRegExp);
  return attrs[OLD_BROWSER_ATTR] ?? null;
}

/** ES5 only: compiling to ES5 changes nothing that compiling to the newest version keeps. */
const isEs5 = (src: string) => {
  const out = (target: ts.ScriptTarget) => ts.transpileModule(src, { compilerOptions: { target, module: ts.ModuleKind.None, removeComments: true } }).outputText;
  return out(ts.ScriptTarget.ES5) === out(ts.ScriptTarget.ESNext);
};

describe('browser check', () => {
  it('leaves supported browsers alone (Chrome/Edge/Firefox 111+, Safari 16.4+)', () => {
    expect(run()).toBeNull();
  });

  it('marks Safari and iOS before 16.4 (no RegExp lookbehind)', () => {
    expect(run({ lookbehind: false })).toBe('');
  });

  it('marks Chrome and Edge before 111 (no CSS sin())', () => {
    expect(run({ trig: false })).toBe('');
  });

  it('marks Firefox before 110 (no CSS container queries)', () => {
    expect(run({ containers: false })).toBe('');
  });

  it('marks browsers without CSS.supports', () => {
    expect(run({ css: 'missing' })).toBe('');
  });

  it('never raises a false alarm when a check throws for another reason', () => {
    expect(run({ css: 'throws' })).toBeNull();
  });

  it('says "kiosk" on the facility kiosk, live and in the demo under its base path', () => {
    expect(run({ trig: false, path: '/kiosk' })).toBe('kiosk');
    expect(run({ trig: false, path: '/kiosk/' })).toBe('kiosk');
    expect(run({ lookbehind: false, path: '/FlexcityHeadquarters/kiosk/' })).toBe('kiosk');
    // Supervisors' kiosk settings are not the kiosk itself.
    expect(run({ trig: false, path: '/manage/kiosks/' })).toBe('');
    expect(run({ path: '/kiosk/' })).toBeNull();
  });

  it('is plain ES5 that old browsers can parse, with no eval', () => {
    expect(isEs5('var a = function () { return 1 }; a();')).toBe(true);
    expect(isEs5('const a = () => 1; a();')).toBe(false); // the comparison does catch newer syntax
    expect(isEs5(BROWSER_CHECK_SCRIPT)).toBe(true);
    expect(BROWSER_CHECK_SCRIPT).not.toMatch(/\beval\b|Function\(|setTimeout\(['"]/);
  });

  it('hides the notice by default and everything else when the page is marked', () => {
    expect(OLD_BROWSER_CSS).toContain('#fh-old-browser{display:none}');
    expect(OLD_BROWSER_CSS).toContain(`html[${OLD_BROWSER_ATTR}] body>*{display:none!important}`);
    expect(OLD_BROWSER_CSS).toContain(`html[${OLD_BROWSER_ATTR}] body>#fh-old-browser{display:block!important}`);
    expect(OLD_BROWSER_CSS).toContain(`html[${OLD_BROWSER_ATTR}=kiosk] #fh-old-browser .fh-ob-kiosk{display:block}`);
  });
});
