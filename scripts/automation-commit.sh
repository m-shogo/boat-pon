#!/usr/bin/env bash
# automation 結果を allowlist path だけ、automation branch へ safe commit / push する。
# force push / reset / 無関係 path / 大容量 file / DB / archive は拒否する。
# branch 切替で結果を失わないよう、対象 file を一時領域へ退避してから切り替える。
set -euo pipefail

BRANCH="automation/boat-pon-research"
ALLOWED_PREFIXES=("automation/control/" "automation/requests/" "reports/automation/" "docs/automation/" "reports/n2/n2-dataset-canary." "reports/n2/n2-corrected-eligibility." "reports/n2/n2-win-refund-omission-audit." "reports/n2/n2-dataset-inventory." "reports/n2/n2-holdout-freeze." "reports/n2/n2-feature-coverage-audit." "reports/n2/n2-dataset-manifest." "reports/n2/n2-pit-audit." "reports/n2/n2-observation-ingest-readiness." "reports/n2/n2-official-program-canary-review-bundle." "research/registries/experiments/" "research/registries/discoveries/")
MAX_BYTES=2097152

cd "$(git rev-parse --show-toplevel)"
REPO_ROOT="$(pwd)"

# 変更 path を取得（untracked 含む）。-uall で新規ディレクトリを個別 file まで展開する
# （git は全 untracked な新規 dir を "dir/" に畳むため、-uall が無いと control/ を取りこぼす）。
mapfile -t CHANGED < <(git status --porcelain -uall | sed 's/^...//' | sed 's/^"//;s/"$//' | sort -u)
if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "NO_CHANGE: nothing to commit"
  exit 0
fi

# Immutable retained outputs are commit-eligible only when the same run's new
# terminal history references every retained path. This closes the crash window
# between retained-file materialization and terminal history persistence: an
# orphan retained file is never pushed to the automation state branch.
node --import tsx scripts/check-research-retained-output-commit.ts --run-id="${RUN_ID:-local}"

# intent workflow が置く一時 file は commit 対象外（skip）。
TRANSIENT=("canonical-request.json" ".automation-branch-base")

# allowlist / 安全性検査。
KEEP=()
for path in "${CHANGED[@]}"; do
  [ -z "$path" ] && continue
  skip=false
  for tr in "${TRANSIENT[@]}"; do [ "$path" = "$tr" ] && skip=true; done
  [ "$skip" = true ] && continue
  allowed=false
  for prefix in "${ALLOWED_PREFIXES[@]}"; do
    case "$path" in "$prefix"*) allowed=true ;; esac
  done
  if [ "$allowed" != true ]; then
    echo "::error::path not in allowlist, refusing to commit: $path"
    exit 1
  fi
  case "$path" in
    *..*|/*) echo "::error::unsafe path: $path"; exit 1 ;;
    *.sqlite|*.sqlite-*|*.lzh|*.zip|*.model|*.bin)
      echo "::error::refusing to commit DB/archive/model artifact: $path"; exit 1 ;;
  esac
  probe="$path"
  while [ "$probe" != "." ] && [ "$probe" != "/" ]; do
    if [ -L "$probe" ]; then
      echo "::error::refusing to commit through symbolic link: $probe (candidate: $path)"
      exit 1
    fi
    probe="$(dirname "$probe")"
  done
  if [ -f "$path" ]; then
    size=$(wc -c < "$path" | tr -d ' ')
    if [ "$size" -gt "$MAX_BYTES" ]; then
      echo "::error::file too large ($size bytes): $path"; exit 1
    fi
    KEEP+=("$path")
  fi
done

if [ "${#KEEP[@]}" -eq 0 ]; then
  echo "NO_CHANGE: no allowlisted files to commit"
  exit 0
fi

# 結果を一時領域へ退避（branch 切替で失わないため）。
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
for path in "${KEEP[@]}"; do
  mkdir -p "$STAGE/$(dirname "$path")"
  cp "$path" "$STAGE/$path"
done

git config user.name "boat-pon-automation"
git config user.email "automation@boat-pon.invalid"

# 作業ツリーを clean にしてから branch を切り替える（結果は STAGE にある）。
git checkout -- . 2>/dev/null || true
git clean -fdq -- automation reports docs 2>/dev/null || true

git fetch origin --quiet
# compare-and-swap: materialize 時点の automation branch base SHA から進んでいたら
# control state を上書きせず fail-closed（concurrent 変更の silent clobber を防ぐ）。
if [ -f .automation-branch-base ]; then
  BASE_SHA="$(cat .automation-branch-base)"
  CUR_SHA="$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo none)"
  if [ "$BASE_SHA" != "$CUR_SHA" ]; then
    echo "::error::automation branch advanced during run ($BASE_SHA -> $CUR_SHA); CAS conflict, refusing to clobber. re-dispatch to retry."
    rm -f .automation-branch-base
    exit 1
  fi
  rm -f .automation-branch-base
fi
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git checkout -B "$BRANCH" "origin/$BRANCH" --quiet
else
  git checkout -B "$BRANCH" --quiet
fi

# 退避した結果を書き戻す。
for path in "${KEEP[@]}"; do
  mkdir -p "$(dirname "$REPO_ROOT/$path")"
  cp "$STAGE/$path" "$REPO_ROOT/$path"
  git add -- "$path"
done

if git diff --cached --quiet; then
  echo "NO_CHANGE: nothing staged after allowlist filter"
  git checkout main --quiet || true
  exit 0
fi

REQ_ID="$(node -e "try{const s=require('./reports/automation/current-status.json');process.stdout.write(String(s.lastRequestId??'none'))}catch{process.stdout.write('none')}" 2>/dev/null || echo none)"
TASK_ID="$(node -e "try{const s=require('./reports/automation/current-status.json');process.stdout.write(String(s.lastTaskId??'none'))}catch{process.stdout.write('none')}" 2>/dev/null || echo none)"

git commit -q -m "report(automation): research run ${RUN_ID:-local} (request ${REQ_ID}, task ${TASK_ID})"
git push origin "$BRANCH" --quiet
echo "pushed to $BRANCH"

# 次回 run のために main へ戻す（runner の作業ツリーを既定状態に保つ）。
git checkout main --quiet || true
