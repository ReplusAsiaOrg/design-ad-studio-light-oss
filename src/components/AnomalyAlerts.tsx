'use client';

import { useEffect, useState } from 'react';

interface Alert {
  type: string;
  level: 'warn' | 'critical';
  scope: 'account' | 'ad';
  message: string;
}

interface AnomalyData {
  targetDate: string | null;
  baselineDates: string[];
  alerts: Alert[];
}

/**
 * 広告レポート上部の異常検知パネル。
 * 直近の完了日を過去7日中央値と比較し、消化急増/停止・CVゼロ消化・CPA急騰・CTR急落を警告する。
 * データ不足（ベースライン3日未満）や異常なしのときは控えめな1行表示。
 */
export default function AnomalyAlerts({ accountId }: { accountId: string | null }) {
  // 結果に「どのアカウントの検知結果か」を持たせ、アカウント切替中は導出でローディング扱いにする
  // （effect内の同期setStateによるリセットを避ける）
  const [result, setResult] = useState<{ forAccount: string; data: AnomalyData | null } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    fetch(`/api/meta/anomalies?account=${encodeURIComponent(accountId)}`)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setResult({ forAccount: accountId, data: j.ok ? j : null });
      })
      .catch(() => { if (alive) setResult({ forAccount: accountId, data: null }); });
    return () => { alive = false; };
  }, [accountId]);

  if (!accountId) return null;
  const loaded = result?.forAccount === accountId ? result : null;
  if (loaded && loaded.data === null) return null; // 取得失敗時は静かに非表示
  const data = loaded?.data ?? null;
  if (!data) {
    return (
      <div className="text-[10px] text-gray-400 px-1 no-print">🩺 異常検知を実行中...</div>
    );
  }
  if (!data.targetDate || data.baselineDates.length < 3) {
    return (
      <div className="text-[10px] text-gray-400 px-1 no-print">
        🩺 異常検知: 日次データが不足しています（ベースライン3日以上で判定開始）
      </div>
    );
  }
  if (data.alerts.length === 0) {
    return (
      <div className="text-[10px] text-emerald-600 px-1 no-print">
        🩺 {data.targetDate} の異常なし（直近{data.baselineDates.length}日中央値と比較）
      </div>
    );
  }

  const criticals = data.alerts.filter((a) => a.level === 'critical');
  return (
    <div className="bg-white rounded-xl border border-rose-200 p-3 space-y-1.5 no-print">
      <div className="flex items-center gap-2">
        <span className="text-sm">🚨</span>
        <span className="text-xs font-bold text-gray-900">
          異常検知: {data.targetDate} に {data.alerts.length}件
          {criticals.length > 0 && <span className="text-rose-600">（うち重大 {criticals.length}件）</span>}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto">直近{data.baselineDates.length}日中央値と比較</span>
      </div>
      <ul className="space-y-1">
        {data.alerts.map((a, i) => (
          <li
            key={i}
            className={`text-[11px] rounded-lg px-2.5 py-1.5 border ${
              a.level === 'critical'
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            {a.level === 'critical' ? '🔴' : '🟡'} {a.message}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-gray-400">
        ※ CV系はMetaの計測遅れ（アトリビューション最大7日）で翌日以降に解消することがあります。最終判断は運用者が行ってください。
      </p>
    </div>
  );
}
