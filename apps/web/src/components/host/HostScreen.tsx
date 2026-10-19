'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { stopConfetti } from '@/lib/confetti';
import { getSocket } from '@/lib/socket';
import { keys, load, remove } from '@/lib/storage';
import { useSound } from '@/lib/use-sound';
import { useJoinUrl, useStage } from '@/lib/use-stage';
import { Connecting, Notice } from '../Notice';
import { StageView } from '../stage/StageView';
import { HostDock } from './HostDock';
import { ReportView } from './ReportView';

/** Host Console: the big screen plus the controls, on the device that created the room. */
export function HostScreen({ pin }: { pin: string }) {
  const { state, status, online } = useStage(pin, 'host');
  const join = useJoinUrl(pin);
  const sound = useSound(keys.hostSound, true);
  const [reportOpen, setReportOpen] = useState(false);
  const closeReport = useCallback(() => setReportOpen(false), []);
  const openReport = () => {
    stopConfetti(); // the podium's confetti would otherwise rain over the report
    setReportOpen(true);
  };
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const statusNow = useRef(status);
  statusNow.current = status;

  // without this a finished room stays open for two hours, holding the PIN and blocking a deploy
  const closeRoom = async () => {
    if (!confirm('ปิดห้องนี้เลยไหม?\nผู้เล่นทุกคนจะออกจากห้อง และเปิดรายงานของเกมนี้ไม่ได้อีก (ดูหรือดาวน์โหลดก่อนได้ที่ 📊 ดูรายงาน)')) return;
    stopConfetti();
    setClosing(true);
    try {
      const hostToken = load(keys.hostToken(pin), '');
      const res = await getSocket().timeout(8000).emitWithAck('host:close', { pin, hostToken });
      // room_not_found: already gone, after a try whose answer got lost or a server restart
      if (res.ok || res.error === 'room_not_found') {
        remove(keys.hostToken(pin));
        return router.replace('/host');
      }
    } catch {
      // no answer: fall through and let the Host try again
    }
    setClosing(false);
    // the room may have closed even though the answer got lost; the notice below says so
    if (statusNow.current === 'ready') alert('ปิดห้องไม่สำเร็จ ลองอีกครั้ง');
  };

  if (status === 'not_found' || status === 'closed') {
    // this page closed it, and is on its way to /host
    if (closing) return <Connecting label="กำลังปิดห้อง" />;
    return (
      <Notice
        emoji="🚪"
        title="ห้องนี้ปิดแล้ว"
        actions={
          <>
            <Link href="/host" className="btn btn-gold">
              สร้างห้องใหม่
            </Link>
            <Link href="/" className="btn btn-ghost">
              หน้าแรก
            </Link>
          </>
        }
      >
        ห้อง {pin} ไม่มีอยู่แล้ว (ผู้จัดกดปิดห้อง ห้องไม่มีการใช้งานนาน หรือเซิร์ฟเวอร์ถูกรีสตาร์ต)
      </Notice>
    );
  }

  if (status === 'not_allowed') {
    return (
      <Notice
        emoji="🔒"
        title="หน้านี้สำหรับผู้สร้างห้อง"
        actions={
          <>
            <Link href={`/stage/${pin}`} className="btn btn-gold">
              🖥️ เปิดเป็นจอแสดงผล
            </Link>
            <Link href="/" className="btn btn-ghost">
              หน้าแรก
            </Link>
          </>
        }
      >
        ปุ่มควบคุมเกมใช้ได้เฉพาะเบราว์เซอร์ที่สร้างห้อง {pin} ถ้าต้องการแค่แสดงผลบนโปรเจกเตอร์ ใช้โหมดจอแสดงผลได้เลย
      </Notice>
    );
  }

  if (!state) return <Connecting label="กำลังเปิดห้อง" />;

  const kick = (id: string, nickname: string) => {
    if (confirm(`นำ "${nickname}" ออกจากห้อง?`)) getSocket().emit('host:kick', id);
  };

  return (
    <>
      <StageView state={state} join={join} sound={sound} online={online} onKick={state.phase === 'lobby' ? kick : undefined} docked />
      <HostDock state={state} onReport={openReport} onClose={closeRoom} blocked={reportOpen || closing} />
      <ReportView open={reportOpen} onClose={closeReport} />
      {/* over the podium, not instead of it: if closing fails, the podium must not play all over again */}
      {closing && (
        <div className="fixed inset-0 z-50 bg-night/85">
          <Connecting label="กำลังปิดห้อง" />
        </div>
      )}
    </>
  );
}
