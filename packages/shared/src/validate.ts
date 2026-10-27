import { normalizeTyped, onScale } from './answers';
import { cleanCover } from './cover';
import type { Game, Question, QuestionMultiplier, QuestionType, Round, SliderSpec } from './types';

export const LIMITS = {
  titleMax: 120,
  promptMax: 200,
  optionMax: 75,
  roundsMax: 20,
  questionsMax: 100,
  timeMinS: 5,
  timeMaxS: 240,
  roundMultiplierMax: 4,
  /** signed SharePoint or CDN links run long; the server refuses to keep more than this */
  imageUrlMax: 4096,
  descriptionMax: 300,
  /** a typed answer, and each accepted answer of a type question */
  typedMax: 40,
  /** slider numbers stay within ± this */
  sliderAbs: 1_000_000_000,
  /** steps on a slider scale; more than this and a phone can't land on one */
  sliderSteps: 10_000,
  unitMax: 20,
  /** the game as it goes to the game server to open a room, in UTF-8: one message must carry it (MESSAGE_MAX_BYTES) */
  gameBytesMax: 448 * 1024,
} as const;

/**
 * The most one message may carry: a socket message to the game server, and a JSON body to the web app.
 * A bigger socket message drops the connection, so a game that opens a room stays well under it.
 */
export const MESSAGE_MAX_BYTES = 512 * 1024;

/** how many bytes a game takes on its way to the game server */
export const gameBytes = (game: unknown) => new TextEncoder().encode(JSON.stringify(game)).length;

export const TIME_CHOICES_S = [5, 10, 20, 30, 45, 60, 90, 120] as const;

export const QUESTION_TYPES: QuestionType[] = ['quiz', 'truefalse', 'poll', 'puzzle', 'type', 'slider'];

/** how many options each type takes */
export const OPTION_COUNT: Record<QuestionType, { min: number; max: number }> = {
  quiz: { min: 2, max: 4 },
  truefalse: { min: 2, max: 2 },
  poll: { min: 2, max: 4 },
  puzzle: { min: 3, max: 4 },
  type: { min: 1, max: 4 },
  slider: { min: 0, max: 0 },
};

/** the right answer is one or more tiles */
export const hasCorrectTiles = (type: QuestionType) => type === 'quiz' || type === 'truefalse';

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
  const cover = cleanCover(input.cover);
  const game: Game = {
    id: str(input.id) || 'game',
    title,
    ...(description ? { description } : {}),
    rounds,
    settings: { streakBonus: isObj(input.settings) && input.settings.streakBonus === true },
    ...(cover ? { cover } : {}),
  };
  // only image links can take a game this far; anything that passes opens a room
  const kb = (n: number) => Math.ceil(n / 1024).toLocaleString('en-US');
  const bytes = gameBytes(game);
  if (bytes > LIMITS.gameBytesMax) {
    return {
      ok: false,
      errors: [`เกมนี้ใหญ่ ${kb(bytes)} KB เกินที่เปิดห้องได้ (${kb(LIMITS.gameBytesMax)} KB): ลิงก์รูปที่ยาวมากกินที่มากที่สุด ลองใช้ลิงก์ที่สั้นลง หรือแบ่งเป็นสองเกม`],
    };
  }
  return { ok: true, game };
}

function checkQuestion(q: unknown, where: string, id: string, errors: string[]): Question {
  const qq = isObj(q) ? q : {};
  const type = QUESTION_TYPES.includes(qq.type as QuestionType) ? (qq.type as QuestionType) : 'quiz';

  const prompt = str(qq.prompt);
  if (!prompt) errors.push(`${where}: ยังไม่ได้พิมพ์คำถาม`);
  if (prompt.length > LIMITS.promptMax) errors.push(`${where}: คำถามยาวเกิน ${LIMITS.promptMax} ตัวอักษร`);

  let options = type === 'slider' ? [] : (Array.isArray(qq.options) ? qq.options : []).map(str);
  if (type === 'truefalse') options = [options[0] || 'จริง', options[1] || 'เท็จ'];
  const count = OPTION_COUNT[type];
  const noun = type === 'type' ? 'คำตอบที่ยอมรับ' : type === 'puzzle' ? 'รายการ' : 'ตัวเลือก';
  const max = type === 'type' ? LIMITS.typedMax : LIMITS.optionMax;
  if (type !== 'slider' && (options.length < count.min || options.length > count.max)) {
    errors.push(`${where}: ต้องมี${noun} ${count.min === 1 ? `1–${count.max}` : `${count.min}–${count.max}`} ข้อ`);
  }
  options.forEach((o, i) => {
    if (!o) errors.push(`${where}: ${noun}ที่ ${i + 1} ยังว่างอยู่`);
    else if (o.length > max) errors.push(`${where}: ${noun}ที่ ${i + 1} ยาวเกิน ${max} ตัวอักษร`);
    else if (type === 'type' && !normalizeTyped(o)) errors.push(`${where}: ${noun}ที่ ${i + 1} ต้องมีตัวอักษรหรือตัวเลข`);
  });
  // two identical items would leave two right orders
  if (type === 'puzzle' && new Set(options.filter(Boolean).map((o) => o.toLowerCase())).size < options.filter(Boolean).length) {
    errors.push(`${where}: รายการซ้ำกัน แต่ละรายการต้องไม่เหมือนกัน`);
  }
  // a typed answer only ever counts for the first of two accepted answers that compare the same
  if (type === 'type') {
    const first = new Map<string, number>();
    options.forEach((o, i) => {
      const key = normalizeTyped(o);
      if (!key) return;
      const j = first.get(key);
      if (j === undefined) first.set(key, i);
      else errors.push(`${where}: คำตอบที่ยอมรับที่ ${i + 1} ซ้ำกับที่ ${j + 1} (ระบบไม่สนตัวพิมพ์เล็กใหญ่ เว้นวรรค และเครื่องหมายอยู่แล้ว)`);
    });
  }

  const correctIn = Array.isArray(qq.correct) ? qq.correct : [];
  const correct = !hasCorrectTiles(type)
    ? []
    : [...new Set(correctIn.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < options.length))].sort(
        (a, b) => a - b,
      );
  if (hasCorrectTiles(type) && correct.length === 0) errors.push(`${where}: ต้องเลือกคำตอบที่ถูกอย่างน้อย 1 ข้อ`);

  const slider = type === 'slider' ? checkSlider(qq.slider, where, errors) : undefined;

  const timeLimitS = typeof qq.timeLimitS === 'number' ? Math.round(qq.timeLimitS) : 20;
  if (timeLimitS < LIMITS.timeMinS || timeLimitS > LIMITS.timeMaxS) {
    errors.push(`${where}: เวลาตอบต้องอยู่ระหว่าง ${LIMITS.timeMinS}–${LIMITS.timeMaxS} วินาที`);
  }

  const multiplier: QuestionMultiplier = qq.multiplier === 0 || qq.multiplier === 2 ? qq.multiplier : 1;

  const imageUrl = str(qq.imageUrl);
  if (imageUrl && !/^https:\/\/\S+$/.test(imageUrl)) errors.push(`${where}: ลิงก์รูปต้องขึ้นต้นด้วย https://`);
  else if (imageUrl.length > LIMITS.imageUrlMax) errors.push(`${where}: ลิงก์รูปยาวเกิน ${LIMITS.imageUrlMax} ตัวอักษร`);

  return { id, type, prompt, options, correct, timeLimitS, multiplier, ...(imageUrl ? { imageUrl } : {}), ...(slider ? { slider } : {}) };
}

/** a slider's numbers, named as the editor labels them */
const SLIDER_FIELDS = [
  ['min', 'ค่าน้อยสุด'],
  ['max', 'ค่ามากสุด'],
  ['step', 'เลื่อนทีละ'],
  ['answer', 'คำตอบที่ถูก'],
  ['margin', 'ระยะได้คะแนน'],
] as const;

function checkSlider(input: unknown, where: string, errors: string[]): SliderSpec {
  const s = isObj(input) ? input : {};
  const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
  const spec: SliderSpec = { min: num(s.min), max: num(s.max), step: num(s.step), answer: num(s.answer), margin: num(s.margin) };
  const unit = str(s.unit);
  if (unit) spec.unit = unit;

  const broken = SLIDER_FIELDS.filter(([k]) => !Number.isInteger(spec[k]) || Math.abs(spec[k]) > LIMITS.sliderAbs);
  if (broken.length) {
    const names = broken.map(([, name]) => name).join(', ');
    errors.push(`${where}: ${names} ต้องเป็นจำนวนเต็ม ไม่เกิน ±${LIMITS.sliderAbs.toLocaleString('en-US')}`);
    return spec;
  }
  if (spec.max <= spec.min) errors.push(`${where}: ค่ามากสุดต้องมากกว่าค่าน้อยสุด`);
  else if (spec.step < 1) errors.push(`${where}: เลื่อนทีละต้องเป็น 1 ขึ้นไป`);
  else if ((spec.max - spec.min) / spec.step > LIMITS.sliderSteps) {
    errors.push(`${where}: สไลเดอร์ละเอียดเกินไป (เกิน ${LIMITS.sliderSteps.toLocaleString('en-US')} ขั้น) ลองเพิ่มขั้นให้ใหญ่ขึ้น`);
  } else if ((spec.max - spec.min) % spec.step !== 0) {
    // otherwise the top of the scale is a number players can't land on
    errors.push(`${where}: จาก ${spec.min} เพิ่มทีละ ${spec.step} ต้องไปถึง ${spec.max} พอดี ลองปรับค่ามากสุดหรือขั้น`);
  } else if (!onScale(spec, spec.answer)) {
    errors.push(`${where}: คำตอบต้องอยู่ระหว่าง ${spec.min}–${spec.max} และลงขั้นของสไลเดอร์พอดี`);
  }
  if (spec.margin < 0) errors.push(`${where}: ระยะได้คะแนนต้องเป็น 0 ขึ้นไป (0 = ต้องตอบตรงเป๊ะ)`);
  if (unit.length > LIMITS.unitMax) errors.push(`${where}: หน่วยยาวเกิน ${LIMITS.unitMax} ตัวอักษร`);
  return spec;
}
