import { describe, expect, it } from 'vitest';
import { type OrgPerson, buildTree, filterTree, fold, withTeams } from './orgChart';

const p = (id: string, name: string, managerId: string | null = null): OrgPerson => ({ id, name, managerId, positions: [], departments: [], source: managerId ? 'set' : null, directReports: 0 });
const people = [p('ceo', 'Zoé Lavoie'), p('a', 'Ana Ruiz', 'ceo'), p('b', 'Ben Cho', 'ceo'), p('a1', 'Hélène Roy', 'a'), p('a2', 'Ivan Petrov', 'a'), p('solo', 'Sam Solo'), p('x', 'Xi Wu', 'gone')];

describe('org chart tree', () => {
  it('nests people under their manager, biggest branch first, names in order', () => {
    const { roots, unplaced } = buildTree(people);
    expect(roots.map((r) => r.person.id)).toEqual(['ceo']);
    expect(roots[0]!.size).toBe(4);
    expect(roots[0]!.children.map((c) => c.person.id)).toEqual(['a', 'b']);
    expect(roots[0]!.children[0]!.children.map((c) => c.person.id)).toEqual(['a1', 'a2']);
    // Nobody above or below them (or a manager outside the view): listed apart.
    expect(unplaced.map((u) => u.id)).toEqual(['solo', 'x']);
  });

  it('search keeps the path to each match and opens it, ignoring accents', () => {
    const { roots } = buildTree(people);
    const r = filterTree(roots, 'helene', (x) => x.name);
    expect(r.matches).toBe(1);
    expect([...r.open].sort()).toEqual(['a', 'ceo']);
    expect(r.roots[0]!.children.map((c) => c.person.id)).toEqual(['a']);
    expect(r.roots[0]!.children[0]!.children.map((c) => c.person.id)).toEqual(['a1']);
    // A matching manager keeps their whole team.
    expect(filterTree(roots, 'ana', (x) => x.name).roots[0]!.children[0]!.children).toHaveLength(2);
    expect(filterTree(roots, 'nobody', (x) => x.name).roots).toEqual([]);
    expect(filterTree(roots, '  ', (x) => x.name).roots).toBe(roots);
  });

  it('expand all opens everyone with a team', () => {
    expect(withTeams(buildTree(people).roots).sort()).toEqual(['a', 'ceo']);
    expect(fold('Éric')).toBe('eric');
  });

  it('survives a loop in the data', () => {
    const { roots, unplaced } = buildTree([p('a', 'A', 'b'), p('b', 'B', 'a'), p('c', 'C')]);
    expect(roots.map((r) => r.person.id)).toEqual(['a']);
    expect(roots[0]!.children.map((c) => c.person.id)).toEqual(['b']);
    expect(roots[0]!.children[0]!.children).toEqual([]);
    expect(unplaced.map((u) => u.id)).toEqual(['c']);
  });
});
