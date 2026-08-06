# product-guide-media

日本語の一般商品ガイド（準備中）用 Astro 静的サイトです。現時点では、特定商品の推奨・性能比較・価格情報・レビュー・広告リンクを掲載しません。

## 開発

```bash
npm install
npm run dev
```

## ビルド

共有マウントでの依存関係・ビルドの問題を避けるため、`/tmp` にコピーしてから実行する例です。

```bash
cp -a /opt/data/workspace/product-guide-media /tmp/product-guide-media-build
cd /tmp/product-guide-media-build
npm install
npm run build
```

出力先は `dist/` です。Cloudflare Pages 設定は `wrangler.toml` にあり、プロジェクト名は `product-guide-media`、出力ディレクトリは `dist` です。

## 編集方針

- カテゴリは情報設計・準備段階としてのみ表示します。
- 実測していない性能、価格、在庫、第三者評価は掲載しません。
- 外部レビューや記事を転載・模倣しません。
- 将来、広告・成果報酬リンクを導入する場合は、掲載位置で明確に開示します。

このリポジトリではデプロイやGitHubリポジトリの作成は行いません。
