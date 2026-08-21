import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { hasDb, q } from './db/client';
import { buildAdName, normalizeAdName, overallVerdict, type ScoringSettings } from './scoring';
import { analyzeAd } from './meta/analyze';
import type { AccountSnapshot } from './meta/store';

/**
 * 生成履歴 — 「学んでいくツール」の土台。
 *
 * 生成したバナーを（プロンプト・エンジン・パラメータごと）残し、
 * 採用/不採用の判断 → 入稿用名称の発行 → 入稿後の勝敗自動追跡、まで1レコードで持つ。
 * 追跡結果は buildLearningNotes() で生成プロンプトに注入され、次の生成に反映される。
 *
 * 保存先: DATABASE_URL があれば Postgres（generation_history テーブル）、
 *         無ければ data/generated/history.json。画像バイナリは常に data/generated/images/<id>.png。
 * 履歴の保存失敗で生成本体を落とさないこと（呼び出し側は catch して警告ログのみ）。
 */

const GEN_DIR = path.join(process.cwd(), 'data', 'generated');
const IMG_DIR = path.join(GEN_DIR, 'images');
const HISTORY_FILE = path.join(GEN_DIR, 'history.json');

export interface GenerationOutcome {
  checkedAt: string;
  accountId: string;
  /** 名寄せ（統合名）が一致した広告の本数 */
  matchedAds: number;
  spend: number;
  cv: number;
  cpa: number | null;
  /** overallVerdict のラベル（★★★優秀〜損切り/判定不可） */
  verdict: string;
}

export interface GenerationRecord {
  id: string;
  createdAt: string;
  engine: string;
  /** 生成モード（single / winning-strict / batch 等。GenerateRequest.mode 由来） */
  mode: string;
  /** エンジンに渡した最終プロンプト */
  prompt: string;
  mainText: string;
  subText?: string;
  aspectRatio?: string;
  /** PoYo非同期エンジンのタスクID（画像添付時の突き合わせ用） */
  taskId?: string;
  status: 'pending' | 'generated' | 'adopted' | 'rejected';
  imageSaved: boolean;
  decidedAt?: string;
  /** 採用時にユーザーが付ける素材名（名寄せの統合名と一致させる） */
  materialName?: string;
  /** 発行した入稿用広告名（YYYYMMDD_素材名） */
  adName?: string;
  outcome?: GenerationOutcome;
}

// fs フォールバックの read-modify-write を直列化する簡易ミューテックス
let fsChain: Promise<unknown> = Promise.resolve();
function withFsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fsChain.then(fn, fn);
  fsChain = run.catch(() => {});
  return run;
}

async function readFileMap(): Promise<Record<string, GenerationRecord>> {
  try {
    return JSON.parse(await fs.readFile(HISTORY_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

async function upsert(rec: GenerationRecord): Promise<void> {
  if (hasDb()) {
    await q(
      `INSERT INTO generation_history (id, record) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET record = $2`,
      [rec.id, JSON.stringify(rec)],
    );
    return;
  }
  await withFsLock(async () => {
    await fs.mkdir(GEN_DIR, { recursive: true });
    const map = await readFileMap();
    map[rec.id] = rec;
    await fs.writeFile(HISTORY_FILE, JSON.stringify(map, null, 1));
  });
}

async function loadAll(): Promise<GenerationRecord[]> {
  if (hasDb()) {
    const rows = await q<{ record: GenerationRecord }>('SELECT record FROM generation_history');
    return rows.map((r) => r.record);
  }
  return Object.values(await readFileMap());
}

export async function getRecord(id: string): Promise<GenerationRecord | null> {
  if (hasDb()) {
    const rows = await q<{ record: GenerationRecord }>(
      'SELECT record FROM generation_history WHERE id = $1', [id],
    );
    return rows[0]?.record ?? null;
  }
  return (await readFileMap())[id] ?? null;
}

/** 生成開始（または同期生成の完了）時に呼ぶ。 */
export async function createGenerationRecord(input: {
  engine: string;
  mode?: string;
  prompt: string;
  mainText?: string;
  subText?: string;
  aspectRatio?: string;
  taskId?: string;
}): Promise<GenerationRecord> {
  const rec: GenerationRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    engine: input.engine,
    mode: input.mode ?? 'single',
    prompt: input.prompt,
    mainText: input.mainText ?? '',
    subText: input.subText || undefined,
    aspectRatio: input.aspectRatio,
    taskId: input.taskId,
    status: 'pending',
    imageSaved: false,
  };
  await upsert(rec);
  return rec;
}

function stripDataUrl(b64: string): string {
  return b64.replace(/^data:[^;]+;base64,/, '');
}

/** 完成画像を保存してレコードを generated にする。id か taskId のどちらかで特定。 */
export async function attachGenerationImage(
  key: { id?: string; taskId?: string },
  imageBase64: string,
): Promise<void> {
  let rec: GenerationRecord | null = null;
  if (key.id) {
    rec = await getRecord(key.id);
  } else if (key.taskId) {
    const all = await loadAll();
    rec = all.find((r) => r.taskId === key.taskId) ?? null;
  }
  if (!rec) return;
  if (rec.imageSaved) return; // status ポーリングは複数回来るので二重保存しない
  await fs.mkdir(IMG_DIR, { recursive: true });
  await fs.writeFile(path.join(IMG_DIR, `${rec.id}.png`), Buffer.from(stripDataUrl(imageBase64), 'base64'));
  rec.imageSaved = true;
  if (rec.status === 'pending') rec.status = 'generated';
  await upsert(rec);
}

export function imagePathOf(id: string): string {
  // id は randomUUID 由来のみだが、パスに入るので防御的に検証
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`不正な履歴IDです: ${id}`);
  return path.join(IMG_DIR, `${id}.png`);
}

export async function listHistory(limit = 100): Promise<GenerationRecord[]> {
  const all = await loadAll();
  return all
    .filter((r) => r.imageSaved) // 画像が届かなかった pending は表示しない
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** 採用/不採用の記録。採用時は素材名から入稿用広告名（YYYYMMDD_素材名）を発行する。 */
export async function decideGeneration(
  id: string,
  decision: 'adopted' | 'rejected' | 'reset',
  materialName?: string,
): Promise<GenerationRecord> {
  const rec = await getRecord(id);
  if (!rec) throw new Error('履歴が見つかりません');
  if (decision === 'reset') {
    rec.status = 'generated';
    rec.decidedAt = undefined;
    rec.materialName = undefined;
    rec.adName = undefined;
    rec.outcome = undefined;
  } else if (decision === 'adopted') {
    const name = materialName?.trim();
    if (!name) throw new Error('採用には素材名が必要です');
    rec.status = 'adopted';
    rec.decidedAt = new Date().toISOString();
    rec.materialName = name;
    rec.adName = buildAdName(name, { date: new Date().toISOString().slice(0, 10) });
  } else {
    rec.status = 'rejected';
    rec.decidedAt = new Date().toISOString();
  }
  await upsert(rec);
  return rec;
}

/**
 * 採用済みレコードの勝敗を、同期済みスナップショットとの名寄せで自動追跡する。
 * 統合名（normalizeAdName）が素材名と一致した広告を合算し、そのアカウントの
 * 評価設定で総合評価を付ける。複数アカウントで一致した場合は消化最大の方を採用。
 */
export async function trackGenerationOutcomes(
  targets: { snapshot: AccountSnapshot; settings: ScoringSettings }[],
): Promise<{ updated: number }> {
  const all = await loadAll();
  const adopted = all.filter((r) => r.status === 'adopted' && r.materialName);
  let updated = 0;

  for (const rec of adopted) {
    let best: GenerationOutcome | null = null;
    for (const { snapshot, settings } of targets) {
      let spend = 0, cv = 0, matched = 0;
      for (const ad of snapshot.ads) {
        if (normalizeAdName(ad.name, settings.brandPrefixes) !== rec.materialName) continue;
        const a = analyzeAd(ad);
        spend += a.spend;
        cv += a.cv;
        matched++;
      }
      if (matched === 0) continue;
      const cpa = cv > 0 ? Math.round((spend / cv) * 10) / 10 : null;
      const outcome: GenerationOutcome = {
        checkedAt: new Date().toISOString(),
        accountId: snapshot.accountId,
        matchedAds: matched,
        spend: Math.round(spend),
        cv,
        cpa,
        verdict: overallVerdict(spend, cv, cpa, settings),
      };
      if (!best || outcome.spend > best.spend) best = outcome;
    }
    if (best) {
      rec.outcome = best;
      await upsert(rec);
      updated++;
    }
  }
  return { updated };
}

/**
 * 過去の採用実績を生成プロンプト注入用のメモにする（学習ループの出口）。
 * 実績が無ければ空文字。勝ち・負けそれぞれ最大3件＋方向づけの一文。
 */
export async function buildLearningNotes(): Promise<string> {
  const all = await loadAll();
  const tracked = all.filter((r) => r.status === 'adopted' && r.outcome && r.outcome.matchedAds > 0);
  if (tracked.length === 0) return '';

  const isWin = (v: string) => v.startsWith('★');
  const fmt = (r: GenerationRecord) => {
    const o = r.outcome!;
    const cpa = o.cpa != null ? `CPA ${Math.round(o.cpa).toLocaleString('ja-JP')}円` : 'CVなし';
    return `- 「${r.mainText || r.materialName}」→ ${o.verdict}（${cpa}・消化 ${o.spend.toLocaleString('ja-JP')}円）`;
  };
  const wins = tracked.filter((r) => isWin(r.outcome!.verdict))
    .sort((a, b) => (a.outcome!.cpa ?? Infinity) - (b.outcome!.cpa ?? Infinity)).slice(0, 3);
  const losses = tracked.filter((r) => !isWin(r.outcome!.verdict) && r.outcome!.verdict !== '判定不可')
    .sort((a, b) => b.outcome!.spend - a.outcome!.spend).slice(0, 3);
  if (wins.length === 0 && losses.length === 0) return '';

  const lines: string[] = ['# このツールで過去に生成→入稿したバナーの実績（参考にすること）'];
  if (wins.length > 0) {
    lines.push('勝った例（この方向性は再現・発展させる価値がある）:');
    lines.push(...wins.map(fmt));
  }
  if (losses.length > 0) {
    lines.push('負けた例（同じ切り口の繰り返しは避ける）:');
    lines.push(...losses.map(fmt));
  }
  return lines.join('\n');
}
