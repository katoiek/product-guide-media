#!/usr/bin/env node
// 仕様データから、ASIN 記入用の TSV テンプレートを作る。
// 人が Amazon で各製品を探し、ASIN と商品画像URLを埋めて ingest-sitestripe.mjs に渡す。
//
//   node tools/make-asin-sheet.mjs <slug>          既定の出力先へ書く
//   node tools/make-asin-sheet.mjs <slug> -        標準出力へ
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSpec, ROOT } from './lib/pipeline.mjs';

const [, , slug, dest] = process.argv;
if (!slug) {
  console.error('用法: make-asin-sheet.mjs <slug> [-]');
  process.exit(2);
}

const spec = loadSpec(slug);
if (!spec) {
  console.error(`仕様データが見つかりません: content/pipeline/specs/${slug}.json`);
  process.exit(2);
}

const rows = [];
rows.push(`# ${spec.title}`);
rows.push('#');
rows.push('# 各製品を Amazon.co.jp で探し、商品ページURLの /dp/ の直後にある10桁の英数字（ASIN）を');
rows.push('# 2列目に貼ってください。3列目は商品画像URL（省略可。SiteStripeの画像リンクから取得）。');
rows.push('# 例: https://www.amazon.co.jp/dp/B08XYZ1234/  →  ASIN は B08XYZ1234');
rows.push('#');
rows.push('# 注意: メーカー名と容量まで一致する商品を選んでください。');
rows.push('#       容量違い・詰め替え・並行輸入・セット品は別商品です。');
rows.push('# 記入できない製品は行ごと削除せず、ASIN欄を空のままにしてください。');
rows.push('#');
rows.push('# 製品名\tASIN\t商品画像URL');

const line = (name, brand) => `${brand}｜${name}\t\t`;

rows.push('#');
rows.push('# --- 比較対象 ---');
for (const p of spec.products ?? []) rows.push(line(p.name, p.brand));

if (spec.relatedProducts?.length) {
  rows.push('#');
  rows.push('# --- 関連消耗品（同時に買われやすいもの。ブランド指定なし、代表的な商品でよい）---');
  for (const r of spec.relatedProducts) rows.push(`${r.name}\t\t`);
}

const out = rows.join('\n') + '\n';

if (dest === '-') {
  process.stdout.write(out);
} else {
  const dir = join(ROOT, 'content', 'pipeline', 'asin-input');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.tsv`);
  writeFileSync(path, out, 'utf8');
  console.log(`${path} を作成しました。`);
  console.log(`比較対象 ${spec.products?.length ?? 0} 件 / 関連消耗品 ${spec.relatedProducts?.length ?? 0} 件`);
}
