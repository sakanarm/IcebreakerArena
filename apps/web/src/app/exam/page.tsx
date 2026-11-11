import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { SAMPLE_GAMES, buildExam, examSize, toRoomGame } from '@pika-arena/shared';
import { ExamHeader } from '@/components/exam/parts';

export const metadata: Metadata = { title: 'โหมดข้อสอบ' };
export const viewport: Viewport = { themeColor: '#ffffff' };

/** /exam: what exam mode is, the sample games as exams, and how to make one of your own. */
export default function ExamIndexPage() {
  const papers = SAMPLE_GAMES.map((g) => ({ id: g.id, paper: buildExam(toRoomGame(g)) })).filter((p) => examSize(p.paper) > 0);
  return (
    <div className="exam-page">
      <ExamHeader />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">
        <h1 className="text-3xl font-semibold">โหมดข้อสอบ</h1>
        <p className="mt-2 leading-relaxed text-slate-600">
          ทำคำถามแบบเลือกตอบจากเกมได้ด้วยตัวเอง ไม่ต้องรอห้อง ไม่ต้องเข้าสู่ระบบ สุ่มข้อจากคลังได้ทุกครั้ง ฝึกทีละข้อพร้อมเฉลยและคำอธิบาย หรือจำลองสอบแบบจับเวลา
        </p>

        <h2 className="mt-8 text-lg font-semibold">ข้อสอบตัวอย่าง</h2>
        <ul className="mt-3 grid gap-3">
          {papers.map(({ id, paper }) => (
            <li key={id}>
              <Link href={`/exam/${id}`} className="exam-card flex items-center gap-4 p-5 hover:border-brand">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold wrap-anywhere">{paper.title}</span>
                  <span className="mt-0.5 block text-sm text-slate-500">
                    {examSize(paper)} ข้อ{paper.topics.length > 1 ? ` · ${paper.topics.length} หัวข้อ` : ''}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-brand">เริ่มทำ →</span>
              </Link>
            </li>
          ))}
        </ul>

        <section className="exam-card mt-8 p-5">
          <h2 className="font-semibold">ทำข้อสอบจากเกมของคุณเอง</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            คำถามแบบควิซและจริง/เท็จในเกมของคุณใช้เป็นข้อสอบได้ทันที เปิดได้จากหน้าเลือกเกม และถ้าเข้าสู่ระบบอยู่ เปิดลิงก์ข้อสอบส่งให้คนอื่นทำได้โดยไม่ต้องมีบัญชี
          </p>
          <Link href="/host" className="exam-btn mt-4">
            ไปที่เกมของฉัน
          </Link>
        </section>

        <section className="exam-card mt-4 p-5">
          <h2 className="font-semibold">มีข้อสอบอยู่ใน Excel แล้ว?</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            นำเข้าคลังข้อสอบจากไฟล์ Excel, CSV หรือคัดลอกจาก Google Sheets ทีละหลายร้อยข้อ พร้อมเฉลยและคำอธิบาย แล้วเปิดเป็นข้อสอบได้ทันที
          </p>
          <Link href="/import" className="exam-btn mt-4">
            นำเข้าคลังข้อสอบ
          </Link>
        </section>
      </main>
    </div>
  );
}
