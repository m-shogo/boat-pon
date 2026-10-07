#!/bin/bash
# 毎晩の「成長ループ」: 測る → 蓄積する → 週1回だけ自動で改善を試す → 公開版を置く。
#   1. scripts/run-accuracy-growth.ts（前回から6日未満なら何もしない）: 市場補正パラメータの挑戦者評価
#   2. scripts/report-accuracy-scorecard.ts --state-dir: 当たり外れ・精度・健全性・成長を集計し、履歴とイベントに追記
#   3. 公開版（集計値だけ）を automation/scorecard ブランチへ置く。ChatGPT の日次タスクはここだけを根拠に報告する
#   4. 同じ JSON を data/reports/scorecard/latest.json にも置く（LINE の日次まとめが精度の行に使う）
# launchd から毎日 22:15 JST に呼ぶ想定（daily-results 21:30 のあと）。登録はユーザーが行う:
#   docs/launchd/com.boatpon.scorecard-publish.plist / docs/chatgpt-scheduled-task-bridge.md
# 作業ツリー（launchd が実行している main の checkout）は触らず、別 worktree で commit・push する。
set -euo pipefail
cd "$(dirname "$0")/.."

BRANCH="automation/scorecard"
STATE_DIR="data/reports/scorecard"
WT="${BOAT_PON_SCORECARD_WORKTREE:-$HOME/Library/Application Support/BoatPon/scorecard-worktree}"
TODAY=$(TZ=Asia/Tokyo date +%Y-%m-%d)
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

# BOAT_PON_SCORECARD_DRY_RUN=1 のときは git を触らず、一時フォルダに生成して公開境界チェックまでを行う。
DRY_RUN="${BOAT_PON_SCORECARD_DRY_RUN:-0}"
if [ "$DRY_RUN" = "1" ]; then
  WT=$(mktemp -d)
  echo "${LOG_PREFIX} dry-run: writing to ${WT}"
fi

if [ "$DRY_RUN" != "1" ]; then
  git fetch -q origin "$BRANCH" 2>/dev/null || true
  if [ ! -e "$WT/.git" ]; then
    if git show-ref -q --verify "refs/remotes/origin/$BRANCH"; then
      git worktree add -q -B "$BRANCH" "$WT" "origin/$BRANCH"
    else
      git worktree add -q --orphan -b "$BRANCH" "$WT"
    fi
  fi
  git -C "$WT" pull -q --ff-only origin "$BRANCH" 2>/dev/null || true
fi
mkdir -p "$WT/scorecard"

if [ "$DRY_RUN" = "1" ]; then
  # dry-run では履歴・イベント・王者を変えない。
  run_tsx scripts/report-accuracy-scorecard.ts --public --output "$WT/scorecard/latest.md" --json-output "$WT/scorecard/latest.json"
else
  mkdir -p "$STATE_DIR"
  run_tsx scripts/run-accuracy-growth.ts --state-dir "$STATE_DIR" || echo "${LOG_PREFIX} accuracy growth failed (exit=$?); continuing"
  run_tsx scripts/report-accuracy-scorecard.ts --public --state-dir "$STATE_DIR" --output "$WT/scorecard/latest.md" --json-output "$WT/scorecard/latest.json"
fi

# 公開境界: レース ID・買い目・オッズは出さない（--public の取りこぼしがあれば公開しない）。
if grep -qE '[0-9]{8}-[^ |]+-[0-9]{2}|"(raceId|selection|quoteOdds|currentOdds|recentBuys)"|直近10件|買い目' "$WT/scorecard/latest.md" "$WT/scorecard/latest.json"; then
  echo "${LOG_PREFIX} public boundary violation in scorecard; not publishing" >&2
  exit 1
fi
cp "$WT/scorecard/latest.md" "$WT/scorecard/$TODAY.md"
[ "$DRY_RUN" = "1" ] || cp "$WT/scorecard/latest.json" "$STATE_DIR/latest.json"
if [ "$DRY_RUN" = "1" ]; then
  echo "${LOG_PREFIX} dry-run ok: $(ls "$WT/scorecard" | tr '\n' ' ')"
  exit 0
fi

git -C "$WT" add scorecard
if git -C "$WT" diff --cached --quiet; then
  echo "${LOG_PREFIX} scorecard unchanged: ${TODAY}"
  exit 0
fi
git -C "$WT" commit -q -m "scorecard: ${TODAY}"
git -C "$WT" push -q origin "$BRANCH"
echo "${LOG_PREFIX} scorecard published: ${TODAY}"
