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

  if (!state) return <Connecting label="กำลังเชื่อมต่อจอแสดงผล" />;

  return <StageView state={state} join={join} sound={sound} online={online} />;
}
