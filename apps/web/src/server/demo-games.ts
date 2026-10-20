import { validateGame, type Game, type Question, type SliderSpec } from '@icebreaker/shared';
import { shareGame } from './catalog';
import type { Db } from './db';
import { createGame, listGames, normalizeDraft } from './games';
import type { SessionUser } from './session';

// the same builders as the built-in samples
const quiz = (id: string, prompt: string, options: string[], correct: number, timeLimitS = 20): Question => ({ id, type: 'quiz', prompt, options, correct: [correct], timeLimitS });
const trueFalse = (id: string, prompt: string, answer: boolean, timeLimitS = 10): Question => ({ id, type: 'truefalse', prompt, options: ['จริง', 'เท็จ'], correct: [answer ? 0 : 1], timeLimitS });
const poll = (id: string, prompt: string, options: string[], timeLimitS = 20): Question => ({ id, type: 'poll', prompt, options, correct: [], timeLimitS });
/** the items in the right order; players get them shuffled */
const puzzle = (id: string, prompt: string, inOrder: string[], timeLimitS = 30): Question => ({ id, type: 'puzzle', prompt, options: inOrder, correct: [], timeLimitS });
/** the first accepted answer is the one the big screen shows */
const typed = (id: string, prompt: string, accepted: string[], timeLimitS = 30): Question => ({ id, type: 'type', prompt, options: accepted, correct: [], timeLimitS });
/** keep the answer outside the margin around the middle of the scale, where the phone's slider starts */
const slider = (id: string, prompt: string, spec: SliderSpec, timeLimitS = 20): Question => ({ id, type: 'slider', prompt, options: [], correct: [], timeLimitS, slider: spec });

/** Ready-made games for a new account to show off with: each one has every question type. */
export const DEMO_GAMES: Game[] = [
  {
    id: 'demo-townhall',
    title: 'Townhall ประจำเดือน: เปิดประชุมให้ตื่น',
    description: '3 ด่าน 10 ข้อ ครบทั้ง 6 แบบ: เช็กอินพลังทีม, Tech Facts และ Final Round ×2 พร้อมโบนัสตอบถูกติดกัน',
    settings: { streakBonus: true },
    rounds: [
      {
        id: 'r1',
        title: 'เช็กอินก่อนเริ่ม',
        subtitle: 'ไม่มีถูกผิด ตอบตามจริง',
        questions: [
          poll('q1', 'สัปดาห์นี้พลังงานของคุณเหลือเท่าไหร่?', ['เต็มถัง 🔋', 'ครึ่งถัง 🙂', 'ใกล้หมด 🪫', 'ขอกาแฟก่อน ☕']),
          poll('q2', 'เดือนนี้อยากฉลองเรื่องไหนที่สุด?', ['ปิดงานได้ตามแผน 🎯', 'ลูกค้าชม 🌟', 'ได้เพื่อนร่วมทีมใหม่ 🤝', 'รอดมาได้ก็เก่งแล้ว 😅']),
        ],
      },
      {
        id: 'r2',
        title: 'Tech Facts',
        subtitle: 'ตอบไวได้คะแนนเยอะ',
        questions: [
          quiz('q3', 'HTTPS ใช้พอร์ตไหนเป็นค่าเริ่มต้น?', ['21', '80', '443', '8080'], 2),
          trueFalse('q4', 'Git สร้างโดย Linus Torvalds คนเดียวกับที่สร้าง Linux', true),
          typed('q5', 'ภาษาที่ใช้แต่งหน้าตาเว็บ (สี ฟอนต์ ระยะห่าง) ชื่อย่อว่าอะไร?', ['CSS', 'Cascading Style Sheets'], 20),
          puzzle('q6', 'เรียงชั้นของ OSI Model จากล่างขึ้นบน', ['Physical', 'Data Link', 'Network', 'Transport']),
          slider('q7', 'อีเมลฉบับแรกที่ใช้เครื่องหมาย @ ถูกส่งในปี ค.ศ. ไหน?', { min: 1960, max: 2020, step: 1, answer: 1971, margin: 3 }),
        ],
      },
      {
        id: 'r3',
        title: 'Final Round',
        subtitle: 'คะแนน ×2 พลิกเกมได้!',
        multiplier: 2,
        questions: [
          quiz('q8', 'ข้อใดเป็นฐานข้อมูลแบบ NoSQL?', ['PostgreSQL', 'MySQL', 'MongoDB', 'Oracle Database'], 2),
          trueFalse('q9', 'HTTP 500 แปลว่าฝั่งผู้ใช้ส่งคำขอผิดรูปแบบ', false),
          slider('q10', 'รูบิก 3×3 มีสติกเกอร์สีรวมทั้งหมดกี่ช่อง?', { min: 0, max: 200, step: 1, answer: 54, margin: 5, unit: 'ช่อง' }),
        ],
      },
    ],
  },
  {
    id: 'demo-onboarding',
    title: 'Onboarding Day: ต้อนรับน้องใหม่',
    description: '3 ด่าน 9 ข้อ: โหวตรู้จักกัน, ทริกชีวิตออฟฟิศแบบไม่นับเวลา และปิดท้ายคะแนน ×2',
    rounds: [
      {
        id: 'r1',
        title: 'รู้จักกันหน่อย',
        subtitle: 'โหวตกันสนุก ๆ ไม่มีถูกผิด',
        questions: [
          poll('q1', 'ชอบทำงานช่วงไหนที่สุด?', ['เช้าตรู่ 🌅', 'สาย ๆ ☀️', 'บ่าย ๆ 🌤️', 'ดึก ๆ 🌙']),
          poll('q2', 'ถ้าเลือกพลังพิเศษได้ 1 อย่างไว้ใช้ทำงาน?', ['หยุดเวลาได้ ⏸️', 'อ่านใจลูกค้าได้ 🔮', 'โคลนตัวเองไปประชุม 👯', 'ไม่ง่วงเลยทั้งวัน ⚡']),
        ],
      },
      {
        id: 'r2',
        title: 'ทริกชีวิตออฟฟิศ',
        subtitle: 'ไม่นับเวลา ขอแค่ตอบให้ถูก',
        timed: false,
        questions: [
          quiz('q3', 'ส่งไฟล์งานให้ลูกค้า วิธีไหนปลอดภัยที่สุด?', ['แนบอีเมลส่วนตัว', 'แชร์จากไดรฟ์บริษัท จำกัดสิทธิ์คนเห็น', 'ส่งผ่านแชตส่วนตัว', 'ใส่ USB ไปให้'], 1, 30),
          trueFalse('q4', 'ใส่อีเมลไว้ในช่อง BCC ผู้รับคนอื่นจะไม่เห็นอีเมลนั้น', true, 20),
          typed('q5', 'ลุกจากโต๊ะต้องล็อกจอ! บน Windows กดปุ่ม Windows + ตัวอักษรอะไร?', ['L', 'Windows + L', 'Win + L'], 20),
          puzzle('q6', 'เรียงขนาดกระดาษจากใหญ่ไปเล็ก', ['A2', 'A3', 'A4', 'A5']),
        ],
      },
      {
        id: 'r3',
        title: 'ปิดท้าย ×2',
        subtitle: 'คะแนน ×2 ใครจะได้ที่ 1?',
        multiplier: 2,
        questions: [
          slider('q7', 'กระดาษ A4 กว้างกี่มิลลิเมตร?', { min: 100, max: 400, step: 1, answer: 210, margin: 10, unit: 'มม.' }),
          quiz('q8', 'ไฟล์นามสกุลใดเป็นไฟล์ตารางคำนวณ?', ['.docx', '.xlsx', '.pptx', '.pdf'], 1, 10),
          trueFalse('q9', 'ในเบราว์เซอร์ กด Ctrl + Shift + T จะเปิดแท็บที่เพิ่งปิดไปกลับมา', true),
        ],
      },
    ],
  },
  {
    id: 'demo-thailand',
    title: 'รู้จักเมืองไทยแค่ไหน',
    description: '3 ด่าน 9 ข้อ: เที่ยวทั่วไทย ย้อนเวลา ของกินขึ้นชื่อ และ Final Round ×2',
    rounds: [
      {
        id: 'r1',
        title: 'เที่ยวทั่วไทย',
        subtitle: 'ภูมิศาสตร์ฉบับคนชอบเที่ยว',
        questions: [
          poll('q1', 'ถ้าได้เที่ยวฟรี 1 ทริป จะไปภาคไหน?', ['เหนือ ⛰️', 'อีสาน 🌾', 'ใต้ 🏝️', 'ตะวันออก 🌊']),
          quiz('q2', 'จังหวัดใดมีพื้นที่ใหญ่ที่สุดในประเทศไทย?', ['เชียงใหม่', 'นครราชสีมา', 'กาญจนบุรี', 'ตาก'], 1),
          trueFalse('q3', 'ภูเก็ตเป็นเกาะที่ใหญ่ที่สุดของประเทศไทย', true),
        ],
      },
      {
        id: 'r2',
        title: 'ย้อนเวลา',
        subtitle: 'เรียงให้ถูก พิมพ์ให้ตรง',
        questions: [
          puzzle('q4', 'เรียงสมัยในประวัติศาสตร์ไทย จากเก่าไปใหม่', ['สุโขทัย', 'อยุธยา', 'ธนบุรี', 'รัตนโกสินทร์']),
          typed('q5', 'ขนมไทยที่ทำจากแป้ง กะทิ และใบเตย ซ้อนกันเป็นชั้น ๆ ชื่อว่าอะไร?', ['ขนมชั้น', 'khanom chan']),
          slider('q6', 'ช้างตั้งท้องนานประมาณกี่เดือน?', { min: 0, max: 36, step: 1, answer: 22, margin: 2, unit: 'เดือน' }),
        ],
      },
      {
        id: 'r3',
        title: 'Final Round',
        subtitle: 'คะแนน ×2 ข้อสุดท้ายพลิกเกมได้!',
        multiplier: 2,
        questions: [
          quiz('q7', 'ผลโหวตอาหารอร่อยที่สุดในโลกของ CNN ปี 2011 อาหารไทยจานใดได้อันดับ 1?', ['ต้มยำกุ้ง', 'แกงมัสมั่น', 'ผัดไทย', 'ส้มตำ'], 1),
          trueFalse('q8', 'ดอกไม้ประจำชาติไทยคือดอกราชพฤกษ์ (ดอกคูน)', true),
          typed('q9', 'จังหวัดที่ได้ฉายาว่า "เมืองสามหมอก" คือจังหวัดอะไร?', ['แม่ฮ่องสอน', 'Mae Hong Son']),
        ],
      },
    ],
  },
];

/** the demo that `share` lists in the catalog, so other accounts have something to copy */
export const SHARED_DEMO = 'demo-thailand';

export interface DemoResult {
  made: string[];
  kept: string[];
  /** with `share`: listed now, or already listed before */
  shared: 'listed' | 'already' | null;
}

/**
 * Puts the demo games in an account as if picked from the built-in samples. A demo whose title the
 * account already has is left as it is, so running this again adds nothing.
 */
export async function addDemoGames(db: Db, user: SessionUser, { share = false } = {}): Promise<DemoResult> {
  const have = new Map((await listGames(db, user.id)).map((g) => [g.game.title, g]));
  const result: DemoResult = { made: [], kept: [], shared: null };
  for (const demo of DEMO_GAMES) {
    if (have.has(demo.title)) {
      result.kept.push(demo.title);
      continue;
    }
    // the same path as a game sent to the API, and only a complete one
    const draft = normalizeDraft(demo);
    const checked = draft ? validateGame(draft) : null;
    if (!draft || !checked?.ok) throw new Error(`demo ${demo.id} is not a complete game${checked && !checked.ok ? `: ${checked.errors.join('; ')}` : ''}`);
    have.set(demo.title, await createGame(db, user.id, draft, 'sample', demo.id));
    result.made.push(demo.title);
  }
  if (share) {
    const rec = have.get(DEMO_GAMES.find((g) => g.id === SHARED_DEMO)!.title)!;
    if (rec.sharedStatus === 'listed') result.shared = 'already';
    else {
      const res = await shareGame(db, user, rec.id);
      if (!res.ok) throw new Error(`sharing "${rec.game.title}": ${res.reason}`);
      result.shared = 'listed';
    }
  }
  return result;
}
