import { withBase } from './paths';

/** A refusal from our API: `code` is the server's `error` field, `data` the rest of the body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

let pageUser: string | null = null;
/** The account this page acts for (lib/account sets it). Requests carry it, so a login in another tab can't redirect them. */
export const setPageUser = (id: string | null) => {
  pageUser = id;
};

/**
 * Calls the web app's own API. Requests that change something carry X-IB-Req, which the server
 * requires (a form or another site can't send it). Network failures become ApiError 'offline'.
 */
export async function api<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-ib-req'] = '1';
  if (pageUser) headers['x-ib-user'] = pageUser;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(withBase(`/api${path}`), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, typeof data.error === 'string' ? data.error : 'server_error', data);
  return data as T;
}

export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : 'offline');

const MESSAGES: Record<string, string> = {
  offline: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจว่าต่อ Wi-Fi บริษัทหรือ VPN อยู่ แล้วลองใหม่',
  login_required: 'หมดเวลาเข้าสู่ระบบแล้ว เข้าสู่ระบบอีกครั้งแล้วลองใหม่',
  wrong_user: 'เบราว์เซอร์นี้เข้าสู่ระบบเป็นบัญชีอื่นจากอีกแท็บ โหลดหน้านี้ใหม่ หรือกลับไปเข้าสู่ระบบด้วยบัญชีเดิม',
  db_unavailable: 'ระบบบัญชียังไม่พร้อมใช้งาน (ยังไม่ได้ตั้งค่าฐานข้อมูล)',
  not_found: 'ไม่พบเกมนี้ อาจถูกลบหรือถอนออกไปแล้ว',
  too_many_games: 'บัญชีนี้มีเกมครบ 300 เกมแล้ว ลบเกมที่ไม่ใช้ก่อน',
  tainted: 'เกมนี้สร้างจากข้อมูลภายใน จึงแชร์เข้าคลังกลางไม่ได้',
  under_review: 'เกมนี้ถูกรายงานและซ่อนไว้รอตรวจ แชร์ซ้ำได้หลังตรวจเสร็จ',
  too_many: 'คุณแชร์ไว้ในคลังกลางครบ 50 เกมแล้ว ถอนเกมเก่าออกก่อน',
  invalid_game: 'เกมยังไม่สมบูรณ์ แก้ให้ครบก่อนแชร์',
  own_entry: 'รายงานเกมของตัวเองไม่ได้ ถ้าต้องการเอาออก กด “ถอนออก” แทน',
  too_large: 'เกมนี้ใหญ่เกินไป',
  too_long: 'มีข้อความบางช่องยาวเกินกว่าที่บันทึกได้ (เช่น ลิงก์รูปยาวเกิน 4096 ตัวอักษร) แก้ให้สั้นลงแล้วระบบจะบันทึกให้เอง',
  bad_name: 'ชื่อต้องยาว 2–40 ตัวอักษร',
  forbidden: 'คำขอถูกปฏิเสธ ลองรีเฟรชหน้านี้แล้วทำใหม่',
  rate_limited: 'ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่',
};

/** A sentence for the person, in Thai. */
export const apiMessage = (e: unknown) => MESSAGES[errorCode(e)] ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
