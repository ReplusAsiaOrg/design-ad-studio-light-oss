# Ad Studio 勝ちCR分析（genes分類）アーキテクチャ

Meta広告の**数値**と**クリエイティブ画像**を別ルートで取り込み、AIが「勝ちCRの見た目の特徴」をDBに蓄積 → 「勝ち分析再現」で新CR生成の起点にする仕組み。2026-07-14時点（genes分類の自動化込み）。

## 図1: 全体構成

```mermaid
flowchart LR
    U["ブラウザ<br/>（Basic認証 AI/design）"] --> V

    subgraph V["Vercel — Next.js（design-ad-studio）"]
        UI["UI<br/>アカウント管理 / レポート / 勝ち分析再現"]
        API["APIルート<br/>/api/meta/*"]
        UI --> API
    end

    API -->|"数値・画像の取得<br/>（読み取り専用トークン）"| META["Meta Graph API"]
    API -->|"画像のvision分類"| OAI["OpenAI Vision"]
    API -->|"分析・コピー生成"| LLM["Gemini / OpenAI"]
    API -->|"バナー画像生成"| IMG["GPT Image 2<br/>（PoYo経由 / OpenAI直）"]
    API <--> DB[("Neon Postgres<br/>snapshots / fact_ad_daily /<br/>fact_ad_segment_daily / gene_caches ほか")]
    CRON["Vercel Cron 毎朝6時JST"] -->|"Bearer CRON_SECRET"| API
```

## 図2: データ取り込み〜genes分類のトリガーと流れ

genes分類（`classifyAccountGenes` / `src/lib/meta/genes-sync.ts`）は**4つの入口すべてから同じ関数**が呼ばれる。

```mermaid
flowchart TD
    subgraph T["起動トリガー"]
        CRON["① Cron 毎朝6時<br/>（全アカウント）"]
        SYNCBTN["② 同期ボタン<br/>（アカウント管理）"]
        BF["③ 過去取込<br/>（新規アカウント追加時に自動・月次チャンク）"]
        GBTN["④ CR分類ボタン<br/>（手動再実行用）"]
    end

    CRON --> SYNC["/api/meta/sync"]
    SYNCBTN --> SYNC
    BF --> BFAPI["/api/meta/backfill"]
    GBTN --> GAPI["/api/meta/genes"]

    SYNC -->|"数値同期<br/>インサイト取得"| META1["Meta Graph API"]
    META1 --> SNAP[("snapshots 全期間")]
    META1 --> FACT[("fact_ad_daily /<br/>fact_ad_segment_daily 日次")]

    SYNC -->|"同期後に自動実行<br/>（失敗しても同期は成功扱い）"| GENES["classifyAccountGenes"]
    BFAPI -->|"全月取り込み完了後に自動実行"| GENES
    GAPI --> GENES

    GENES --> GC[("gene_caches<br/>特徴＋画像URL")]
```

## 図3: genes分類の中身（1アカウント分）

```mermaid
sequenceDiagram
    participant G as classifyAccountGenes
    participant DB as Neon Postgres
    participant M as Meta Graph API
    participant V as OpenAI Vision

    G->>DB: snapshots を読み込み
    Note over G: labelWinners: CV群ごとにCPAで<br/>勝ち/負けCRを判定（上位6件ずつ）
    G->>DB: gene_caches を読み込み
    Note over G: 分類済みIDはスキップ<br/>＝未分類の差分だけ処理（低コスト）
    G->>M: クリエイティブ画像を取得
    Note over M: 画像URLが取れないCRはここで脱落<br/>（HTS様に多い既知の制約）
    G->>V: 画像を分類（形式・被写体・配色 など）
    G->>DB: gene_caches に保存（CreativeTraits＋画像URL）
```

## 図4: 「勝ち分析再現」での利用フロー

```mermaid
flowchart LR
    subgraph TAB["勝ち分析再現タブ"]
        PICK["Metaの勝ちCRから選ぶ<br/>（MetaWinnerPicker）"]
        UP["手持ち画像アップ"]
        WA["WinningAnalyzer<br/>3観点分析 → 6案生成"]
    end

    PICK -->|"一覧取得"| WC["/api/meta/winning-creatives"]
    WC --> SNAP[("snapshots<br/>→ 勝ち判定")]
    WC --> GC[("gene_caches<br/>→ 画像・特徴・勝ちパターン要約")]
    PICK -->|"選択したCRを取り込み"| CI["/api/meta/creative-image"] --> WA
    UP --> WA
    WA -->|"効いている要素の言語化・コピー"| LLM["Gemini / OpenAI"]
    WA -->|"コピー差替3案＋テーマ替え3案"| IMG["GPT Image 2"]
```

## 押さえておくポイント

| 項目 | 内容 |
|---|---|
| 数値と画像は別ルート | 数値（消化・CV・CPA）は同期で毎日更新。画像の特徴（genes）はvision分類で `gene_caches` に蓄積 |
| 差分実行 | 分類済みcreativeIdはスキップ。毎日Cronで走ってもAPIコストは新規の勝ち/負けCR分だけ |
| 失敗の切り離し | genes分類が失敗しても数値同期は成功扱い（レポートは止まらない） |
| ピッカーの表示条件 | 「勝ち判定」かつ「genes分類済み（画像URLあり）」のCRだけ表示。両方満たすアカウントが2社以上でプルダウン出現 |
| 既知の制約 | Metaが画像URLを返さないCR（`no image_url/thumbnail_url`）は分類不可→ピッカー非表示 |
