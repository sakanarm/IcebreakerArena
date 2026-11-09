/**
 * Reading a page out of the knowledge base.
 *
 * Every page Pika writes has the same three parts: a `## Summary` paragraph, a `## Details`
 * list where **each bullet is one fact and ends with the `[[document]]` it came from**, and a
 * `## Related` list of neighbouring pages. So one bullet becomes one question plus its source
 * with nothing to guess, which is why the quiz maker reads bullets and not prose.
 *
 * Nothing here knows about Pika's API: it takes markdown and gives back facts, so it can be
 * tested on its own and reused for any page that is written this way.
 */

/** One bullet from a page: the fact, and the document the page itself cites for it. */
export interface WikiFact {
  /** the sentence, with the citation and markdown taken off */
  text: string;
  /** what the bullet ended with, without the brackets, e.g. `sources/2026-10-20-notes.md` */
  cite?: string;
}

export interface WikiPage {
  /** the `## Summary` paragraph: context for a reader, never a question on its own */
  summary: string;
  /** the `## Details` bullets, in the order the page lists them */
  facts: WikiFact[];
  /** page paths the `## Related` list points at, for suggesting more to read */
  related: string[];
}

type Section = 'summary' | 'details' | 'related' | 'other';

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)(?:[-*+]|\d{1,2}[.)])\s+(.*)$/;
const CITE = /\[\[([^\]\n]+)\]\]/g;

function sectionOf(heading: string): Section {
  const h = heading.toLowerCase();
  if (h.includes('summary') || h.includes('สรุป') || h.includes('ภาพรวม')) return 'summary';
  if (h.includes('detail') || h.includes('รายละเอียด') || h.includes('ข้อเท็จจริง')) return 'details';
  if (h.includes('related') || h.includes('เกี่ยวข้อง') || h.includes('อ้างอิง')) return 'related';
  return 'other';
}

/** Markdown a reader never sees, and the spacing left behind once it is gone. */
function plain(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // a markdown link keeps its words and loses its url
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,–—-]+|[\s:;,–—-]+$/g, '')
    .trim();
}

/**
 * The facts a page states, the paragraph above them, and the pages it points at.
 * Written to be forgiving: a page with no headings still gives up its bullets, since a page
 * that parses to nothing looks exactly like a page with nothing in it.
 */
export function parseWikiPage(markdown: string): WikiPage {
  const lines = String(markdown ?? '').split(/\r?\n/);
  let section: Section = 'other';
  const summary: string[] = [];
  const facts: WikiFact[] = [];
  const related: string[] = [];
  /** the bullet still being read, so a wrapped line joins the line above instead of starting a fact */
  let open: { section: Section; indent: number; raw: string } | null = null;

  const close = () => {
    if (!open) return;
    const { raw } = open;
    const cites = [...raw.matchAll(CITE)].map((m) => m[1].trim()).filter(Boolean);
    const text = plain(raw.replace(CITE, ' '));
    if (open.section === 'related') related.push(...(cites.length ? cites : text ? [text] : []));
    else if (text) facts.push({ text, ...(cites[0] ? { cite: cites[0] } : {}) });
    open = null;
  };

  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      section = sectionOf(heading[1]);
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      // a nested bullet is part of the fact above it, not a fact of its own
      if (open && bullet[1].length > open.indent) open.raw += ` ${bullet[2]}`;
      else {
        close();
        open = { section, indent: bullet[1].length, raw: bullet[2] };
      }
      continue;
    }
    if (!line.trim()) {
      close();
      continue;
    }
    if (open) open.raw += ` ${line.trim()}`;
    else if (section === 'summary' || (section === 'other' && !summary.length && !facts.length)) summary.push(line.trim());
  }
  close();

  return { summary: plain(summary.join(' ')), facts, related };
}

/** Why a fact cannot be used, in the words the review screen shows. */
export type FactSkip = 'short' | 'contact' | 'duplicate' | 'long' | 'per-page';

export const SKIP_REASON: Record<FactSkip, string> = {
  short: 'สั้นเกินกว่าจะตั้งเป็นคำถาม',
  contact: 'มีข้อมูลติดต่อ (อีเมลหรือเบอร์โทร)',
  duplicate: 'ซ้ำกับข้อที่เลือกไว้แล้ว',
  long: 'ยาวเกินกว่าที่คำถามหนึ่งข้อรับได้',
  'per-page': 'เกินโควตาของหน้านี้ (หน้าละ 3 ข้อ) เพื่อให้คำถามกระจายทั่วทุกหน้า',
};

/** A fact shorter than this is a label or a heading, not something anyone can be asked about. */
export const FACT_MIN_CHARS = 20;

/** A fact longer than this cannot fit a question prompt even before the words that frame it. */
export const FACT_MAX_CHARS = 170;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:โทร|เบอร์|มือถือ|tel|phone)\W{0,3}\+?\d[\d\s-]{6,}/i;
const BARE_PHONE = /(?:^|\D)0\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}(?:\D|$)/;

/** Contact details never go into a game, and never leave for a model: they are about a person, not a subject. */
export const hasContactInfo = (text: string) => EMAIL.test(text) || PHONE.test(text) || BARE_PHONE.test(text);

/** Two facts are the same when what is left after punctuation and spacing matches. */
export const factKey = (text: string) => text.toLowerCase().replace(/[\s​.,;:!?()"'“”‘’\-–—]/g, '');
