/** Staff surveys (API: routes/surveys.ts). Shapes the screens use, and the question builder's rules. */
export type QuestionType = 'RATING' | 'CHOICE' | 'MULTI' | 'TEXT';
export interface Question { id: string; type: QuestionType; text: string; options?: string[]; required: boolean }
export type Answer = number | string | string[];

export interface MySurvey { id: string; kind: 'PULSE' | 'EXIT'; title: string; intro: string | null; anonymous: boolean; minGroup: number; closesAt: string; responded: boolean; questions: Question[] }

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
  publishedAt: string | null;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  invited: number;
  answered: number;
  remindersSent: number;
  minGroup: number;
  subject: { firstName: string; lastName: string } | null;
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
  breakdowns?: { department: Array<{ id: string; responses: number; questions: QuestionSummary[] }>; position: Array<{ id: string; responses: number; questions: QuestionSummary[] }>; hiddenResponses: { department: number; position: number } };
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
export function starterQuestions(t: (k: string) => string): Array<Omit<Question, 'id'>> {
  return [
    { type: 'RATING', text: t('surveys.starter.week'), required: true },
    { type: 'CHOICE', text: t('surveys.starter.workload'), options: [t('surveys.starter.light'), t('surveys.starter.right'), t('surveys.starter.heavy')], required: true },
    { type: 'TEXT', text: t('surveys.starter.anything'), required: false },
  ];
}
