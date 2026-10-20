import type { Game, Question, QuestionMultiplier, SliderSpec } from './types';

const quiz = (id: string, prompt: string, options: string[], correct: number, timeLimitS = 20): Question => ({
  id,
  type: 'quiz',
  prompt,
  options,
  correct: [correct],
  timeLimitS,
});

const trueFalse = (id: string, prompt: string, answer: boolean, timeLimitS = 10): Question => ({
  id,
  type: 'truefalse',
  prompt,
  options: ['จริง', 'เท็จ'],
  correct: [answer ? 0 : 1],
  timeLimitS,
});

const poll = (id: string, prompt: string, options: string[], timeLimitS = 20): Question => ({
  id,
  type: 'poll',
  prompt,
  options,
  correct: [],
  timeLimitS,
});

/** the items in the right order; players get them shuffled */
const puzzle = (id: string, prompt: string, inOrder: string[], timeLimitS = 30): Question => ({
  id,
  type: 'puzzle',
  prompt,
  options: inOrder,
  correct: [],
  timeLimitS,
});

/** the first accepted answer is the one the big screen shows */
const typed = (id: string, prompt: string, accepted: string[], timeLimitS = 30): Question => ({
  id,
  type: 'type',
  prompt,
  options: accepted,
  correct: [],
  timeLimitS,
});

/** keep the answer away from the middle of the scale, where the phone's slider starts */
const slider = (id: string, prompt: string, spec: SliderSpec, timeLimitS = 20): Question => ({
  id,
  type: 'slider',
  prompt,
  options: [],
  correct: [],
  timeLimitS,
  slider: spec,
});

const points = (q: Question, multiplier: QuestionMultiplier): Question => ({ ...q, multiplier });

export const SAMPLE_GAMES: Game[] = [
  {
    id: 'tpl-icebreaker',
    title: 'MFEC Icebreaker: อุ่นเครื่องก่อนลุย',
    description: '3 ด่าน 11 ข้อ: โหวตรู้จักกัน, Tech Trivia และ Final Round คะแนน ×2',
    rounds: [
      {
        id: 'r1',
        title: 'อุ่นเครื่อง',
        subtitle: 'ทำความรู้จักกันก่อน',
        questions: [
          poll('q1', 'เช้านี้เติมพลังด้วยอะไร?', ['กาแฟ', 'ชา / ชาเขียว', 'น้ำเปล่า', 'ยังไม่ได้กินอะไรเลย']),
          poll('q2', 'ทำงานแบบไหนแล้วปังที่สุด?', ['เข้าออฟฟิศ', 'WFH', 'Hybrid', 'ร้านกาแฟ']),
          trueFalse('q3', 'อักษรไทยมีพยัญชนะ 44 ตัว', true),
        ],
      },
      {
        id: 'r2',
        title: 'Tech Trivia',
        subtitle: 'ใครเนิร์ดสุดในห้อง',
        questions: [
          quiz('q4', 'HTTP status code 418 หมายถึงอะไร?', ['Not Found', "I'm a teapot", 'Too Many Requests', 'Gateway Timeout'], 1),
          quiz('q5', 'คำสั่ง Git ข้อใดสร้าง branch ใหม่แล้วสลับไปทันที?', ['git switch -c', 'git branch -d', 'git stash', 'git merge'], 0),
          trueFalse('q6', 'Java กับ JavaScript เป็นภาษาเดียวกัน', false),
          quiz('q7', '1 byte มีกี่ bit?', ['4', '8', '16', '32'], 1, 10),
          quiz('q8', 'ภาษา Python ตั้งชื่อตามอะไร?', ['งูเหลือม', 'คณะตลก Monty Python', 'เมืองในกรีก', 'ชื่อลูกของผู้สร้าง'], 1),
        ],
      },
      {
        id: 'r3',
        title: 'Final Round',
        subtitle: 'คะแนน ×2 ทุกข้อ พลิกเกมได้!',
        multiplier: 2,
        questions: [
          quiz('q9', 'ข้อใดไม่ใช่ภาษาโปรแกรม?', ['Rust', 'Kotlin', 'Photoshop', 'Go'], 2),
          quiz('q10', 'ดาวเคราะห์ดวงใดใหญ่ที่สุดในระบบสุริยะ?', ['ดาวเสาร์', 'ดาวพฤหัสบดี', 'ดาวเนปจูน', 'โลก'], 1),
          quiz('q11', 'ปุ่มลัด Ctrl + Z ใช้ทำอะไร?', ['บันทึกไฟล์', 'ย้อนกลับ (Undo)', 'ค้นหา', 'ปิดหน้าต่าง'], 1, 10),
        ],
      },
    ],
  },
  {
    id: 'tpl-security',
    title: 'Security Awareness 101',
    description: '2 ด่าน 7 ข้อ: ภัยออนไลน์ และสถานการณ์จริงแบบไม่นับเวลา',
    rounds: [
      {
        id: 'r1',
        title: 'ระวังภัยออนไลน์',
        subtitle: 'ตอบไวได้คะแนนเยอะ',
        questions: [
          quiz('q1', 'อีเมลแจ้งว่า "รหัสผ่านจะหมดอายุ คลิกลิงก์ด่วน" ควรทำอย่างไร?', [
            'คลิกแล้วเปลี่ยนรหัสทันที',
            'ตอบกลับขอรายละเอียด',
            'ไม่คลิก แล้วแจ้งทีม IT / Security',
            'ส่งต่อให้เพื่อนดู',
          ], 2),
          quiz('q2', 'MFA ย่อมาจากอะไร?', [
            'Multi-Factor Authentication',
            'Main File Access',
            'Mobile Firewall App',
            'Multi-Function Account',
          ], 0),
          trueFalse('q3', 'ส่งไฟล์งานลับผ่าน Wi-Fi สาธารณะโดยไม่ใช้ VPN ถือว่าปลอดภัย', false),
          quiz('q4', 'รหัสผ่านข้อใดแข็งแรงที่สุด?', ['P@ssw0rd', '12345678', 'Coffee-Rain-Bicycle-42!', 'admin2026'], 2),
        ],
      },
      {
        id: 'r2',
        title: 'สถานการณ์จริง',
        subtitle: 'ไม่นับเวลา ขอแค่ตอบให้ถูก',
        timed: false,
        questions: [
          quiz('q5', 'เจอ USB ไม่ทราบเจ้าของวางอยู่ในลิฟต์ ควรทำอย่างไร?', [
            'เสียบดูว่าเป็นของใคร',
            'ส่งให้ทีม IT / Security',
            'เก็บไว้ใช้เอง',
            'ฟอร์แมตแล้วใช้ต่อ',
          ], 1),
          poll('q6', 'เดือนที่ผ่านมาเคยได้อีเมลหลอกลวง (phishing) ไหม?', [
            'เคย และรู้ทันที',
            'เคย เกือบหลงเชื่อ',
            'ไม่แน่ใจ',
            'ไม่เคยเลย',
          ]),
          trueFalse('q7', 'ควรล็อกหน้าจอทุกครั้งที่ลุกจากโต๊ะ', true),
        ],
      },
    ],
  },
  {
    id: 'tpl-party',
    title: 'ปาร์ตี้รวมมิตร: ครบทุกลูกเล่น',
    description: '3 ด่าน 10 ข้อ: ครบทั้ง 6 แบบ ทั้งเรียงลำดับ พิมพ์ตอบ และทายตัวเลข พร้อมโบนัสตอบถูกติดกัน',
    settings: { streakBonus: true },
    rounds: [
      {
        id: 'r1',
        title: 'วอร์มอัพ',
        subtitle: 'ข้อแรกซ้อมมือ ไม่คิดแต้ม',
        questions: [
          points(quiz('q1', 'ซ้อมมือกันก่อน: 1 สัปดาห์มีกี่วัน?', ['5', '6', '7', '8'], 2, 10), 0),
          poll('q2', 'ถ้าได้วันหยุดเพิ่ม 1 วัน จะทำอะไร?', ['นอนยาว ๆ', 'ออกไปเที่ยว', 'ดูซีรีส์รวดเดียว', 'ทำงานต่อ (จริงเหรอ?)']),
          trueFalse('q3', 'ดอยอินทนนท์สูงกว่า 3,000 เมตร', false),
        ],
      },
      {
        id: 'r2',
        title: 'ลูกเล่นใหม่',
        subtitle: 'เรียง พิมพ์ เลื่อน ครบในด่านเดียว',
        questions: [
          puzzle('q4', 'เรียงดาวเคราะห์จากใกล้ดวงอาทิตย์ไปไกล', ['ดาวพุธ', 'ดาวศุกร์', 'โลก', 'ดาวอังคาร']),
          typed('q5', '🐘 สัตว์ประจำชาติไทยคืออะไร? พิมพ์ชื่อมาเลย', ['ช้าง', 'ช้างไทย', 'elephant'], 20),
          points(slider('q6', 'iPhone รุ่นแรกเปิดตัวปี ค.ศ. ไหน?', { min: 1980, max: 2020, step: 1, answer: 2007, margin: 3 }), 2),
        ],
      },
      {
        id: 'r3',
        title: 'Final Round',
        subtitle: 'คะแนน ×2 ทุกข้อ พลิกเกมได้!',
        multiplier: 2,
        questions: [
          quiz('q7', 'ภาษาโปรแกรมใดมีโลโก้เป็นรูปงู?', ['Java', 'Python', 'Go', 'Ruby'], 1),
          puzzle('q8', 'เรียงสัตว์จากตัวเล็กไปตัวใหญ่', ['มด', 'หนู', 'สุนัข', 'ช้าง'], 20),
          slider('q9', 'ที่ระดับน้ำทะเล น้ำเดือดที่กี่องศาเซลเซียส?', { min: 0, max: 300, step: 1, answer: 100, margin: 5, unit: '°C' }),
          typed('q10', 'โปรแกรมแรกที่แทบทุกคนเขียน พิมพ์คำว่าอะไรออกจอ?', ['Hello, World!', 'สวัสดีชาวโลก']),
        ],
      },
    ],
  },
  {
    id: 'tpl-emoji',
    title: 'ทายจากอีโมจิ',
    description: '3 ด่าน 10 ข้อ: ดูอีโมจิแล้วพิมพ์คำตอบ ทั้งเมนูอาหาร ศัพท์ไอที และสำนวนไทย',
    rounds: [
      {
        id: 'r1',
        title: 'เมนูอาหาร',
        subtitle: 'ดูอีโมจิแล้วพิมพ์ชื่อเมนู',
        questions: [
          typed('q1', '🍜🦐🌶️🍋 เมนูอะไรเอ่ย?', ['ต้มยำกุ้ง', 'ต้มยำ', 'tom yum goong', 'tom yum']),
          typed('q2', '🥭🍚🥥 ของหวานอะไรเอ่ย?', ['ข้าวเหนียวมะม่วง', 'mango sticky rice']),
          quiz('q3', '🍳 + 🌿 + 🐷 + 🍚 = ?', ['ข้าวผัด', 'ข้าวกะเพราหมูไข่ดาว', 'ข้าวมันไก่', 'โจ๊กหมู'], 1),
          typed('q4', '🌶️🥜🍅🥗 เมนูอีสานยอดฮิตคืออะไร?', ['ส้มตำ', 'ส้มตำไทย', 'som tam', 'somtum']),
        ],
      },
      {
        id: 'r2',
        title: 'ศัพท์ไอที',
        subtitle: 'พิมพ์ได้ทั้งไทยและอังกฤษ',
        questions: [
          typed('q5', '🎣📧 ภัยออนไลน์แบบนี้เรียกว่าอะไร?', ['phishing', 'ฟิชชิ่ง', 'ฟิชชิง']),
          typed('q6', '🔥🧱 ระบบกันคนแปลกหน้าเข้าเครือข่ายเรียกว่าอะไร?', ['firewall', 'ไฟร์วอลล์', 'ไฟร์วอล']),
          typed('q7', '🐞🔍 นักพัฒนาทำสิ่งนี้แทบทุกวัน', ['debug', 'ดีบัก', 'ดีบั๊ก', 'debugging']),
          typed('q8', '🐙🐱 เว็บเก็บโค้ดยอดฮิตชื่ออะไร?', ['GitHub', 'กิตฮับ', 'กิทฮับ']),
        ],
      },
      {
        id: 'r3',
        title: 'สำนวนไทย',
        subtitle: 'คะแนน ×2 ปิดท้าย',
        multiplier: 2,
        questions: [
          typed('q9', '🐍🐍🐟🐟 สำนวนนี้คืออะไร? (รู้แบบผิวเผิน)', ['งูๆ ปลาๆ', 'งูงูปลาปลา']),
          quiz('q10', '🐘💀🍃 สำนวนนี้คืออะไร?', ['ช้างตายทั้งตัวเอาใบบัวปิด', 'ช้างเท้าหน้า', 'ขี่ช้างจับตั๊กแตน', 'เห็นช้างขี้ ขี้ตามช้าง'], 0),
        ],
      },
    ],
  },
  {
    id: 'tpl-numbers',
    title: 'ตัวเลขและลำดับ: ทายให้ใกล้ เรียงให้ถูก',
    description: '3 ด่าน 10 ข้อ: เลื่อนทายตัวเลข ยิ่งใกล้ยิ่งได้เยอะ เรียงลำดับให้ถูก และ Final Round ×2',
    rounds: [
      {
        id: 'r1',
        title: 'ทายตัวเลข',
        subtitle: 'ไม่ต้องเป๊ะ ใกล้แค่ไหนได้แต้มแค่นั้น',
        questions: [
          slider('q1', 'ดอยอินทนนท์ ยอดเขาสูงที่สุดในไทย สูงกี่เมตร?', { min: 0, max: 4000, step: 5, answer: 2565, margin: 150, unit: 'เมตร' }, 30),
          slider('q2', 'ร่างกายผู้ใหญ่มีกระดูกกี่ชิ้น?', { min: 0, max: 500, step: 1, answer: 206, margin: 20, unit: 'ชิ้น' }),
          slider('q3', 'ประเทศไทยมีกี่จังหวัด (นับรวมกรุงเทพฯ)?', { min: 0, max: 100, step: 1, answer: 77, margin: 3, unit: 'จังหวัด' }),
          slider('q4', 'ฟุตบอลโลกครั้งแรกจัดขึ้นปี ค.ศ. ไหน?', { min: 1900, max: 2000, step: 1, answer: 1930, margin: 5 }),
        ],
      },
      {
        id: 'r2',
        title: 'เรียงให้ถูก',
        subtitle: 'ต้องถูกทุกช่องถึงได้คะแนน',
        questions: [
          puzzle('q5', 'เรียงหน่วยความจุจากเล็กไปใหญ่', ['KB', 'MB', 'GB', 'TB'], 20),
          puzzle('q6', 'เรียงขั้นตอนส่งโค้ดเข้าทีม', ['git add', 'git commit', 'git push', 'เปิด Pull Request']),
          puzzle('q7', 'เรียงตามปีที่เปิดตัว จากเก่าไปใหม่', ['Facebook', 'YouTube', 'iPhone', 'ChatGPT']),
        ],
      },
      {
        id: 'r3',
        title: 'Final Round',
        subtitle: 'คะแนน ×2 ข้อสุดท้ายพลิกเกมได้!',
        multiplier: 2,
        questions: [
          slider('q8', 'เวลาแบบ Unix เริ่มนับจากปี ค.ศ. ไหน?', { min: 1900, max: 2000, step: 1, answer: 1970, margin: 3 }),
          slider('q9', 'เว็บแบบ HTTP ใช้พอร์ตไหนเป็นค่าเริ่มต้น?', { min: 0, max: 500, step: 1, answer: 80, margin: 10 }),
          slider('q10', 'รหัส ASCII ของตัว A (พิมพ์ใหญ่) คือเลขอะไร?', { min: 0, max: 255, step: 1, answer: 65, margin: 5 }),
        ],
      },
    ],
  },
];
