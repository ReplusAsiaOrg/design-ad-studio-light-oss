-- design-ad-studio スキーマ（冪等: 何度流してもOK）
-- ローカル: postgresql://localhost:5432/design_ad_studio_dev
-- 本番:     Neon（DATABASE_URL）

-- 分析対象アカウントの登録簿（「アカウント管理」タブから編集）
CREATE TABLE IF NOT EXISTS accounts (
  account_id   text PRIMARY KEY CHECK (account_id ~ '^act_[0-9]+$'),
  client       text NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,
  account_name text,
  note         text,
  added_at     timestamptz NOT NULL DEFAULT now()
);
-- 勝ち分析再現（別プロジェクト流用）の流用先ブリーフ・ブランド配色（アカウント管理タブから編集）
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brief text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS palette_hex jsonb;

-- クライアント別の評価設定（報酬単価・ROAS基準・消化ランク境界 等）
-- 構造は src/lib/scoring.ts の ScoringSettings。未登録なら既定値を使う
CREATE TABLE IF NOT EXISTS account_settings (
  account_id text PRIMARY KEY,
  settings   jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 全期間スナップショット（旧 data/ads/act_*.json のDB版。中身は AccountSnapshot）
CREATE TABLE IF NOT EXISTS snapshots (
  account_id text PRIMARY KEY,
  data       jsonb NOT NULL,
  synced_at  timestamptz NOT NULL DEFAULT now()
);

-- CreativeTraits キャッシュ（旧 data/ads/genes-*.json のDB版。record は GeneRecord）
CREATE TABLE IF NOT EXISTS gene_caches (
  account_id  text NOT NULL,
  creative_id text NOT NULL,
  record      jsonb NOT NULL,
  PRIMARY KEY (account_id, creative_id)
);

-- 広告メタ（名寄せ・ランキング表示用）
CREATE TABLE IF NOT EXISTS dim_ad (
  account_id       text NOT NULL,
  ad_id            text NOT NULL,
  name             text NOT NULL DEFAULT '',
  campaign_id      text,
  adset_id         text,
  status           text,
  effective_status text,
  creative_id      text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, ad_id)
);

-- 広告×日の実績（日次同期で蓄積。任意期間の集計はここから）
-- 注意: reach は日次値。日をまたいで合算すると重複するため期間リーチには使わない
CREATE TABLE IF NOT EXISTS fact_ad_daily (
  account_id  text NOT NULL,
  ad_id       text NOT NULL,
  date        date NOT NULL,
  spend       numeric NOT NULL DEFAULT 0,
  impressions bigint  NOT NULL DEFAULT 0,
  reach       bigint  NOT NULL DEFAULT 0,
  clicks      bigint  NOT NULL DEFAULT 0,
  actions     jsonb   NOT NULL DEFAULT '[]',
  PRIMARY KEY (account_id, ad_id, date)
);
CREATE INDEX IF NOT EXISTS idx_fact_ad_daily_account_date
  ON fact_ad_daily (account_id, date);

-- 広告×日×セグメントの内訳実績（Phase 1c: 性年齢・配置の日次同期。勝ちセグメント抽出はここから）
-- dimension: 'age' | 'gender' | 'age_gender' | 'placement'
--   placement の segment は「媒体/配置」例: facebook/feed
--   age_gender の segment は「年齢・性別」例: 65+・female（単独軸はスクリーニング、掛け合わせは入稿判断に使う）
-- 注意: placement は Meta API 制約で actions（CV）が併用不可の可能性があり、その場合 actions は常に '[]'
--       （同期時にCV付きで試行→エラー時CVなしにフォールバック。詳細は sync.ts）
CREATE TABLE IF NOT EXISTS fact_ad_segment_daily (
  account_id  text NOT NULL,
  ad_id       text NOT NULL,
  date        date NOT NULL,
  dimension   text NOT NULL,
  segment     text NOT NULL,
  spend       numeric NOT NULL DEFAULT 0,
  impressions bigint  NOT NULL DEFAULT 0,
  clicks      bigint  NOT NULL DEFAULT 0,
  actions     jsonb   NOT NULL DEFAULT '[]',
  PRIMARY KEY (account_id, ad_id, date, dimension, segment)
);
CREATE INDEX IF NOT EXISTS idx_fact_ad_segment_daily_account_dim_date
  ON fact_ad_segment_daily (account_id, dimension, date);

-- ============================================================
-- M2: 認証・マルチテナント基盤（Issue #7, #9）
-- ============================================================

-- アプリユーザー（Supabase Auth の auth.users と user_id で対応。role はここが正）
-- role: 'admin'  = リプラス側。全テナント・全機能
--       'member' = クライアント側。所属テナントのレポート閲覧＋CR生成のみ
CREATE TABLE IF NOT EXISTS app_users (
  user_id    uuid PRIMARY KEY,
  email      text NOT NULL,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- テナント（クライアント企業）
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ユーザーの所属テナント（member 用。admin は所属に関係なく全テナント）
CREATE TABLE IF NOT EXISTS user_tenants (
  user_id    uuid NOT NULL,
  tenant_id  uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

-- テナント⇔広告アカウントの紐付け（1テナント複数アカウント対応）
CREATE TABLE IF NOT EXISTS tenant_accounts (
  tenant_id  uuid NOT NULL,
  account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_tenant_accounts_account ON tenant_accounts (account_id);

-- 生成履歴（学習ループ: 生成→採用/不採用→入稿名称→勝敗追跡。record は GenerationRecord）
CREATE TABLE IF NOT EXISTS generation_history (
  id     text PRIMARY KEY,
  record jsonb NOT NULL
);

-- 同期履歴（Cron・手動の実行記録と失敗理由）
CREATE TABLE IF NOT EXISTS sync_runs (
  id         bigserial PRIMARY KEY,
  account_id text NOT NULL,
  kind       text NOT NULL,   -- 'snapshot' | 'daily' | 'segments'
  range_from date,
  range_to   date,
  ok         boolean NOT NULL,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
