#!/bin/bash
# 公式結果を取得する。launchd から毎日 21:30 JST に呼ばれる。
# 公式アーカイブの公開遅延と一時障害を考慮し、昨日までの14日間を補完する。
set -euo pipefail
cd "$(dirname "$0")/.."

# launchd の最小PATHでも Homebrew の unar を解決できるようにする。
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

FROM=$(TZ=Asia/Tokyo date -v-14d '+%Y-%m-%d')
TO=$(TZ=Asia/Tokyo date -v-1d '+%Y-%m-%d')
LOG_PREFIX="[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')]"

run_tsx() {
  if command -v node >/dev/null 2>&1 && [ -d node_modules/tsx ]; then
    node --import tsx "$@"
  elif command -v mise >/dev/null 2>&1; then
    mise exec -- node --import tsx "$@"
  else
    echo "${LOG_PREFIX} node/tsx not found (checked PATH and mise)" >&2
    return 127
  fi
}

# スリープ明けは名前解決を待ってから取りに行く
source scripts/lib/wait-for-network.sh
wait_for_network www1.mbrace.or.jp

echo "${LOG_PREFIX} fetch:official-results ${FROM}..${TO}"
export BOAT_PON_SKIP_EXISTING=1
# 公式アーカイブの公開が遅れた日があると取り込みは終了コード 1 になる。
# set -e のまま止めると、取り込めた日の BUY 結果通知まで送られなくなるので、ここでは止めない。
run_tsx scripts/fetch-official-results.ts "$FROM" "$TO" || echo "${LOG_PREFIX} fetch:official-results partial failure (exit=$?); continuing to notify"

# 全券種の払戻・各艇の成績・気象の欠けを、手元の K ファイルから埋める（外部へのアクセスなし。取り込み済みの日は飛ばす）。
# 上の取り込みは「結果が入っている日」を飛ばすので、古いコードが結果だけを入れた日（2026-06-02〜10-06、10-29〜11-14）は
# 払戻が空のまま残った。一度きりの手作業にせず、毎晩ここで直近 200 日の欠けを見て埋める（知識ベースの教訓 3）。
# 欠けが無い晩は、何も書かずに 1 秒ほどで終わる。失敗しても、下の結果通知は止めない。
# まとめて書くのは、レースの無い時間（21:05〜07:30）だけ。スリープ明けで昼に動いた回は、1回 5 日分までにする
# （その日の結果の取り込みと同じくらいの書き込み量。昼のオッズの収集と判定を待たせない）。
BACKFILL_FROM=$(TZ=Asia/Tokyo date -v-200d '+%y%m%d')
NOW_HM=$((10#$(TZ=Asia/Tokyo date '+%H%M')))
if (( NOW_HM >= 2105 || NOW_HM < 730 )); then BACKFILL_LIMIT=200; else BACKFILL_LIMIT=5; fi
echo "${LOG_PREFIX} reparse:official-results --from ${BACKFILL_FROM} --skip-existing --limit ${BACKFILL_LIMIT}"
run_tsx scripts/reparse-official-results.ts --from "$BACKFILL_FROM" --skip-existing --limit "$BACKFILL_LIMIT" || echo "${LOG_PREFIX} reparse:official-results failed (exit=$?); continuing to notify"

# 結果取得後、直近14日で未通知のpaper-live BUY事後結果を送る。
# notification_logの専用キーで重複送信を防ぐ。
run_tsx scripts/notify-line.ts results --from "$FROM" --to "$TO" || echo "${LOG_PREFIX} line buy results skipped or failed"
