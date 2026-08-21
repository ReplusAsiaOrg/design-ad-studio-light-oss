#!/bin/bash
# 毎朝の自動同期（launchd / cron 等の定期実行から呼ぶ想定）
# サーバー（npm run start 等で常駐起動）が応答するまで待ってから
# /api/meta/sync を叩く。Macがスリープ中だった場合は起床時に launchd が実行する。

BASE_URL="http://127.0.0.1:3000"
LOG_PREFIX="[daily-sync $(date '+%Y-%m-%d %H:%M:%S')]"

# サーバー起動待ち（最大5分: 10秒×30回）
for i in $(seq 1 30); do
  if curl -s -o /dev/null --max-time 5 "$BASE_URL/"; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "$LOG_PREFIX サーバーが応答しないため同期を中止" >&2
    exit 1
  fi
  sleep 10
done

# 同期実行（全登録アカウント。genes分類と画像URL取り直しも同期内で走る）
RESULT=$(curl -s --max-time 1800 -X POST "$BASE_URL/api/meta/sync" -H "Content-Type: application/json" -d '{}')
OK=$(echo "$RESULT" | /usr/local/bin/node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).ok===true?'true':'false')}catch{console.log('false')}})")

if [ "$OK" = "true" ]; then
  echo "$LOG_PREFIX 同期成功: $(echo "$RESULT" | head -c 300)"
else
  echo "$LOG_PREFIX 同期失敗: $(echo "$RESULT" | head -c 500)" >&2
  exit 1
fi
