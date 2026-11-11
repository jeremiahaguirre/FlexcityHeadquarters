import { describe, expect, it } from 'vitest';
import { buildGraph, treeParents } from '../../src/services/people/reporting.js';

const person = (id: string, reportsToId: string | null = null, departmentIds: string[] = [], active = true) => ({ id, reportsToId, departmentIds, active });

describe('reporting graph', () => {
  const g = () =>
    buildGraph(
      [person('boss'), person('mgr', null, ['pool']), person('co', null, ['pool']), person('guard', null, ['pool']), person('set', 'boss', ['pool']), person('left', null, [], false), person('orphan', 'left', ['pool'])],
      [
        { departmentId: 'pool', userId: 'mgr' },
        { departmentId: 'pool', userId: 'co' },
      ],
    );

  it('uses the manager set on the record, else the department’s managers', () => {
    const x = g();
    expect([x.managers('set'), x.source('set')]).toEqual([['boss'], 'set']);
    expect([x.managers('guard'), x.source('guard')]).toEqual([['mgr', 'co'], 'department']);
    expect(x.parent('guard')).toBe('mgr');
  });

  it('co-managers of a department don’t default to each other; someone who left manages no one', () => {
    const x = g();
    expect(x.managers('mgr')).toEqual([]);
    expect(x.source('mgr')).toBeNull();
    expect(x.managers('orphan')).toEqual(['mgr', 'co']);
    expect(x.reports('left')).toEqual([]);
    expect(x.reports('mgr').sort()).toEqual(['guard', 'orphan']);
  });

  it('knows who is below whom, through set and default lines', () => {
    const x = g();
    x.setManager('mgr', 'boss');
    expect(x.isBelow('guard', 'boss')).toBe(true);
    expect(x.isBelow('boss', 'guard')).toBe(false);
    x.setManager('boss', 'guard'); // would loop: guard → mgr → boss → guard
    expect(x.isBelow('guard', 'guard')).toBe(true);
  });
});

describe('tree parents', () => {
  it('keeps links inside the set and breaks loops', () => {
    const parent: Record<string, string | null> = { a: 'b', b: 'c', c: 'a', d: 'a', e: 'outside', f: 'f' };
    const t = treeParents(['a', 'b', 'c', 'd', 'e', 'f'], (id) => parent[id] ?? null);
    expect(t.get('e')).toBeNull();
    expect(t.get('f')).toBeNull();
    expect(t.get('d')).toBe('a');
    // Exactly one of the a/b/c loop becomes a root.
    expect(['a', 'b', 'c'].filter((id) => t.get(id) === null)).toHaveLength(1);
  });
});
