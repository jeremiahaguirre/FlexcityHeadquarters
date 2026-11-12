import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Tests run through esbuild, production through tsc. A constructor with parameter properties
// (`constructor(readonly x: T)`) whose super() is not a plain top-level statement compiles, under
// tsc, to `this.x = x` BEFORE super(): a ReferenceError at run time that only the production build
// shows (the production rehearsal found one: every messaging refusal answered 500).
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'generated') return []; // Prisma's generated client, not our code
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('build safety', () => {
  it('no derived-class constructor mixes parameter properties with a nested super() call', () => {
    const bad: string[] = [];
    for (const file of files(join(__dirname, '../../src'))) {
      const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
      const visit = (n: ts.Node) => {
        if (ts.isConstructorDeclaration(n) && n.body && n.parameters.some((p) => ts.getModifiers(p)?.length)) {
          const topLevelSuper = n.body.statements.some((s) => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && s.expression.expression.kind === ts.SyntaxKind.SuperKeyword);
          const anySuper = n.body.getText().includes('super(');
          if (anySuper && !topLevelSuper) bad.push(`${file}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(src);
    }
    expect(bad).toEqual([]);
  });
});
