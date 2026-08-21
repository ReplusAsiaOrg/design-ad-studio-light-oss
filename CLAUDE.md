# design-ad-studio-light-oss

## スコープ宣言
- **このリポジトリで扱うもの**: リプラスアジアの OSS 配布用「Ad Studio Light」。Meta広告の「成果分析 → 勝ちパターン抽出 → 新クリエイティブ生成」を一気通貫で行う Next.js アプリの**ローカル実行前提のライト版**。
  - ダウンロードして各自のマシンで `npm run dev` / `npm run start` して使う想定（サーバーデプロイ前提の構成は持たない）
  - Meta Graph API から広告実績を同期し、CPA正規化・winner判定・CreativeTraits分類・勝ちパターン抽出を行う
  - 勝ちCRを起点にバナー生成（GPT Image 2 / Gemini 系エンジン）
- **扱わないもの**: 特定クライアントの実データ・実アカウントID・トークン類。広告の入稿・運用そのもの。

## 由来（相互移植関係）
- 元リポ: `~/panthers-cr-studio`（Panthers社ローカル完結版）をベースに、クライアント固有情報を除去してコピーしたもの（git履歴は新規・持ち込みなし）
- 同系統コード: `~/replus-work/design-ad-studio`（リプラス版）。両者は相互移植関係にあり、改善は必要に応じて手動で移植する
- 本リポジトリへの機能追加・改善も、必要なら元リポ側へ逆移植を検討する

## 機密を含めない方針（必須）
- クライアント名・広告アカウントID・BM ID・APIキー・トークンを**コード・ドキュメント・コミットに一切含めない**
- サンプルが必要な場合は「サンプルブランドA/B」「act_0000000000000001」等のダミーを使う
- 環境変数は `.env.local`（.gitignore対象）で管理。`.env.example` にキー名のみ記載する

## 必要な環境変数（.env.local）
| 変数名 | 必須 | 用途 |
|-------|------|------|
| `META_ACCESS_TOKEN` | 必須（分析機能） | Meta Graph API（ads_read権限のトークン） |
| `OPENAI_API_KEY` | 推奨 | GPT Image 2（OpenAI直）・vision分類・テキスト生成フォールバック |
| `GEMINI_API_KEY` | 任意 | テキスト・分析（あればGemini優先） |
| `POYO_API_KEY` | 任意 | GPT Image 2（PoYo経由エンジン） |
| `DATABASE_URL` | 任意 | ローカルPostgres接続文字列（未設定時は `data/ads/*.json` に自動フォールバック） |

## 開発メモ
- 起動: `npm install` → `.env.local` 作成 → `npm run dev`
- デモモード: `npm run demo`（`DEMO_MODE=1`）。`src/lib/demo/` の架空データ（化粧品ブランド LUMINA）で偽Graph API＋組み込みPostgres（PGlite）で全タブが動く。セミナー・スクショ用。実データは含めない
- DB利用時の初期化: `npm run db:migrate`
- スコアリングを触ったら `npm run verify:scoring` で回帰検証（fixtures は匿名化済みサンプル）

## リポジトリ運用
- GitHub: `ReplusAsiaOrg/design-ad-studio-light-oss`（公開準備完了まで **Private**）
- ライセンス: **Apache-2.0**（2026-08-03決定）。ロゴ・ブランド素材はライセンス対象外と README に明記
- 第三者コード: なし（2026-08-03の著作権レビューで、参考にした他社OSS由来のコードは独自実装に全面書き換え済み。genes.ts の分類語彙 CreativeTraits・meta/client.ts・winner.ts の median が対象。以後も外部コードを取り込む場合はライセンス確認と帰属表示を必ず行う）
