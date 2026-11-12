/** Staff surveys (API: routes/surveys.ts). Shapes the screens use, and the question builder's rules. */
export type QuestionType = 'RATING' | 'CHOICE' | 'MULTI' | 'TEXT';
export interface Question { id: string; type: QuestionType; text: string; options?: string[]; required: boolean }
export type Answer = number | string | string[];

export interface MySurvey { id: string; kind: 'PULSE' | 'EXIT'; from?: 'hr' | 'manager'; title: string; intro: string | null; anonymous: boolean; minGroup: number; closesAt: string; responded: boolean; questions: Question[] }

/** One breakdown per survey: two, each hidden on its own, could be subtracted from each other. */
export type Breakdown = 'NONE' | 'DEPARTMENT' | 'POSITION';
export const BREAKDOWNS: Breakdown[] = ['NONE', 'DEPARTMENT', 'POSITION'];

export interface SurveyRow {
  id: string;
  kind: 'PULSE' | 'EXIT';
  title: string;
  intro: string | null;
  anonymous: boolean;
  seriesId: string;
  questions: Question[];
  audience: { departmentIds: string[]; positionIds: string[] };
  closesAt: string;
  /** The one way its results can be broken down (fixed once sent). */
  breakdown: Breakdown;
  publishedAt: string | null;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  invited: number;
  answered: number;
  remindersSent: number;
  minGroup: number;
  subject: { firstName: string; lastName: string } | null;
  /** EXIT: the offboarding it belongs to. */
  offboardingId?: string | null;
  mine: boolean;
}

export interface QuestionSummary { id: string; type: QuestionType; text: string; answered: number; average?: number; counts?: Record<string, number>; texts?: string[] }
export interface SurveyResults {
  title: string;
  invited: number;
  answered: number;
  total: number;
  minGroup: number;
  shown: boolean;
  reason?: 'open' | 'tooFew';
  questions?: QuestionSummary[];
  questionsAsked: Question[];
  breakdown?: { by: 'DEPARTMENT' | 'POSITION'; groups: Array<{ id: string; responses: number; questions: QuestionSummary[] }>; hidden: number };
  named?: Array<{ name: string; answers: Record<string, Answer> }>;
}
export interface TrendRow { id: string; title: string; opensAt: string; responses: number | null; points: Array<{ text: string; average: number | null }> }

export const MAX_REMINDERS = 2;

/** A question's answers are complete enough to send? Required ones answered. */
export function missingRequired(questions: Question[], answers: Record<string, Answer | undefined>): string[] {
  return questions.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === '' || (Array.isArray(answers[q.id]) && !(answers[q.id] as string[]).length))).map((q) => q.id);
}

/** Share of a count, for bar widths (0–100). */
export const share = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/** A starting pulse: three quick questions people can edit. */
/** An exit survey's starting point (HR edits it before sending): how it was, why they're leaving, what to do better. */
export function exitStarterQuestions(t: (k: string) => string): Array<Omit<Question, 'id'>> {
  return [
    { type: 'RATING', text: t('surveys.exitStarter.overall'), required: true },
    { type: 'CHOICE', text: t('surveys.exitStarter.reason'), options: ['job', 'school', 'schedule', 'pay', 'team', 'other'].map((k) => t(`surveys.exitStarter.reasons.${k}`)), required: false },
    { type: 'TEXT', text: t('surveys.exitStarter.better'), required: false },
    { type: 'CHOICE', text: t('surveys.exitStarter.again'), options: [t('surveys.exitStarter.yes'), t('surveys.exitStarter.maybe'), t('surveys.exitStarter.no')], required: false },
  ];
}

/** The open survey to nudge about on Today: the soonest to close that isn't answered or hidden this session. */
export function surveyToNudge(list: MySurvey[] | null | undefined, hidden: readonly string[], now = Date.now()): MySurvey | null {
  return [...(list ?? [])].filter((s) => !s.responded && !hidden.includes(s.id) && Date.parse(s.closesAt) > now).sort((a, b) => a.closesAt.localeCompare(b.closesAt))[0] ?? null;
}

export function starterQuestions(t: (k: string) => string): Array<Omit<Question, 'id'>> {
  return [
    { type: 'RATING', text: t('surveys.starter.week'), required: true },
    { type: 'CHOICE', text: t('surveys.starter.workload'), options: [t('surveys.starter.light'), t('surveys.starter.right'), t('surveys.starter.heavy')], required: true },
    { type: 'TEXT', text: t('surveys.starter.anything'), required: false },
  ];
}
