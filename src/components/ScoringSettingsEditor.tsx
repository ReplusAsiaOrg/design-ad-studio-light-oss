'use client';

import { useCallback, useEffect, useState } from 'react';

interface ScoringSettingsDto {
  payoutPerCv: number;
  brandPrefixes: string[];
  roasPct: { excellent: number; good: number; keep: number; improve: number };
  spendRank: { a: number; b: number; c: number };
  spendRankBreakdown: { a: number; b: number; c: number };
  starSpendMin: { s3: number; s2: number };
  winFilter: { roasMinPct: number; minPurchases: number };
  cutMinSpend: number | null;
  cvDeviationPct: number;
}

interface Props {
  accountId: string;
  clientName: string;
  onClose: () => void;
}

/** 数値input（空文字は0扱いにせず NaN のままにして保存時に弾く） */
function NumField({ label, value, onChange, suffix }: {
  label: string; value: number; onChange: (v: number) => void; suffix?: string;
}) {
  return (
    <label className="text-xs text-gray-500 block">
      {label}
      <span className="mt-1 flex items-center gap-1">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-blue-400"
        />
        {suffix && <span className="text-gray-400 shrink-0">{suffix}</span>}
      </span>
    </label>
  );
}

/**
 * クライアント別 評価設定エディター（account_settings の編集UI）。
 * 集計シートv5のSETTINGS相当。保存すると優先順位・勝ちセグメントの判定に即反映される
 * （ランクはDB保存せず表示時計算のため）。
 */
export default function ScoringSettingsEditor({ accountId, clientName, onClose }: Props) {
  const [settings, setSettings] = useState<ScoringSettingsDto | null>(null);
  const [defaults, setDefaults] = useState<ScoringSettingsDto | null>(null);
  const [customized, setCustomized] = useState(false);
  const [prefixText, setPrefixText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/meta/settings?account=${accountId}`);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? '評価設定の取得に失敗しました');
        setSettings(json.settings);
        setDefaults(json.defaults);
        setCustomized(json.customized);
        setPrefixText((json.settings.brandPrefixes as string[]).join(', '));
      } catch (e) {
        setError(e instanceof Error ? e.message : '評価設定の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    })();
  }, [accountId]);

  const patch = useCallback(<K extends keyof ScoringSettingsDto>(key: K, value: ScoringSettingsDto[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        settings: {
          ...settings,
          brandPrefixes: prefixText.split(/[,、]/).map((s) => s.trim()).filter(Boolean),
        },
      };
      const res = await fetch(`/api/meta/settings?account=${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '保存に失敗しました');
      setSettings(json.settings);
      setPrefixText((json.settings.brandPrefixes as string[]).join(', '));
      setCustomized(true);
      setNotice('保存しました。優先順位・勝ちセグメントの判定に即反映されます');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }, [accountId, settings, prefixText]);

  const reset = useCallback(async () => {
    if (!window.confirm('このクライアントの上書き設定を削除して既定値（シートのSETTINGS）に戻しますか？')) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/meta/settings?account=${accountId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'リセットに失敗しました');
      setSettings(json.settings);
      setPrefixText((json.settings.brandPrefixes as string[]).join(', '));
      setCustomized(false);
      setNotice('既定値に戻しました');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'リセットに失敗しました');
    } finally {
      setSaving(false);
    }
  }, [accountId]);

  const cpaLimit = settings && settings.payoutPerCv > 0 && settings.roasPct.excellent > 0
    ? Math.round((settings.payoutPerCv * 100) / settings.roasPct.excellent)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 sticky top-0 bg-white">
          <div>
            <h3 className="text-sm font-bold text-gray-800">評価設定 — {clientName}</h3>
            <p className="text-[11px] text-gray-400">
              集計シートv5のSETTINGS相当・{customized ? 'このクライアント用に上書き中' : '既定値を使用中'}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto py-1 px-2 rounded-lg text-xs text-gray-400 hover:text-gray-600">閉じる ✕</button>
        </div>

        <div className="p-5 space-y-5">
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-8">読み込み中...</p>
          ) : !settings ? (
            <p className="text-center text-red-500 text-sm py-8">{error ?? '設定を読み込めませんでした'}</p>
          ) : (
            <>
              {/* 基本 */}
              <section>
                <h4 className="text-xs font-bold text-gray-600 mb-2">基本</h4>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="報酬単価（1成果あたり）" value={settings.payoutPerCv} suffix="円"
                    onChange={(v) => patch('payoutPerCv', v)} />
                  <label className="text-xs text-gray-500 block">
                    名寄せで除去するブランド接頭辞（カンマ区切り）
                    <input
                      value={prefixText}
                      onChange={(e) => setPrefixText(e.target.value)}
                      placeholder="例: brandname, brand2"
                      className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-blue-400"
                    />
                  </label>
                </div>
                {cpaLimit != null && (
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    → ★★★のCPA上限 = 報酬単価×100÷ROAS優秀 = ¥{cpaLimit.toLocaleString('ja-JP')}
                  </p>
                )}
              </section>

              {/* ROAS基準 */}
              <section>
                <h4 className="text-xs font-bold text-gray-600 mb-2">ROAS判定基準（%）— CPA上限を逆算</h4>
                <div className="grid grid-cols-4 gap-3">
                  <NumField label="★★★優秀" value={settings.roasPct.excellent} suffix="%"
                    onChange={(v) => patch('roasPct', { ...settings.roasPct, excellent: v })} />
                  <NumField label="★★良好" value={settings.roasPct.good} suffix="%"
                    onChange={(v) => patch('roasPct', { ...settings.roasPct, good: v })} />
                  <NumField label="★継続" value={settings.roasPct.keep} suffix="%"
                    onChange={(v) => patch('roasPct', { ...settings.roasPct, keep: v })} />
                  <NumField label="要改善" value={settings.roasPct.improve} suffix="%"
                    onChange={(v) => patch('roasPct', { ...settings.roasPct, improve: v })} />
                </div>
              </section>

              {/* 消化金額ランク */}
              <section>
                <h4 className="text-xs font-bold text-gray-600 mb-2">消化金額ランク境界（円）</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] text-gray-400 mb-1.5">広告単体系（優先順位タブ）</p>
                    <div className="grid grid-cols-3 gap-2">
                      <NumField label="A以上" value={settings.spendRank.a} onChange={(v) => patch('spendRank', { ...settings.spendRank, a: v })} />
                      <NumField label="B以上" value={settings.spendRank.b} onChange={(v) => patch('spendRank', { ...settings.spendRank, b: v })} />
                      <NumField label="C以上" value={settings.spendRank.c} onChange={(v) => patch('spendRank', { ...settings.spendRank, c: v })} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-400 mb-1.5">内訳系（勝ちセグメントタブ）</p>
                    <div className="grid grid-cols-3 gap-2">
                      <NumField label="A以上" value={settings.spendRankBreakdown.a} onChange={(v) => patch('spendRankBreakdown', { ...settings.spendRankBreakdown, a: v })} />
                      <NumField label="B以上" value={settings.spendRankBreakdown.b} onChange={(v) => patch('spendRankBreakdown', { ...settings.spendRankBreakdown, b: v })} />
                      <NumField label="C以上" value={settings.spendRankBreakdown.c} onChange={(v) => patch('spendRankBreakdown', { ...settings.spendRankBreakdown, c: v })} />
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">C未満は「判定不可」（データ量不足として評価しない）</p>
              </section>

              {/* 内訳系★判定の消化下限・勝ち抽出 */}
              <section>
                <h4 className="text-xs font-bold text-gray-600 mb-2">内訳系★判定の消化下限（AND条件）・勝ち抽出フィルタ</h4>
                <div className="grid grid-cols-4 gap-3">
                  <NumField label="★★★に必要な消化" value={settings.starSpendMin.s3} suffix="円"
                    onChange={(v) => patch('starSpendMin', { ...settings.starSpendMin, s3: v })} />
                  <NumField label="★★に必要な消化" value={settings.starSpendMin.s2} suffix="円"
                    onChange={(v) => patch('starSpendMin', { ...settings.starSpendMin, s2: v })} />
                  <NumField label="勝ちROAS下限" value={settings.winFilter.roasMinPct} suffix="%"
                    onChange={(v) => patch('winFilter', { ...settings.winFilter, roasMinPct: v })} />
                  <NumField label="勝ち最低CV数" value={settings.winFilter.minPurchases} suffix="件"
                    onChange={(v) => patch('winFilter', { ...settings.winFilter, minPurchases: v })} />
                </div>
              </section>

              {/* CV乖離補正 */}
              <section>
                <h4 className="text-xs font-bold text-gray-600 mb-2">CV乖離補正 — Meta計測CVと実CVのズレを補正</h4>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label="乖離率（MetaのCVが実際より多い割合）" value={settings.cvDeviationPct} suffix="%"
                    onChange={(v) => patch('cvDeviationPct', v)} />
                  <p className="text-[11px] text-gray-400 leading-relaxed self-end pb-1">
                    実CV = Meta CV × {Number.isFinite(settings.cvDeviationPct) ? (1 - settings.cvDeviationPct / 100).toLocaleString('ja-JP') : '—'}
                    {Number.isFinite(settings.cvDeviationPct) && settings.cvDeviationPct !== 0 && (
                      <>（例: Meta CV 100件 → <b>{Math.round((1 - settings.cvDeviationPct / 100) * 1000) / 10}件</b>として評価）</>
                    )}
                    。0で補正なし。Metaが少なく出る場合はマイナス値。CV・CPA・CVR・ランク判定・AI分析すべてに反映されます。
                  </p>
                </div>
              </section>

              {/* AI分析: 配置除外の判断基準 */}
              <section>
                <h4 className="text-xs font-bold text-gray-600 mb-2">AI分析 — 配置「除外候補」の判断基準</h4>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500 block">
                    除外判定の最低消化額（CV0でもこの額未満は判断保留）
                    <span className="mt-1 flex items-center gap-1">
                      <input
                        type="number"
                        value={settings.cutMinSpend ?? ''}
                        placeholder={`空欄 = CPA基準に連動（現在 ¥${(settings.payoutPerCv > 0 && settings.roasPct.keep > 0 ? Math.round((settings.payoutPerCv * 100) / settings.roasPct.keep) : 0).toLocaleString('ja-JP')}）`}
                        onChange={(e) => patch('cutMinSpend', e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-blue-400 placeholder:text-gray-300"
                      />
                      <span className="text-gray-400 shrink-0">円</span>
                    </span>
                  </label>
                  <p className="text-[11px] text-gray-400 leading-relaxed self-end pb-1">
                    消化がこの額に達するまでは、CV0の配置でもAIは「データ不足＝判断保留」とし除外を推奨しません。空欄なら★継続ラインのCPA基準額と同額。
                  </p>
                </div>
              </section>

              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
              {notice && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{notice}</p>}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={save}
                  disabled={saving}
                  className="py-2 px-4 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
                <button
                  onClick={reset}
                  disabled={saving || !customized}
                  className="py-2 px-4 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-40"
                  title="上書きを削除して既定値に戻す"
                >
                  既定値に戻す
                </button>
                {defaults && (
                  <span className="ml-auto text-[11px] text-gray-300">
                    既定: 報酬¥{defaults.payoutPerCv.toLocaleString('ja-JP')} / ROAS {defaults.roasPct.excellent}-{defaults.roasPct.improve}%
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
