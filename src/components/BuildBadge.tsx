'use client';

import buildInfo from '@/generated/build-info.json';

/**
 * 画面右下のビルド情報バッジ（Issue #4・菊川さん推奨の開発効率化）。
 * 「バージョン / いま開いている画面名 / デプロイ識別子（コミット@デプロイ時刻JST）」を常時表示し、
 * スクリーンショットから人間・Claude Code の双方が「どの時点のコードのどの画面か」を特定できるようにする。
 * デプロイ識別子は scripts/gen-build-info.mjs がデプロイ時に生成（コミット末尾の + は未コミット変更あり）。
 */
export default function BuildBadge({ screen }: { screen: string }) {
  return (
    <div className="fixed bottom-1.5 right-2 z-40 pointer-events-none select-none no-print">
      <span className="text-[10px] text-gray-300 bg-white/70 rounded px-1.5 py-0.5 tabular-nums">
        v{buildInfo.version} · {screen} · {buildInfo.commit}@{buildInfo.builtAt}
      </span>
    </div>
  );
}
