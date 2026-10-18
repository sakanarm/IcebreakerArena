type Cell = string | number | null;

/** Excel only reads UTF-8 Thai correctly when the file starts with a BOM. */
const BOM = '﻿';

/**
 * Every cell is quoted, and text starting with = + - @ gets a leading ' so a
 * nickname like "=HYPERLINK(...)" stays text when the report opens in Excel.
 */
function cell(value: Cell): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
