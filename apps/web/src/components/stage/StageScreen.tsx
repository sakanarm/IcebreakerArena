'use client';

import Link from 'next/link';
import { keys } from '@/lib/storage';
import { useSound } from '@/lib/use-sound';
import { useJoinUrl, useStage } from '@/lib/use-stage';
import { Connecting, Notice } from '../Notice';
import { StageView } from './StageView';

/** Read-only big screen for a projector or a second display; the Host controls the game. */
export function StageScreen({ pin }: { pin: string }) {
  const { state, status, online } = useStage(pin, 'stage');
  const join = useJoinUrl(pin);
  const sound = useSound(keys.stageSound, true);

  if (status === 'not_found' || status === 'closed') {
    return (
      <Notice
        emoji="🚪"
        title="ห้องนี้ปิดแล้ว"
        actions={
          <Link href="/" className="btn btn-gold">
            หน้าแรก
          </Link>
        }
      >
        ไม่พบห้อง {pin} หรือเกมจบไปแล้ว
      </Notice>
    );
  }

  // a PIN alone opens no big screen: someone typing /stage/<PIN> by hand, or a link cut off at the #
  if (status === 'not_allowed') {
    return (
      <Notice
        emoji="🔒"
        title="เปิดจอนี้ด้วยลิงก์จากผู้สร้างห้อง"
        actions={
          <Link href="/" className="btn btn-gold">
            หน้าแรก
          </Link>
        }
      >
        จอแสดงผลของห้อง {pin} เปิดได้จากปุ่ม 🖥️ จอแยก ในหน้าของผู้สร้างห้อง ถ้าจะเปิดบนเครื่องอื่น ให้ส่งลิงก์ของหน้านั้นมาทั้งลิงก์
        รวมส่วนท้ายหลังเครื่องหมาย #
      </Notice>
    );
  }

  if (!state) return <Connecting label="กำลังเชื่อมต่อจอแสดงผล" />;

  return <StageView state={state} join={join} sound={sound} online={online} />;
}
