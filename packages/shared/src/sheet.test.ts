import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExam } from './exam';
import { SHEET_TEMPLATE, parseCsv, readSheets, sheetGames, type SheetIn } from './sheet';
import { LIMITS } from './validate';

const HEAD = ['หัวข้อ', 'คำถาม', 'ก', 'ข', 'ค', 'ง', 'คำตอบ', 'คำอธิบาย'];
const one = (rows: string[][], name = 'Sheet1'): SheetIn[] => [{ name, rows }];
const row = (prompt: string, opts: string[], answer: string, extra: { topic?: string; why?: string } = {}) => [
  extra.topic ?? '',
  prompt,
  ...[...opts, '', '', '', ''].slice(0, 4),
  answer,
  extra.why ?? '',
];

test('parseCsv: commas, quotes, doubled quotes, new lines in a cell, CRLF, BOM', () => {
  const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n1,,3';
  assert.deepEqual(parseCsv(text), [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'two\nlines'],
    ['1', '', '3'],
  ]);
});

test('parseCsv: tabs from a copy out of Excel, and semicolons from a European Excel', () => {
  assert.deepEqual(parseCsv('a\tb, c\n1\t2'), [
    ['a', 'b, c'],
    ['1', '2'],
  ]);
  assert.deepEqual(parseCsv('a;b;c\n1,5;2;3\n'), [
    ['a', 'b', 'c'],
    ['1,5', '2', '3'],
  ]);
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('only'), [['only']]);
});

test('the template reads back as the questions it shows', () => {
  const read = readSheets(one(SHEET_TEMPLATE));
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.notes, []);
  assert.equal(read.count, 4);
  assert.deepEqual(
    read.rounds.map((r) => [r.title, r.questions.length]),
    [
      ['ความปลอดภัย', 2],
      ['ทั่วไป', 2],
    ],
  );
  const [first] = read.rounds[0].questions;
  assert.equal(first.type, 'quiz');
  assert.deepEqual(first.correct, [2]);
  assert.equal(first.explanation, 'วลียาวที่คนอื่นเดาไม่ได้ เดาด้วยโปรแกรมก็ยาก');
  const tf = read.rounds[1].questions[1];
  assert.equal(tf.type, 'truefalse');
  assert.deepEqual(tf.options, ['จริง', 'เท็จ']);
  assert.deepEqual(tf.correct, [0]);
  assert.equal(tf.explanation, undefined);
  // and the game it makes is a paper the exam mode can set
  const made = sheetGames(read.rounds, { title: 'คลังทดสอบ' });
  assert.ok(made.ok);
  assert.equal(buildExam(made.games[0]).topics.flatMap((t) => t.questions).length, 4);
});

test('answers: Thai and Latin letters, numbers, "ข้อ ข", the option text, several at once', () => {
  const rows = [
    HEAD,
    row('q1', ['แดง', 'เขียว', 'ฟ้า', 'ดำ'], 'B'),
    row('q2', ['แดง', 'เขียว', 'ฟ้า', 'ดำ'], 'ข้อ ค.'),
    row('q3', ['แดง', 'เขียว', 'ฟ้า', 'ดำ'], '4'),
    row('q4', ['แดง', 'เขียว', 'ฟ้า', 'ดำ'], 'ฟ้า'),
    row('q5', ['แดง', 'เขียว', 'ฟ้า', 'ดำ'], 'ก, ค'),
    row('q6', ['แดง', 'เขียว', 'ฟ้า', 'ดำ'], 'A และ D'),
    row('q7', ['แดง', 'เขียว', 'ฟ้า', 'ดำ'], 'b d'),
    row('q8', ['แดง', 'เขียว', 'ฟ้า', 'ดำ'], '(ก)'),
    row('q9', ['Yes', 'No', 'Maybe', ''], 'maybe'),
  ];
  const read = readSheets(one(rows));
  assert.deepEqual(read.problems, []);
  assert.deepEqual(
    read.rounds[0].questions.map((q) => q.correct),
    [[1], [2], [3], [2], [0, 2], [0, 3], [1, 3], [0], [2]],
  );
});

test('answers that cannot be read are refused with the row number, not guessed', () => {
  const rows = [
    ['ชุดข้อสอบ ปี 2569'], // a title above the header
    [],
    HEAD,
    row('ข้อใดมากที่สุด', ['2', '4', '6', '8'], '4'), // the fourth option, or the option "4"?
    row('ข้อใดมากที่สุด', ['2', '4', '6', '8'], '8'), // the text only: fine
    row('ไม่มีคำตอบ', ['a', 'b'], ''),
    row('คำตอบไม่มีจริง', ['a', 'b', 'c'], 'z'),
    row('ชี้ไปที่ช่องว่าง', ['a', 'b', '', 'd'], 'ค'),
    row('ชี้ไปที่ช่องว่างในหลายคำตอบ', ['a', 'b', '', 'd'], 'ก, ค'),
  ];
  const read = readSheets(one(rows));
  assert.equal(read.count, 1);
  assert.deepEqual(read.rounds[0].questions[0].correct, [3]);
  assert.deepEqual(
    read.problems.map((p) => p.row),
    [4, 6, 7, 8, 9],
  );
  assert.match(read.problems[0].message, /กำกวม/);
  assert.match(read.problems[1].message, /ยังไม่ได้ใส่คำตอบ/);
  assert.match(read.problems[2].message, /อ่านคำตอบ “z” ไม่ออก/);
  assert.match(read.problems[3].message, /ตัวเลือกที่ 3 ซึ่งว่างอยู่/);
  assert.match(read.problems[4].message, /ตัวเลือกที่ 3 ซึ่งว่างอยู่/);
  assert.equal(read.problems[0].sheet, undefined);
});

test('a blank option column closes up, and the answer still points at the right option', () => {
  const read = readSheets(one([HEAD, row('q', ['a', '', 'c', 'd'], 'ง')]));
  const [q] = read.rounds[0].questions;
  assert.deepEqual(q.options, ['a', 'c', 'd']);
  assert.deepEqual(q.correct, [2]);
});

test('rows the game cannot hold are refused: too long, too few or too many options, the same option twice', () => {
  const head = [...HEAD, 'จ'];
  const rows = [
    head,
    [...row('x'.repeat(LIMITS.promptMax + 1), ['a', 'b'], 'ก')],
    [...row('one option', ['a'], 'ก')],
    [...row('five options', ['a', 'b', 'c', 'd'], 'ก'), 'e'],
    [...row('long option', ['a', 'y'.repeat(LIMITS.optionMax + 1)], 'ก')],
    [...row('twice', ['Same', 'same '], 'ก')],
    [...row('long why', ['a', 'b'], 'ก', { why: 'w'.repeat(LIMITS.explanationMax + 1) })],
    [...row('', ['a', 'b'], 'ก')],
    [...row('fine', ['a', 'b'], 'ก')],
  ];
  const read = readSheets(one(rows));
  assert.equal(read.count, 1);
  const messages = read.problems.map((p) => p.message);
  assert.equal(messages.length, 7);
  assert.match(messages[0], /คำถามยาว 201 ตัวอักษร เกิน 200/);
  assert.match(messages[1], /อย่างน้อย 2 ข้อ/);
  assert.match(messages[2], /มีตัวเลือก 5 ข้อ/);
  assert.match(messages[3], /ตัวเลือกที่ 2 ยาว 76/);
  assert.match(messages[4], /ตัวเลือกที่ 1 กับ 2 เหมือนกัน/);
  assert.match(messages[5], /คำอธิบายยาว 301/);
  assert.match(messages[6], /ยังไม่มีคำถาม/);
});

test('true/false by its words, in either order, with the answer said as a word or a letter', () => {
  const rows = [
    HEAD,
    row('a', ['ผิด', 'ถูก'], 'ถูก'),
    row('b', ['False', 'True'], 'TRUE'),
    row('c', ['เท็จ', 'จริง'], 'ก'),
    row('d', ['ใช่', 'ไม่ใช่'], 'ไม่ใช่'),
    row('e', ['ถูก', 'ถูกบางส่วน'], 'ข'), // not a true/false pair
  ];
  const qs = readSheets(one(rows)).rounds[0].questions;
  assert.deepEqual(
    qs.map((q) => [q.type, q.options, q.correct]),
    [
      ['truefalse', ['ถูก', 'ผิด'], [0]],
      ['truefalse', ['True', 'False'], [0]],
      ['truefalse', ['จริง', 'เท็จ'], [1]],
      ['truefalse', ['ใช่', 'ไม่ใช่'], [1]],
      ['quiz', ['ถูก', 'ถูกบางส่วน'], [1]],
    ],
  );
});

test('headers in English, other spellings, extra columns, and columns in any order', () => {
  const rows = [
    ['No.', 'Answer', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Explanation', 'Image', 'Time (sec)', 'Owner'],
    ['1', 'c', 'Capital of Japan?', 'Osaka', 'Kyoto', 'Tokyo', 'Nara', 'Since 1868', 'https://example.com/jp.png', '45', 'me'],
    ['2', 'a', 'Bad image', 'x', 'y', '', '', '', 'http://example.com/a.png', '', ''],
    ['3', 'a', 'Bad time', 'x', 'y', '', '', '', '', '300', ''],
  ];
  const read = readSheets(one(rows));
  assert.equal(read.count, 1);
  const [q] = read.rounds[0].questions;
  assert.equal(q.prompt, 'Capital of Japan?');
  assert.deepEqual(q.correct, [2]);
  assert.equal(q.imageUrl, 'https://example.com/jp.png');
  assert.equal(q.timeLimitS, 45);
  assert.equal(read.rounds[0].title, 'คำถามทั้งหมด');
  assert.deepEqual(
    read.problems.map((p) => p.row),
    [3, 4],
  );

  const thai = readSheets(one([['ข้อ', 'โจทย์', 'ตัวเลือกที่ 1', 'ตัวเลือกที่ 2', 'ตัวเลือกที่ 3', 'เฉลย', 'เหตุผล', 'เวลา (วินาที)'], ['1', 'q', 'x', 'y', 'z', '2', 'because', '10 วินาที']]));
  assert.deepEqual(thai.problems, []);
  assert.deepEqual(thai.rounds[0].questions[0].correct, [1]);
  assert.equal(thai.rounds[0].questions[0].timeLimitS, 10);

  const bare = readSheets(one([['คำถาม', 'ตัวเลือก', 'ตัวเลือก', 'ตัวเลือก', 'คำตอบ'], ['q', 'x', 'y', 'z', 'z']]));
  assert.deepEqual(bare.rounds[0].questions[0].options, ['x', 'y', 'z']);
  assert.deepEqual(bare.rounds[0].questions[0].correct, [2]);
});

test('topics carry down blank cells like a merged cell; untitled questions before any topic get a default round', () => {
  const rows = [HEAD, row('a', ['x', 'y'], 'ก'), row('b', ['x', 'y'], 'ก', { topic: 'บทที่ 1' }), row('c', ['x', 'y'], 'ก'), row('d', ['x', 'y'], 'ก', { topic: 'บทที่ 2' }), row('e', ['x', 'y'], 'ก', { topic: 'บทที่ 1' })];
  const read = readSheets(one(rows));
  assert.deepEqual(
    read.rounds.map((r) => [r.title, r.questions.map((q) => q.prompt).join('')]),
    [
      ['คำถามทั้งหมด', 'a'],
      ['บทที่ 1', 'bce'],
      ['บทที่ 2', 'd'],
    ],
  );
});

test('a workbook: each named sheet is a round, unusable sheets are noted, problems name their sheet', () => {
  const sheets: SheetIn[] = [
    { name: 'กฎหมาย', rows: [['คำถาม', 'ก', 'ข', 'คำตอบ'], ['q1', 'x', 'y', 'ก'], ['q2', 'x', 'y', '']] },
    { name: 'Sheet2', rows: [['คำถาม', 'ก', 'ข', 'คำตอบ'], ['q3', 'x', 'y', 'ข']] },
    { name: 'สรุป', rows: [['ยอดรวม', '12']] },
    { name: 'ไม่มีเฉลย', rows: [['คำถาม', 'ก', 'ข'], ['q', 'x', 'y']] },
    { name: 'ว่าง', rows: [[''], []] },
  ];
  const read = readSheets(sheets);
  assert.deepEqual(
    read.rounds.map((r) => [r.title, r.questions.length]),
    [
      ['กฎหมาย', 1],
      ['ชีต Sheet2', 1],
    ],
  );
  assert.deepEqual(read.problems, [{ sheet: 'กฎหมาย', row: 3, message: 'ยังไม่ได้ใส่คำตอบ' }]);
  assert.equal(read.notes.length, 2);
  assert.match(read.notes[0], /ชีต “สรุป”: ข้ามไป เพราะไม่พบแถวหัวตาราง/);
  assert.match(read.notes[1], /ชีต “ไม่มีเฉลย”: ข้ามไป เพราะไม่มีคอลัมน์คำตอบ/);
});

test('nothing usable says so', () => {
  assert.deepEqual(readSheets([]).notes, ['ไฟล์นี้ว่างเปล่า']);
  const headerOnly = readSheets(one([HEAD]));
  assert.equal(headerOnly.count, 0);
  assert.match(headerOnly.notes[0], /ยังไม่มีคำถามใต้หัวตาราง/);
  const made = sheetGames(headerOnly.rounds, { title: 'x' });
  assert.equal(made.ok, false);
});

test('sheetGames: a bank over one game splits into parts, rounds keep their titles, draw applies to big rounds', () => {
  const rows = [HEAD];
  for (let i = 0; i < 230; i++) rows.push(row(`q${i}`, ['x', 'y'], 'ก', { topic: i < 150 ? 'ใหญ่' : i < 225 ? 'กลาง' : 'เล็ก' }));
  const read = readSheets(one(rows));
  assert.equal(read.count, 230);
  const made = sheetGames(read.rounds, { title: 'คลัง', draw: 10 });
  assert.ok(made.ok);
  assert.deepEqual(
    made.games.map((g) => g.title),
    ['คลัง (ชุดที่ 1/3)', 'คลัง (ชุดที่ 2/3)', 'คลัง (ชุดที่ 3/3)'],
  );
  assert.deepEqual(
    made.games.map((g) => g.rounds.map((r) => [r.title, r.questions.length, r.draw])),
    [
      [['ใหญ่', 100, 10]],
      [
        ['ใหญ่', 50, 10],
        ['กลาง', 50, 10],
      ],
      [
        ['กลาง', 25, 10],
        ['เล็ก', 5, undefined],
      ],
    ],
  );
  const single = sheetGames(read.rounds.slice(2), { title: '  เดี่ยว  ' });
  assert.ok(single.ok);
  assert.equal(single.games[0].title, 'เดี่ยว');
  assert.equal(single.games[0].rounds[0].draw, undefined);
});

test('sheetGames: more than 20 topics starts a new part; a long title still fits with its part number', () => {
  const rows = [HEAD];
  for (let i = 0; i < 25; i++) rows.push(row(`q${i}`, ['x', 'y'], 'ก', { topic: `หัวข้อ ${i}` }));
  const made = sheetGames(readSheets(one(rows)).rounds, { title: 'ช'.repeat(200) });
  assert.ok(made.ok);
  assert.deepEqual(
    made.games.map((g) => g.rounds.length),
    [20, 5],
  );
  assert.ok(made.games.every((g) => g.title.length <= LIMITS.titleMax));
  assert.match(made.games[1].title, /\(ชุดที่ 2\/2\)$/);
  assert.deepEqual(sheetGames([], { title: 'x' }), { ok: false, errors: ['ยังไม่มีคำถามที่นำเข้าได้'] });
  const untitled = sheetGames(readSheets(one(rows.slice(0, 2))).rounds, { title: ' ' });
  assert.equal(untitled.ok, false);
});
