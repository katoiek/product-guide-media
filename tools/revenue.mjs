#!/usr/bin/env node
// 取り込んだ収益データから、次に何を書くかの判断材料を出す。
//
//   node tools/revenue.mjs                 直近月の内訳と提案
//   node tools/revenue.mjs --all           月ごとの推移も出す
//   node tools/revenue.mjs --write-rank    順位・ランクだけを queue.json に書く（金額は書かない）
//
// リポジトリは公開設定のため、金額は content/pipeline/revenue/ に置いたまま外に出さない。
// queue.json に入れるのは revenueRank と revenueTier だけ。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readJson, loadQueue, saveQueue, today } from './lib/pipeline.mjs';

const STORE = join(ROOT, 'content', 'pipeline', 'revenue', 'earnings.json');
const args = process.argv.slice(2);

if (!existsSync(STORE)) {
  console.log(
    '収益データがありません。\n\n' +
    '  1. アソシエイト・セントラル → レポート → ダウンロード でCSVを取得\n' +
    '  2. node tools/import-earnings.mjs <report.csv> --month YYYY-MM\n'
  );
  process.exit(0);
}

const store = readJson(STORE);
const months = Object.keys(store.months).sort();
if (!months.length) {
  console.log('取り込み済みの月がありません。');
  process.exit(0);
}
const latest = months[months.length - 1];
const cur = store.months[latest];
const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;

console.log(`=== ${latest} の実績（取り込み: ${cur.importedAt}）===`);
console.log(`合計 ${cur.totals.qty}点 / ${yen(cur.totals.earnings)}\n`);

const linked = cur.articles.reduce((s, a) => s + a.earnings, 0);
const unlinked = cur.unlinkedProducts.reduce((s, o) => s + o.earnings, 0);
const pct = (n) => (cur.totals.earnings ? Math.round((n / cur.totals.earnings) * 100) : 0);
console.log(`記事の商品リンク経由 ${yen(linked)}（${pct(linked)}%）`);
console.log(`リンクしていない商品 ${yen(unlinked)}（${pct(unlinked)}%）`);

console.log(`\n--- 記事別 ---`);
if (!cur.articles.length) {
  console.log('  まだ成果がありません。');
} else {
  for (const [i, a] of cur.articles.entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${a.slug.padEnd(40)} ${String(a.qty).padStart(4)}点  ${yen(a.earnings)}`);
    const top = Object.entries(a.asins).sort((x, y) => y[1].earnings - x[1].earnings).slice(0, 3);
    for (const [asin, v] of top) {
      const mark = v.kind === 'related' ? '関連' : '比較';
      console.log(`        ${mark} ${asin} ${String(v.qty).padStart(3)}点 ${yen(v.earnings).padStart(9)}  ${v.title.slice(0, 34)}`);
    }
  }
}

if (args.includes('--all') && months.length > 1) {
  console.log(`\n--- 月次推移 ---`);
  for (const m of months) {
    const t = store.months[m].totals;
    console.log(`  ${m}  ${String(t.qty).padStart(4)}点  ${yen(t.earnings).padStart(10)}`);
  }
}

// --- 次に何を書くかの提案 ---
console.log(`\n--- 次のテーマの手がかり ---`);

const queue = loadQueue();
const published = queue.items.filter((i) => i.type === 'comparison' && i.state === 'published');
const earning = new Set(cur.articles.filter((a) => a.earnings > 0).map((a) => a.slug));

const dead = published.filter((i) => !earning.has(i.slug));
if (dead.length) {
  console.log(`\n成果が出ていない公開記事 ${dead.length} 件`);
  for (const d of dead) console.log(`  ${d.slug}（${d.category ?? ''}）`);
  console.log('  → 検索順位が立ち上がっていないか、比較軸が読者の判断と合っていない可能性があります。');
  console.log('     公開から日が浅いなら様子を見てください。3か月以上経っていれば見直しの対象です。');
}

// 稼いでいる記事のカテゴリは、隣接テーマも当たりやすい
const catEarn = new Map();
for (const a of cur.articles) {
  const item = queue.items.find((i) => i.slug === a.slug);
  const cat = item?.category ?? '不明';
  catEarn.set(cat, (catEarn.get(cat) ?? 0) + a.earnings);
}
const cats = [...catEarn.entries()].sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0);
if (cats.length) {
  console.log(`\nカテゴリ別の成果`);
  for (const [c, v] of cats) console.log(`  ${c.padEnd(12)} ${yen(v)}`);
  console.log(`  → 上位カテゴリの隣接テーマを優先すると当たりやすくなります。`);
}

// リンクしていない商品は、読者が実際に買ったもの。テーマの候補として強い。
const hints = cur.unlinkedProducts.filter((o) => o.qty > 0).slice(0, 10);
if (hints.length) {
  console.log(`\n読者が買ったがリンクしていない商品（上位${hints.length}件）`);
  for (const o of hints) {
    console.log(`  ${String(o.qty).padStart(3)}点 ${yen(o.earnings).padStart(9)}  ${o.title.slice(0, 44) || o.asin}`);
  }
  console.log(`  → このジャンルに比較記事が無ければ、次のテーマの有力候補です。`);
}

// --- 順位だけをキューへ書き戻す（金額は書かない） ---
if (args.includes('--write-rank')) {
  const ranked = cur.articles.filter((a) => a.earnings > 0);
  const max = ranked[0]?.earnings ?? 0;
  for (const item of queue.items) {
    delete item.revenueRank;
    delete item.revenueTier;
  }
  ranked.forEach((a, i) => {
    const item = queue.items.find((x) => x.slug === a.slug);
    if (!item) return;
    const ratio = max ? a.earnings / max : 0;
    item.revenueRank = i + 1;
    item.revenueTier = ratio >= 0.5 ? 'high' : ratio >= 0.15 ? 'mid' : 'low';
  });
  for (const item of published) {
    if (!earning.has(item.slug)) item.revenueTier = 'none';
  }
  queue.revenueSignal = {
    updated: today(),
    basedOn: latest,
    note: 'リポジトリが公開のため金額は保存しない。順位(revenueRank)と区分(revenueTier)のみ。金額は content/pipeline/revenue/ にローカル保存され .gitignore 済み。',
  };
  queue.updated = today();
  saveQueue(queue);
  console.log(`\nqueue.json に順位を書きました（金額は書いていません）。`);
}
