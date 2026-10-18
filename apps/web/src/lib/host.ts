import type { Game } from '@icebreaker/shared';
import { dropBlankOptions } from './games';
import { BASE_PATH } from './paths';
import { getSocket } from './socket';
import { keys, save } from './storage';

export type CreateRoomResult = { ok: true; pin: string } | { ok: false; message: string };

// behind a reverse proxy the port means nothing to the Host; on a laptop it is the usual cause
const SERVER_DOWN = BASE_PATH
  ? 'เชื่อมต่อเกมเซิร์ฟเวอร์ไม่ได้ รอสักครู่แล้วลองใหม่อีกครั้ง'
  : 'เชื่อมต่อเกมเซิร์ฟเวอร์ไม่ได้ ตรวจว่าเซิร์ฟเวอร์ (พอร์ต 4000) ทำงานอยู่';

/** Opens a live room for a game and keeps the host token, so a refresh stays the Host. */
export async function createRoom(game: Game): Promise<CreateRoomResult> {
  try {
    const res = await getSocket().timeout(8000).emitWithAck('host:create', { game: dropBlankOptions(game) });
    if (res.ok) {
      save(keys.hostToken(res.pin), res.hostToken);
      return { ok: true, pin: res.pin };
    }
    if (res.error === 'invalid_game') return { ok: false, message: res.message ?? 'เกมนี้ยังไม่สมบูรณ์' };
    if (res.error === 'rate_limited') return { ok: false, message: 'สร้างห้องถี่เกินไป รอสักครู่แล้วลองใหม่' };
    return { ok: false, message: 'สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง' };
  } catch {
    return { ok: false, message: SERVER_DOWN };
  }
}
