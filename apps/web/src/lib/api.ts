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

/** the headers `api` sends with a request that changes something, for a caller that reads the answer itself */
export function mutationHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'x-ib-req': '1', 'content-type': 'application/json' };
  if (pageUser) headers['x-ib-user'] = pageUser;
  return headers;
}

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

/**
 * Sends a form with a file in it. Same headers as `api` except the content type, which the browser
 * writes itself so the multipart boundary is right.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = { 'x-ib-req': '1' };
  if (pageUser) headers['x-ib-user'] = pageUser;
  let res: Response;
  try {
    res = await fetch(withBase(`/api${path}`), { method: 'POST', headers, body: form, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // a proxy that refuses a big body answers in HTML, without our error field
  if (!res.ok) throw new ApiError(res.status, typeof data.error === 'string' ? data.error : res.status === 413 ? 'file_too_big' : 'server_error', data);
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
  no_exam_questions: 'เกมนี้ยังไม่มีคำถามแบบเลือกตอบที่มีเฉลย (ควิซ หรือ จริง/เท็จ) จึงทำเป็นข้อสอบไม่ได้',
  own_entry:'รายงานเกมของตัวเองไม่ได้ ถ้าต้องการเอาออก กด “ถอนออก” แทน',
  too_large: 'เกมนี้ใหญ่เกินไป',
  too_long: 'มีข้อความบางช่องยาวเกินกว่าที่บันทึกได้ (เช่น ลิงก์รูปยาวเกิน 4096 ตัวอักษร) แก้ให้สั้นลงแล้วระบบจะบันทึกให้เอง',
  bad_name: 'ชื่อต้องยาว 2–40 ตัวอักษร',
  bad_login: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  too_many_tries: 'ใส่รหัสผ่านผิดหลายครั้งเกินไป รอ 15 นาทีแล้วลองใหม่',
  busy: 'ระบบกำลังมีคนเข้าใช้มาก รอสักครู่แล้วลองใหม่',
  account_disabled: 'บัญชีนี้ถูกปิดใช้งาน ติดต่อผู้ดูแลระบบ',
  forbidden: 'คำขอถูกปฏิเสธ ลองรีเฟรชหน้านี้แล้วทำใหม่',
  rate_limited: 'ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่',
  pika_off: 'เครื่องนี้ยังไม่ได้ตั้งค่าให้ต่อกับคลังความรู้ Pika ติดต่อผู้ดูแลระบบ',
  pika_unreachable: 'ต่อกับคลังความรู้ Pika ไม่ได้ตอนนี้ ลองใหม่อีกครั้ง',
  pika_denied: 'คลังความรู้ Pika ไม่ยอมให้เข้าถึงโปรเจกต์นี้ ติดต่อผู้ดูแลระบบเพื่อออกคีย์ใหม่',
  pika_not_found: 'ไม่พบหน้านี้ในคลังความรู้ Pika แล้ว อาจถูกลบไป ลองค้นใหม่',
  pika_busy: 'คลังความรู้ Pika กำลังมีคนใช้มาก รอสักครู่แล้วลองใหม่',
  pika_failed: 'คลังความรู้ Pika ตอบกลับมาผิดปกติ ลองใหม่อีกครั้ง',
  no_email: 'บัญชีนี้ยังไม่มีอีเมล จึงสร้างโปรเจกต์ใน Pika ไม่ได้ ติดต่อผู้ดูแลระบบให้เพิ่มอีเมลให้ก่อน',
  no_project: 'ยังไม่มีโปรเจกต์ใน Pika สำหรับบัญชีนี้ กดสร้างก่อนหนึ่งครั้ง',
  no_facts: 'หน้าที่เลือกยังไม่มีข้อความที่ตั้งเป็นคำถามได้ ลองเลือกหน้าอื่นเพิ่ม',
  too_many_pages: 'เลือกได้ครั้งละไม่เกิน 10 หน้า',
  no_pages: 'เลือกหน้าจากคลังความรู้ก่อนอย่างน้อยหนึ่งหน้า',
  bad_query: 'พิมพ์คำค้นอย่างน้อย 2 ตัวอักษร',
  file_too_big: 'ไฟล์ใหญ่เกิน 20 MB แบ่งไฟล์ให้เล็กลง หรือคัดลอกเฉพาะเนื้อหามาวางแทน',
  file_type: 'อัปโหลดได้เฉพาะไฟล์ .pdf .docx .pptx .xlsx .txt .md หรือ .csv',
  empty_file: 'ไฟล์นี้ว่างเปล่า ลองเลือกไฟล์อื่น',
  no_file: 'ยังไม่ได้เลือกไฟล์',
  bad_form: 'ส่งไฟล์ไม่สำเร็จ ลองเลือกไฟล์ใหม่อีกครั้ง',
  form_required: 'ส่งไฟล์ไม่สำเร็จ ลองเลือกไฟล์ใหม่อีกครั้ง',
  bad_request: 'คำขอไม่ถูกต้อง รีเฟรชหน้านี้แล้วลองใหม่',
  pika_rejected: 'คลังความรู้ Pika อ่านไฟล์นี้ไม่ได้ ลองบันทึกเป็น PDF หรือคัดลอกเนื้อหามาวางแทน',
  ingest_quota: 'เพิ่มเอกสารครบ 20 ชิ้นในชั่วโมงนี้แล้ว รอสักพักแล้วค่อยเพิ่มต่อ',
  ingest_busy: 'กำลังส่งเอกสารอยู่ 2 ชิ้นแล้ว รอให้ชิ้นก่อนส่งเสร็จก่อน',
  no_title: 'ตั้งชื่อเอกสารก่อน',
  text_too_short: 'ข้อความสั้นเกินไป วางเนื้อหาอย่างน้อย 200 ตัวอักษร',
  text_too_long: 'ข้อความยาวเกิน 200,000 ตัวอักษร แบ่งเป็นหลายครั้ง หรือบันทึกเป็นไฟล์แล้วอัปโหลดแทน',
};

/** A sentence for the person, in Thai. */
export const apiMessage = (e: unknown) => MESSAGES[errorCode(e)] ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
