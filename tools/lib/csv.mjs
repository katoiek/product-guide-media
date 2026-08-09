// Amazonアソシエイトのレポート取り込み用CSVユーティリティ。
// 日本のレポートは Shift_JIS で出力されることがあるため、文字コードを判定して読む。
import { readFileSync } from 'node:fs';

/** BOM・文字化けの有無から UTF-8 か Shift_JIS かを判定して文字列にする。 */
export function readCsvText(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8 (BOM)' };
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // U+FFFD が混ざる場合は UTF-8 として不正。Shift_JIS を試す。
  if (!utf8.includes('�')) return { text: utf8, encoding: 'utf-8' };
  try {
    return { text: new TextDecoder('shift_jis').decode(buf), encoding: 'shift_jis' };
  } catch {
    return { text: utf8, encoding: 'utf-8 (一部読めない文字あり)' };
  }
}

/** 引用符・改行を含むセルに対応したCSVパーサ。行の配列を返す。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n') {
      row.push(cur); cur = '';
      if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim()));
      row = [];
    } else if (ch !== '\r') {
      cur += ch;
    }
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim()));
  return rows;
}

/**
 * ヘッダ行を探す。Amazonのレポートは先頭に説明行が入ることがあるため、
 * 目印になる列名を最も多く含む行をヘッダとみなす。
 */
export function findHeader(rows, hints) {
  let best = { index: -1, score: 0 };
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map((c) => c.toLowerCase());
    const score = hints.filter((h) => cells.some((c) => c.includes(h.toLowerCase()))).length;
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

/** 列名の候補リストから、実際のヘッダに存在する列の添字を返す。 */
export function columnIndex(header, aliases) {
  const norm = (s) => s.replace(/[\s"'（）()]/g, '').toLowerCase();
  const cells = header.map(norm);
  for (const a of aliases) {
    const key = norm(a);
    const exact = cells.indexOf(key);
    if (exact >= 0) return exact;
  }
  for (const a of aliases) {
    const key = norm(a);
    const partial = cells.findIndex((c) => c.includes(key));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** 「1,234」「¥1,234」「1234.5」などを数値にする。 */
export function toNumber(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
