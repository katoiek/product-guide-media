# えらびノート / product-guide-media

「何を買うか」は決まっているが、複数メーカーの製品から選べない人のための、日本語一般商品比較メディアです。

- 公開URL: https://erabi-note.jp/
- フレームワーク: Astro
- ホスティング: Cloudflare Pages
- Production branch: `main`

## 引き継ぎ・運用方針

媒体の目的、記事の公開基準、Amazonアソシエイトの直接リンク・画像要件、Cloudflare Pages設定、既知の制約、次に行う作業は [`docs/HANDOVER.md`](docs/HANDOVER.md) を参照してください。

## 記事パイプラインの自動化

企画から公開までを、工程別エージェント5体と機械的な公開ゲートで回します。仕組みと運用手順は [`docs/AUTOMATION.md`](docs/AUTOMATION.md) を参照してください。

```bash
npm run queue status   # キューの状態
npm run gate           # 公開ゲート（商品 + 記事 + ビルド）
```

Claude Code からは `/erabi-pipeline` で1周回せます。

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm install --no-audit --no-fund
npm run build
```

出力先は `dist/` です。Cloudflare Pagesのビルド設定は次のとおりです。

```text
Framework preset: Astro
Build command: npm run build
Build output directory: dist
Root directory: (empty)
```

## 重要な公開ルール

- 同じ購入目的の、異なるメーカー／ブランド5〜7製品を比較する。
- 同一シリーズのサイズ・容量違いだけの記事は公開しない。
- 仕様・注意事項はメーカー公式情報で確認する。
- 購入導線には、ASINと一致するAmazonの直接商品リンクだけを使う。検索リンクは使わない。
- 製品画像は、Amazonプログラムで許可された画像または明示許諾済み画像だけを使う。
- ASIN、直接リンク、画像利用許諾が欠ける記事は公開しない。
- 秘密情報をリポジトリへ保存しない。
