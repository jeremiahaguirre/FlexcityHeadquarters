/**
 * SQL injection guard: fails if any source file builds SQL text out of values.
 * See src/lib/sqlIdent.ts for the rules.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ident, qualified } from '../../src/lib/sqlIdent.js';

const ROOTS = ['src', 'scripts', 'prisma'].map((d) => join(__dirname, '../..', d));
function files(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== 'migrations') out = out.concat(files(p));
    } else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = ROOTS.flatMap(files).map((p) => ({ file: relative(join(__dirname, '../..'), p), text: readFileSync(p, 'utf8') }));

/** The template literal starting at `start` (a backtick), with its `${…}` expressions. */
function templateAt(text: string, start: number): { body: string; exprs: string[] } {
  const exprs: string[] = [];
  let i = start + 1;
  let body = '';
  while (i < text.length && text[i] !== '`') {
    if (text[i] === '\\') {
      body += text.slice(i, i + 2);
      i += 2;
    } else if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      exprs.push(text.slice(i + 2, j - 1).trim());
      body += '${}';
      i = j;
    } else body += text[i++];
  }
  return { body, exprs };
}
const safeIdent = (e: string) => /^(ident|qualified)\(/.test(e);

describe('SQL injection guard', () => {
  it('raw Prisma queries are tagged templates (values become bound parameters)', () => {
    const bad: string[] = [];
    for (const s of sources) {
      for (const m of s.text.matchAll(/\$(queryRaw|executeRaw)(<[^>(]*>)?\(/g)) bad.push(`${s.file}: ${m[0]} called as a function: use it as a tagged template`);
      for (const m of s.text.matchAll(/Prisma\.raw\(/g)) bad.push(`${s.file}: ${m[0]} splices text into SQL`);
    }
    expect(bad).toEqual([]);
  });

  it('“unsafe” raw queries and pg queries splice in only checked identifiers, never values', () => {
    const bad: string[] = [];
    for (const s of sources) {
      for (const m of s.text.matchAll(/(\$queryRawUnsafe|\$executeRawUnsafe|\.query)(<[^>(]*>)?\(\s*/g)) {
        const at = m.index! + m[0].length;
        const ch = s.text[at];
        const line = s.text.slice(0, at).split('\n').length;
        // A reviewed exception says why on the line above: "// sql-safety: trusted — <reason>".
        if (/sql-safety: trusted — \S/.test(s.text.split('\n')[line - 2] ?? '')) continue;
        if (ch === '`') {
          const t = templateAt(s.text, at);
          for (const e of t.exprs) if (!safeIdent(e)) bad.push(`${s.file}:${line}: \${${e}} in SQL: pass values as $1 parameters, identifiers through ident()`);
          const after = s.text.slice(at).replace(/^`(?:\\.|\$\{[^}]*\}|[^`\\])*`/s, '').trimStart();
          if (after.startsWith('+')) bad.push(`${s.file}:${line}: SQL built by concatenation`);
        } else if (ch === "'" || ch === '"') {
          const rest = s.text.slice(at + 1);
          const end = rest.indexOf(ch);
          if (rest.slice(end + 1).trimStart().startsWith('+')) bad.push(`${s.file}:${line}: SQL built by concatenation`);
        } else if (m[1] !== '.query') {
          bad.push(`${s.file}:${line}: ${m[1]} with SQL that isn't a literal`);
        } else if (/^[A-Za-z_]/.test(ch ?? '') && /\b(sql|text|statement|query)\b/i.test(s.text.slice(at, at + 20))) {
          bad.push(`${s.file}:${line}: pg query with SQL from a variable`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('identifiers are plain names, quoted; anything else is refused', () => {
    expect(ident('TimePunch')).toBe('"TimePunch"');
    expect(qualified('union_hub', 'local')).toBe('"union_hub"."local"');
    for (const nasty of ['a"; DROP TABLE "User"; --', 'x y', '', '1abc', 'tenant-id', "a'b", 'a'.repeat(64)]) expect(() => ident(nasty)).toThrow(/unsafe SQL identifier/);
  });

  it('the guard itself catches the patterns it looks for', () => {
    const t = templateAt('`SELECT * FROM x WHERE id = ${req.query.id} AND t = ${ident(t)}`', 0);
    expect(t.exprs).toEqual(['req.query.id', 'ident(t)']);
    expect(t.exprs.map(safeIdent)).toEqual([false, true]);
  });
});
