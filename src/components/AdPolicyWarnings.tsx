'use client';

import { useMemo } from 'react';
import { checkAdCopyFields, type PolicyHit } from '@/lib/ad-policy';
import type { BannerFormData } from '@/lib/types';

/** コンセプトカード用のコンパクト警告バッジ（policyWarnings がある時だけ表示） */
export function PolicyWarningBadge({ warnings }: { warnings?: PolicyHit[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div
      className="mt-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 leading-relaxed"
      title={warnings.map((w) => `「${w.matched}」${w.reason}${w.suggestion ? `（言い換え例: ${w.suggestion}）` : ''}`).join('\n')}
    >
      ⚠️ 審査NGの可能性: {warnings.map((w) => `「${w.matched}」（${w.category}）`).join(' ')}
    </div>
  );
}

/**
 * フォームテキストの広告審査NG表現警告（Issue #31）。
 * バナー作成タブでメイン/サブ/その他テキストをリアルタイムにチェックし、
 * 明らかなNG表現に警告を出す（ブロックはしない＝最終判断は人間）。
 */
export default function AdPolicyWarnings({ formData }: { formData: BannerFormData }) {
  const results = useMemo(
    () =>
      checkAdCopyFields([
        { label: 'メインテキスト', text: formData.mainText },
        { label: 'サブテキスト', text: formData.subText },
        ...formData.extraTexts.map((et, i) => ({ label: `その他テキスト${i + 1}`, text: et.text })),
      ]),
    [formData.mainText, formData.subText, formData.extraTexts],
  );

  if (results.length === 0) return null;

  return (
    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="text-sm font-semibold text-amber-800 mb-1.5">
        ⚠️ 広告審査NGの可能性がある表現があります
      </p>
      <ul className="space-y-1.5">
        {results.map((r) =>
          r.hits.map((h, i) => (
            <li key={`${r.label}-${i}`} className="text-xs text-amber-700 leading-relaxed">
              <span className="font-medium">{r.label}</span>「
              <span className="font-bold text-amber-900">{h.matched}</span>」 —
              <span className="ml-1 inline-block bg-amber-100 rounded px-1 py-0.5 text-[10px] font-medium">{h.category}</span>{' '}
              {h.reason}
              {h.suggestion && <span className="text-amber-600">（言い換え例: {h.suggestion}）</span>}
            </li>
          )),
        )}
      </ul>
      <p className="text-[10px] text-amber-500 mt-1.5">
        簡易チェックです（明らかなNGのみ検出）。生成は可能ですが、入稿前に表現の見直しをおすすめします。
      </p>
    </div>
  );
}
