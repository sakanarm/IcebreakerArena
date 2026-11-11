import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { SAMPLE_GAMES, buildExam, examSize, toRoomGame } from '@pika-arena/shared';
import { ExamHeader } from '@/components/exam/parts';

export const metadata: Metadata = { title: 'โหมดข้อสอบ' };
export const viewport: Viewport = { themeColor: '#0b0b2b' };

/** /exam: what exam mode is, the sample games as exams, and how to make one of your own. */
export default function ExamIndexPage() {
  const papers = SAMPLE_GAMES.map((g) => ({ id: g.id, paper: buildExam(toRoomGame(g)) })).filter((p) => examSize(p.paper) > 0);
  return (
    <div className="exam-page">
      <ExamHeader />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">
        <p className="text-sm font-semibold tracking-wide text-brand-2">ฝึกทำข้อสอบด้วยตัวเอง</p>
        <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">โหมดข้อสอบ</h1>
        <p className="mt-2 leading-relaxed text-ex-muted">
          ทำคำถามแบบเลือกตอบจากเกมได้ด้วยตัวเอง ไม่ต้องรอห้อง ไม่ต้องเข้าสู่ระบบ สุ่มข้อจากคลังได้ทุกครั้ง ฝึกทีละข้อพร้อมเฉลยและคำอธิบาย หรือจำลองสอบแบบจับเวลา
        </p>

        <h2 className="mt-8 text-lg font-semibold">ข้อสอบตัวอย่าง</h2>
        <ul className="mt-3 grid gap-3">
          {papers.map(({ id, paper }) => (
            <li key={id}>
              <Link href={`/exam/${id}`} className="exam-card flex items-center gap-4 p-5 transition-colors hover:border-ex-accent/70 hover:bg-ex-raised">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold wrap-anywhere">{paper.title}</span>
                  <span className="mt-0.5 block text-sm text-ex-soft">
                    {examSize(paper)} ข้อ{paper.topics.length > 1 ? ` · ${paper.topics.length} หัวข้อ` : ''}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-ex-accent">เริ่มทำ →</span>
              </Link>
            </li>
          ))}
        </ul>

        <section className="exam-card mt-8 p-5 sm:p-6">
          <h2 className="font-semibold">สร้างข้อสอบของคุณเอง</h2>
          <p className="mt-1 text-sm leading-relaxed text-ex-muted">
            ให้ AI ออกข้อสอบจากเอกสาร เลือกหัวข้อจากคลังความรู้ Pika นำเข้าคลังข้อสอบจาก Excel หรือเขียนเองทีละข้อ ทุกวิธีได้ข้อสอบพร้อมเฉลยและคำอธิบาย
            และถ้าเข้าสู่ระบบอยู่ ส่งลิงก์ข้อสอบให้คนอื่นทำได้โดยไม่ต้องมีบัญชี
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/create" className="exam-btn exam-btn-primary">
              เลือกวิธีสร้างข้อสอบ
            </Link>
            <Link href="/host" className="exam-btn">
              ไปที่เกมของฉัน
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
