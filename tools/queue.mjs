#!/usr/bin/env node
// 記事パイプラインのキュー操作。
//   node tools/queue.mjs status
//   node tools/queue.mjs next
//   node tools/queue.mjs set <slug> <state> "備考"
//   node tools/queue.mjs add <slug> "<タイトル>" "<カテゴリ>" <categorySlug>
import { existsSync } from 'node:fs';
import { loadQueue, saveQueue, specPath, productsPath, pinterestPath, articlePath, today } from './lib/pipeline.mjs';

// 各状態で次に動くエージェントと、そこを抜ける条件。
const FLOW = {
  idea:           { agent: 'erabi-topic-scout',     exit: '比較単位が成立（異なる5〜7ブランド）し、禁止ジャンルでないと確認できたら spec_research へ' },
  spec_research:  { agent: 'erabi-spec-researcher', exit: 'メーカー公式ページのみを根拠に全製品の仕様JSONが揃ったら assets_pending へ' },
  assets_pending: { agent: 'erabi-asset-broker',    exit: '全製品のASIN・直接リンク・許諾済み画像が揃い validate-products が通ったら drafting へ' },
  drafting:       { agent: 'erabi-article-writer',  exit: '記事(.astro)とトップページ・sitemap導線を書いたら gate へ' },
  gate:           { agent: 'erabi-publish-gate',    exit: 'validate + build が全て通り push できたら distribution へ（不合格なら差し戻し）' },
  distribution:   { agent: 'erabi-pinterest-scout',  exit: 'Pinterest投稿案10本を生成したら published へ' },
  published:      { agent: '—',                     exit: '公開済み。仕様変更の再確認のみ' },
  blocked:        { agent: '（人の判断）',           exit: 'blockedReason を解消して該当状態へ差し戻す' },
};

const ORDER = ['gate', 'distribution', 'drafting', 'assets_pending', 'spec_research', 'idea', 'blocked', 'published'];

const artifacts = (item) => {
  const s = item.slug;
  return [
    existsSync(specPath(s)) ? 'spec' : null,
    existsSync(productsPath(s)) ? 'products' : null,
    existsSync(articlePath(s)) ? 'article' : null,
    existsSync(pinterestPath(s)) ? 'pins' : null,
  ].filter(Boolean).join(',') || '—';
};

const cmd = process.argv[2] ?? 'status';
const queue = loadQueue();

if (cmd === 'status') {
  const rows = [...queue.items].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
  console.log(`キュー ${rows.length} 件（更新: ${queue.updated}）\n`);
  const pad = (s, n) => String(s).padEnd(n, ' ');
  console.log(pad('STATE', 16) + pad('SLUG', 42) + pad('担当', 22) + '成果物');
  console.log('-'.repeat(98));
  for (const it of rows) {
    console.log(pad(it.state, 16) + pad(it.slug, 42) + pad(FLOW[it.state]?.agent ?? '?', 22) + artifacts(it));
    const memo = it.blockedReason ?? it.note;
    if (memo) console.log(`${' '.repeat(16)}└ ${memo}`);
  }
} else if (cmd === 'next') {
  const rows = [...queue.items]
    .filter((i) => i.state !== 'published')
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
  if (!rows.length) {
    console.log('着手可能な案件はありません。');
    process.exit(0);
  }
  const it = rows[0];
  console.log(JSON.stringify({ ...it, agent: FLOW[it.state]?.agent, exitCriteria: FLOW[it.state]?.exit }, null, 2));
} else if (cmd === 'set') {
  const [, , , slug, state, note] = process.argv;
  if (!slug || !state) { console.error('用法: queue.mjs set <slug> <state> "備考"'); process.exit(2); }
  if (!queue.states.includes(state)) { console.error(`未知の状態: ${state}（${queue.states.join('|')}）`); process.exit(2); }
  const it = queue.items.find((i) => i.slug === slug);
  if (!it) { console.error(`slug が見つかりません: ${slug}`); process.exit(2); }
  it.state = state;
  if (state === 'blocked') it.blockedReason = note ?? '理由未記入';
  else delete it.blockedReason;
  it.history.push({ date: today(), state, note: note ?? '' });
  queue.updated = today();
  saveQueue(queue);
  console.log(`${slug}: -> ${state}`);
} else if (cmd === 'add') {
  const [, , , slug, title, category, categorySlug] = process.argv;
  if (!slug || !title) { console.error('用法: queue.mjs add <slug> "<タイトル>" "<カテゴリ>" <categorySlug>'); process.exit(2); }
  if (queue.items.some((i) => i.slug === slug)) { console.error(`既に存在: ${slug}`); process.exit(2); }
  queue.items.push({
    slug, title, category: category ?? '', categorySlug: categorySlug ?? '',
    state: 'idea',
    specFile: `content/pipeline/specs/${slug}.json`,
    productsFile: `content/pipeline/products/${slug}.json`,
    articleFile: `src/pages/articles/${slug}.astro`,
    history: [{ date: today(), state: 'idea', note: '新規登録' }],
  });
  queue.updated = today();
  saveQueue(queue);
  console.log(`${slug} を idea として登録しました。`);
} else {
  console.error(`未知のコマンド: ${cmd}（status | next | set | add）`);
  process.exit(2);
}
