---
name: erabi-pipeline
description: えらびノートのアフィリエイト記事パイプラインを1周回す。キューの状態を見て、企画→公式仕様調査→Amazon資産取得→執筆→公開ゲートの担当エージェントへ順に引き渡す。「パイプラインを回して」「記事を1本進めて」「自動で公開まで進めて」「キューを消化して」というときに使う。
---

# えらびノート パイプライン

キューを1件ずつ、進める限り進めます。**各工程は専任エージェントに委譲します。オーケストレータ自身が記事を書いたり ASIN を調べたりしません。**

## 状態機械

```
idea ──▶ spec_research ──▶ assets_pending ──▶ drafting ──▶ gate ──▶ published
  │            │                  │               │           │
  └────────────┴──────────────────┴───────────────┴───────────┴──▶ blocked
```

| state | 担当エージェント | 抜ける条件 |
| --- | --- | --- |
| `idea` | `erabi-topic-scout` | 異なる5〜7ブランドで比較単位が成立し、禁止ジャンルでない |
| `spec_research` | `erabi-spec-researcher` | 全製品の公式仕様と `officialUrl` が揃った |
| `assets_pending` | `erabi-asset-broker` | `validate-products.mjs` が PASS |
| `drafting` | `erabi-article-writer` | 記事 + index.astro + sitemap.xml を書き `validate-article.mjs` が PASS |
| `gate` | `erabi-publish-gate` | `gate.mjs` 全PASS → commit → push |
| `blocked` | — | 人の判断が必要。理由を報告して止まる |

## 手順

### 1. 現状を把握する

```
node tools/queue.mjs status
```

引数でテーマを指定された場合はその slug を、指定が無ければ `node tools/queue.mjs next` が返す最優先の1件を対象にする。

### 2. 担当エージェントへ委譲する

対象の `state` に対応するエージェントを Agent ツールで起動する。`subagent_type` に上表のエージェント名を渡し、prompt には**対象 slug と現在の state、期待する終了条件**を書く。

例:
```
subagent_type: erabi-spec-researcher
prompt: slug=kitchen-sponge-comparison の公式仕様調査を行い、content/pipeline/specs/kitchen-sponge-comparison.json を完成させてから queue の state を assets_pending へ進めてください。異なる5〜7メーカーの公式ページのみを根拠にしてください。
```

**同時に走らせてよいのは、別 slug を扱う場合だけ。** 同じ slug の工程は必ず直列にする。

### 3. 進んだか確認して次工程へ

エージェントの報告を鵜呑みにせず、必ず自分で確認する:

```
node tools/queue.mjs status
node tools/gate.mjs <slug> --no-build
```

state が進んでいれば 2 に戻り、次の工程のエージェントを起動する。`published` か `blocked` に達したら 4 へ。

**同じ state で2回連続して進まなかったら、そこで止める。** ループを回し続けない。`node tools/queue.mjs set <slug> blocked "<理由>"` にして報告する。

### 4. 報告する

- 進めた slug と、開始 state → 終了 state
- 各工程で行われたこと（製品数、ASIN 数、リンク・画像の有無）
- `blocked` になった場合の理由と、人がやるべき作業
- push した場合は commit ハッシュと本番URLのステータスコード

## 止める条件（重要）

次のいずれかに当たったら、**回避策を探さずに止めて人に報告する**:

- `content/pipeline/policy.json` を変更しないと通せない
- Amazon PA-API の認証情報が無く、SiteStripe での人手取得が必要
- 公式仕様が5社ぶん揃わない
- 禁止ジャンル（金融・転職・医療・法律・健康効果）の疑いが出た
- `git push` が失敗した、または `git status` に想定外のファイルがある

## 参照

- 機械可読ポリシー: `content/pipeline/policy.json`
- 運用手順の詳細: `docs/AUTOMATION.md`
- 媒体の編集方針: `docs/HANDOVER.md`
