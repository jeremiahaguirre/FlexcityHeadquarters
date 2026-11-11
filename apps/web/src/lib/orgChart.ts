/** The org chart as a tree, from the flat list GET /api/org-chart returns. */

export interface Named { id: string; name: string; nameFr: string | null }
export interface OrgPerson {
  id: string;
  name: string;
  positions: Named[];
  departments: Named[];
  /** Their manager in this view (null: they start a branch). */
  managerId: string | null;
  /** set: chosen on their record · department: their department's manager, by default. */
  source: 'set' | 'department' | null;
  directReports: number;
}
export interface OrgNode { person: OrgPerson; children: OrgNode[]; /** Everyone below, at any depth. */ size: number }

const byName = (a: OrgNode, b: OrgNode) => a.person.name.localeCompare(b.person.name);

/**
 * Builds the branches. People with nobody above or below them aren't a branch:
 * they come back separately as `unplaced`, so the chart isn't a long list of single cards.
 */
export function buildTree(people: OrgPerson[]): { roots: OrgNode[]; unplaced: OrgPerson[] } {
  const nodes = new Map(people.map((p) => [p.id, { person: p, children: [] as OrgNode[], size: 0 }]));
  const roots: OrgNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.person.managerId ? nodes.get(n.person.managerId) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else roots.push(n);
  }
  // A loop has no top: cut it at its first person so everyone still shows, exactly once.
  const reached = new Set<string>();
  const reach = (n: OrgNode) => {
    if (reached.has(n.person.id)) return;
    reached.add(n.person.id);
    n.children.forEach(reach);
  };
  roots.forEach(reach);
  for (const n of nodes.values()) {
    if (reached.has(n.person.id)) continue;
    const parent = nodes.get(n.person.managerId!)!;
    parent.children = parent.children.filter((c) => c !== n);
    roots.push(n);
    reach(n);
  }
  const size = (n: OrgNode, seen: Set<string>): number => {
    if (seen.has(n.person.id)) return 0; // the API breaks loops; never trust that blindly
    seen.add(n.person.id);
    n.children.sort(byName);
    n.size = n.children.reduce((s, c) => s + 1 + size(c, seen), 0);
    return n.size;
  };
  const seen = new Set<string>();
  for (const r of roots) size(r, seen);
  const branches = roots.filter((r) => r.children.length).sort((a, b) => b.size - a.size || byName(a, b));
  const unplaced = roots.filter((r) => !r.children.length).map((r) => r.person).sort((a, b) => a.name.localeCompare(b.name));
  return { roots: branches, unplaced };
}

/** Normalized for search: case and accents don't matter (Hélène = helene). */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Only the branches leading to people who match: matches keep their whole team, and
 * their managers stay so you can see where they sit. Returns the ids to open.
 */
export function filterTree(roots: OrgNode[], query: string, text: (p: OrgPerson) => string): { roots: OrgNode[]; open: Set<string>; matches: number } {
  const q = fold(query.trim());
  if (!q) return { roots, open: new Set(), matches: 0 };
  const open = new Set<string>();
  let matches = 0;
  const walk = (n: OrgNode): OrgNode | null => {
    if (fold(text(n.person)).includes(q)) {
      matches++;
      return n;
    }
    const kids = n.children.map(walk).filter((c): c is OrgNode => !!c);
    if (!kids.length) return null;
    open.add(n.person.id);
    return { ...n, children: kids };
  };
  return { roots: roots.map(walk).filter((r): r is OrgNode => !!r), open, matches };
}

/** Ids of everyone in these branches who has a team (for "Expand all"). */
export function withTeams(roots: OrgNode[]): string[] {
  const out: string[] = [];
  const walk = (n: OrgNode) => {
    if (n.children.length) out.push(n.person.id);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}
