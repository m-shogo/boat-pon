#!/usr/bin/env bash
# automation 結果を allowlist path だけ、automation branch へ safe commit / push する。
# force push / reset / 無関係 path / 大容量 file / DB / archive は拒否する。
set -euo pipefail

BRANCH="automation/boat-pon-research"
ALLOWED_PREFIXES=("automation/" "reports/automation/" "docs/automation/")
MAX_BYTES=2097152

cd "$(git rev-parse --show-toplevel)"

# 変更 path を取得（untracked 含む）。
mapfile -t CHANGED < <(git status --porcelain | awk '{print $NF}' | sort -u)
if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "NO_CHANGE: nothing to commit"
  exit 0
fi

for path in "${CHANGED[@]}"; do
  allowed=false
  for prefix in "${ALLOWED_PREFIXES[@]}"; do
    case "$path" in
      "$prefix"*) allowed=true ;;
    esac
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
  if [ -f "$path" ]; then
    size=$(wc -c < "$path" | tr -d ' ')
    if [ "$size" -gt "$MAX_BYTES" ]; then
      echo "::error::file too large ($size bytes): $path"; exit 1
    fi
  fi
done

git config user.name "boat-pon-automation"
git config user.email "automation@boat-pon.invalid"

git fetch origin --quiet
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git checkout -B "$BRANCH" "origin/$BRANCH" --quiet
else
  git checkout -B "$BRANCH" --quiet
fi

for prefix in "${ALLOWED_PREFIXES[@]}"; do
  [ -e "$prefix" ] && git add -- "$prefix" || true
done

if git diff --cached --quiet; then
  echo "NO_CHANGE: nothing staged after allowlist filter"
  exit 0
fi

REQ_ID="$(node -e "try{const s=require('./reports/automation/current-status.json');process.stdout.write(String(s.lastRequestId??'none'))}catch{process.stdout.write('none')}" 2>/dev/null || echo none)"
TASK_ID="$(node -e "try{const s=require('./reports/automation/current-status.json');process.stdout.write(String(s.lastTaskId??'none'))}catch{process.stdout.write('none')}" 2>/dev/null || echo none)"

git commit -q -m "report(automation): research run ${RUN_ID:-local} (request ${REQ_ID}, task ${TASK_ID})"
git push origin "$BRANCH" --quiet
echo "pushed to $BRANCH"
