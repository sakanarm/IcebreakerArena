'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { stopConfetti } from '@/lib/confetti';
import { getSocket } from '@/lib/socket';
import { keys } from '@/lib/storage';
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

  if (status === 'not_found' || status === 'closed') {
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
        ห้อง {pin} ไม่มีอยู่แล้ว (ห้องจะปิดเองเมื่อไม่มีการใช้งานนาน หรือเซิร์ฟเวอร์ถูกรีสตาร์ต)
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
      <HostDock state={state} onReport={openReport} blocked={reportOpen} />
      <ReportView open={reportOpen} onClose={closeReport} />
    </>
  );
}
