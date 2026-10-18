import type { Game, Question } from './types';

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
];
