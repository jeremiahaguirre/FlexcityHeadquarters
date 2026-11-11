/**
 * Survey questions and results: pure rules, no database.
 *
 * Anonymity (surveys.ts keeps who answered apart from the answers; this file decides what can be shown):
 *  - Nothing is shown for fewer than `minGroup` responses (default 5; an organization can raise it,
 *    never below 3).
 *  - Breakdowns by department or position hide every group under minGroup, and then enough of the
 *    next smallest groups that the hidden ones add up to minGroup too: otherwise the whole minus the
 *    groups shown would reveal the small one ("complementary suppression").
 *  - Written answers are shown only when the whole survey reaches minGroup, never in breakdowns,
 *    sorted alphabetically (no order that follows when people answered), with a warning that
 *    writing style can identify people.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const QUESTION_TYPES = ['RATING', 'CHOICE', 'MULTI', 'TEXT'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export interface Question { id: string; type: QuestionType; text: string; options?: string[]; required: boolean }
export type Answer = number | string | string[];
export type Answers = Record<string, Answer>;

export const MIN_GROUP_FLOOR = 3;
export const MIN_GROUP_DEFAULT = 5;
export const MIN_GROUP_CEILING = 50;
export const TEXT_MAX = 1000;

export const questionInput = z
  .object({
    id: z.string().regex(/^[a-z0-9]{4,16}$/).optional(),
    type: z.enum(QUESTION_TYPES),
    text: z.string().trim().min(3).max(300),
    options: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    required: z.boolean().default(true),
  })
  .superRefine((q, ctx) => {
    const choice = q.type === 'CHOICE' || q.type === 'MULTI';
    if (choice && (!q.options || q.options.length < 2)) ctx.addIssue({ code: 'custom', message: 'A choice question needs at least two options.', path: ['options'] });
    if (choice && q.options && new Set(q.options).size !== q.options.length) ctx.addIssue({ code: 'custom', message: 'Options must differ.', path: ['options'] });
  });

/** Gives each question a stable id and drops options from questions that don't use them. */
export function normalizeQuestions(input: Array<z.infer<typeof questionInput>>): Question[] {
  const seen = new Set<string>();
  return input.map((q) => {
    let id = q.id && !seen.has(q.id) ? q.id : randomBytes(4).toString('hex');
    while (seen.has(id)) id = randomBytes(4).toString('hex');
    seen.add(id);
    return { id, type: q.type, text: q.text, required: q.required, ...(q.type === 'CHOICE' || q.type === 'MULTI' ? { options: q.options! } : {}) };
  });
}

/** Checks a set of answers against the questions; returns them cleaned (unknown questions dropped). */
export function validateAnswers(questions: Question[], raw: Record<string, unknown>): { ok: true; answers: Answers } | { ok: false; questionId: string; message: string } {
  const out: Answers = {};
  for (const q of questions) {
    const v = raw[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      if (q.required) return { ok: false, questionId: q.id, message: 'This question needs an answer.' };
      continue;
    }
    if (q.type === 'RATING') {
      if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 5) return { ok: false, questionId: q.id, message: 'Choose 1 to 5.' };
      out[q.id] = v as number;
    } else if (q.type === 'CHOICE') {
      if (typeof v !== 'string' || !q.options!.includes(v)) return { ok: false, questionId: q.id, message: 'Choose one of the options.' };
      out[q.id] = v;
    } else if (q.type === 'MULTI') {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !q.options!.includes(x))) return { ok: false, questionId: q.id, message: 'Choose from the options.' };
      out[q.id] = [...new Set(v as string[])];
    } else {
      if (typeof v !== 'string') return { ok: false, questionId: q.id, message: 'Write an answer.' };
      const s = v.trim().slice(0, TEXT_MAX);
      if (!s && q.required) return { ok: false, questionId: q.id, message: 'This question needs an answer.' };
      if (s) out[q.id] = s;
    }
  }
  return { ok: true, answers: out };
}

export interface QuestionSummary {
  id: string;
  type: QuestionType;
  text: string;
  /** Responses that answered it. */
  answered: number;
  average?: number;
  /** RATING: counts for 1..5; CHOICE / MULTI: counts per option. */
  counts?: Record<string, number>;
  /** TEXT: the answers, alphabetically; only when the survey reaches the minimum group. */
  texts?: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarize(questions: Question[], responses: Array<{ answers: Answers }>, opts: { withText: boolean }): QuestionSummary[] {
  return questions.map((q) => {
    const vals = responses.map((r) => r.answers[q.id]).filter((v) => v !== undefined);
    const base: QuestionSummary = { id: q.id, type: q.type, text: q.text, answered: vals.length };
    if (q.type === 'RATING') {
      const nums = vals as number[];
      const counts: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const n of nums) counts[n] = (counts[n] ?? 0) + 1;
      return { ...base, counts, ...(nums.length ? { average: round1(nums.reduce((a, b) => a + b, 0) / nums.length) } : {}) };
    }
    if (q.type === 'CHOICE' || q.type === 'MULTI') {
      const counts: Record<string, number> = Object.fromEntries(q.options!.map((o) => [o, 0]));
      for (const v of vals) for (const o of [v].flat() as string[]) if (o in counts) counts[o]! += 1;
      return { ...base, counts };
    }
    return opts.withText ? { ...base, texts: (vals as string[]).slice().sort((a, b) => a.localeCompare(b)) } : base;
  });
}

/**
 * Which groups (department, position) are big enough to show. Groups under `min` are hidden, then
 * the smallest shown groups join them until the hidden ones add up to at least `min` (or all are hidden),
 * so no hidden group can be worked out by subtraction. Responses without a group count as hidden.
 */
export function showableGroups(sizes: Map<string | null, number>, min: number): Set<string> {
  const named = [...sizes.entries()].filter((e): e is [string, number] => e[0] !== null && e[1] > 0).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const shown = new Set(named.filter(([, n]) => n >= min).map(([k]) => k));
  let hidden = [...sizes.entries()].filter(([k, n]) => n > 0 && (k === null || !shown.has(k))).reduce((a, [, n]) => a + n, 0);
  for (const [k, n] of named) {
    if (hidden === 0 || hidden >= min) break;
    if (!shown.has(k)) continue;
    shown.delete(k);
    hidden += n;
  }
  return shown;
}

export interface Results {
  total: number;
  minGroup: number;
  /** False: too few responses (or still open, for an anonymous survey): nothing else is given. */
  shown: boolean;
  reason?: 'open' | 'tooFew';
  questions?: QuestionSummary[];
  breakdowns?: { department: Array<{ id: string; responses: number; questions: QuestionSummary[] }>; position: Array<{ id: string; responses: number; questions: QuestionSummary[] }>; hiddenResponses: { department: number; position: number } };
}

/** Everything a results screen may show for an anonymous survey. */
export function anonymousResults(questions: Question[], responses: Array<{ answers: Answers; departmentId: string | null; positionId: string | null }>, minGroup: number, closed: boolean): Results {
  const total = responses.length;
  if (!closed) return { total, minGroup, shown: false, reason: 'open' };
  if (total < minGroup) return { total, minGroup, shown: false, reason: 'tooFew' };
  const by = (key: 'departmentId' | 'positionId') => {
    const sizes = new Map<string | null, number>();
    for (const r of responses) sizes.set(r[key], (sizes.get(r[key]) ?? 0) + 1);
    const ok = showableGroups(sizes, minGroup);
    const groups = [...ok].sort().map((id) => {
      const rs = responses.filter((r) => r[key] === id);
      return { id, responses: rs.length, questions: summarize(questions, rs, { withText: false }) };
    });
    return { groups, hidden: total - groups.reduce((a, g) => a + g.responses, 0) };
  };
  const d = by('departmentId');
  const p = by('positionId');
  return { total, minGroup, shown: true, questions: summarize(questions, responses, { withText: true }), breakdowns: { department: d.groups, position: p.groups, hiddenResponses: { department: d.hidden, position: p.hidden } } };
}

/** The CSV a results screen offers: summaries only for anonymous surveys (never one row per person). */
export function resultsCsv(title: string, r: Results, cell: (s: string) => string): string {
  const rows: string[][] = [['survey', title], ['responses', String(r.total)], ['minimum group', String(r.minGroup)], []];
  if (!r.shown || !r.questions) return [...rows, ['results', r.reason === 'open' ? 'shown once the survey closes' : `hidden: fewer than ${r.minGroup} responses`]].map((x) => x.map(cell).join(',')).join('\r\n') + '\r\n';
  rows.push(['question', 'type', 'answered', 'average', 'answer', 'count']);
  for (const q of r.questions) {
    if (q.counts) for (const [k, n] of Object.entries(q.counts)) rows.push([q.text, q.type, String(q.answered), q.average !== undefined ? String(q.average) : '', k, String(n)]);
    else rows.push([q.text, q.type, String(q.answered), '', '', '']);
  }
  const texts = r.questions.filter((q) => q.texts?.length);
  if (texts.length) {
    rows.push([], ['written answers (alphabetical; writing style can identify people: handle with care)']);
    for (const q of texts) for (const t of q.texts!) rows.push([q.text, t]);
  }
  return rows.map((x) => x.map(cell).join(',')).join('\r\n') + '\r\n';
}
