import type { Game, Question, QuestionMultiplier, QuestionType, Round } from './types';

export const LIMITS = {
  titleMax: 120,
  promptMax: 200,
  optionMax: 75,
  roundsMax: 20,
  questionsMax: 100,
  timeMinS: 5,
  timeMaxS: 240,
  roundMultiplierMax: 4,
} as const;

export const TIME_CHOICES_S = [5, 10, 20, 30, 45, 60, 90, 120] as const;

const TYPES: QuestionType[] = ['quiz', 'truefalse', 'poll'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export type ValidateResult = { ok: true; game: Game } | { ok: false; errors: string[] };

/**
 * Checks a game from the editor or an import, and returns a clean copy.
 * Errors are in Thai because the editor shows them as they are.
 * Round and question ids are reassigned so they are always unique.
 */
export function validateGame(input: unknown): ValidateResult {
  if (!isObj(input)) return { ok: false, errors: ['ข้อมูลเกมไม่ถูกต้อง'] };
  const errors: string[] = [];

  const title = str(input.title);
  if (!title) errors.push('ต้องตั้งชื่อเกม');
  if (title.length > LIMITS.titleMax) errors.push(`ชื่อเกมยาวเกิน ${LIMITS.titleMax} ตัวอักษร`);

  const roundsIn = Array.isArray(input.rounds) ? input.rounds : [];
  if (roundsIn.length === 0) errors.push('ต้องมีอย่างน้อย 1 ด่าน');
  if (roundsIn.length > LIMITS.roundsMax) errors.push(`มีได้ไม่เกิน ${LIMITS.roundsMax} ด่าน`);

  let questionCount = 0;
  const rounds: Round[] = roundsIn.slice(0, LIMITS.roundsMax).map((r, ri) => {
    const where = `ด่าน ${ri + 1}`;
    const rr = isObj(r) ? r : {};
    const multiplier = typeof rr.multiplier === 'number' ? rr.multiplier : 1;
    if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > LIMITS.roundMultiplierMax) {
      errors.push(`${where}: ตัวคูณด่านต้องเป็น 1–${LIMITS.roundMultiplierMax}`);
    }
    const questionsIn = Array.isArray(rr.questions) ? rr.questions : [];
    if (questionsIn.length === 0) errors.push(`${where}: ต้องมีอย่างน้อย 1 คำถาม`);
    questionCount += questionsIn.length;
    const subtitle = str(rr.subtitle);
    return {
      id: `r${ri + 1}`,
      title: (str(rr.title) || where).slice(0, LIMITS.titleMax),
      ...(subtitle ? { subtitle: subtitle.slice(0, LIMITS.titleMax) } : {}),
      multiplier,
      timed: rr.timed !== false,
      questions: questionsIn.map((q, qi) => checkQuestion(q, `${where} ข้อ ${qi + 1}`, `q${ri + 1}-${qi + 1}`, errors)),
    };
  });
  if (questionCount > LIMITS.questionsMax) errors.push(`มีคำถามได้ไม่เกิน ${LIMITS.questionsMax} ข้อต่อเกม`);

  if (errors.length > 0) return { ok: false, errors };
  const description = str(input.description);
  return {
    ok: true,
    game: {
      id: str(input.id) || 'game',
      title,
      ...(description ? { description } : {}),
      rounds,
      settings: { streakBonus: isObj(input.settings) && input.settings.streakBonus === true },
    },
  };
}

function checkQuestion(q: unknown, where: string, id: string, errors: string[]): Question {
  const qq = isObj(q) ? q : {};
  const type = TYPES.includes(qq.type as QuestionType) ? (qq.type as QuestionType) : 'quiz';

  const prompt = str(qq.prompt);
  if (!prompt) errors.push(`${where}: ยังไม่ได้พิมพ์คำถาม`);
  if (prompt.length > LIMITS.promptMax) errors.push(`${where}: คำถามยาวเกิน ${LIMITS.promptMax} ตัวอักษร`);

  let options = (Array.isArray(qq.options) ? qq.options : []).map(str);
  if (type === 'truefalse') options = [options[0] || 'จริง', options[1] || 'เท็จ'];
  if (options.length < 2 || options.length > 4) errors.push(`${where}: ต้องมีตัวเลือก 2–4 ข้อ`);
  options.forEach((o, i) => {
    if (!o) errors.push(`${where}: ตัวเลือกที่ ${i + 1} ยังว่างอยู่`);
    else if (o.length > LIMITS.optionMax) errors.push(`${where}: ตัวเลือกที่ ${i + 1} ยาวเกิน ${LIMITS.optionMax} ตัวอักษร`);
  });

  const correctIn = Array.isArray(qq.correct) ? qq.correct : [];
  const correct =
    type === 'poll'
      ? []
      : [...new Set(correctIn.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < options.length))].sort(
          (a, b) => a - b,
        );
  if (type !== 'poll' && correct.length === 0) errors.push(`${where}: ต้องเลือกคำตอบที่ถูกอย่างน้อย 1 ข้อ`);

  const timeLimitS = typeof qq.timeLimitS === 'number' ? Math.round(qq.timeLimitS) : 20;
  if (timeLimitS < LIMITS.timeMinS || timeLimitS > LIMITS.timeMaxS) {
    errors.push(`${where}: เวลาตอบต้องอยู่ระหว่าง ${LIMITS.timeMinS}–${LIMITS.timeMaxS} วินาที`);
  }

  const multiplier: QuestionMultiplier = qq.multiplier === 0 || qq.multiplier === 2 ? qq.multiplier : 1;

  const imageUrl = str(qq.imageUrl);
  if (imageUrl && !/^https:\/\/\S+$/.test(imageUrl)) errors.push(`${where}: ลิงก์รูปต้องขึ้นต้นด้วย https://`);

  return { id, type, prompt, options, correct, timeLimitS, multiplier, ...(imageUrl ? { imageUrl } : {}) };
}
