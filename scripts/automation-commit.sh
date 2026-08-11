#!/usr/bin/env bash
# automation 結果を allowlist path だけ、automation branch へ safe commit / push する。
# force push / reset / 無関係 path / 大容量 file / DB / archive は拒否する。
# branch 切替で結果を失わないよう、対象 file を一時領域へ退避してから切り替える。
set -euo pipefail

# GitHub Actions の write token はこの trusted helper だけが受け取り、即座に環境から外す。
# 以降の node/git 等 child process へ raw token を継承させず、push 1 command だけの header に使う。
PUSH_TOKEN="${BOAT_PON_AUTOMATION_PUSH_TOKEN:-}"
unset BOAT_PON_AUTOMATION_PUSH_TOKEN
EXPECTED_BASE_SHA="${EXPECTED_AUTOMATION_BRANCH_BASE:-}"
unset EXPECTED_AUTOMATION_BRANCH_BASE
TRUSTED_GIT_BIN="${TRUSTED_GIT_BIN:-}"
TRUSTED_NODE_BIN="${TRUSTED_NODE_BIN:-}"
case "$TRUSTED_GIT_BIN" in /*) ;; *) echo "::error::missing or invalid trusted git binary path"; exit 1 ;; esac
case "$TRUSTED_NODE_BIN" in /*) ;; *) echo "::error::missing or invalid trusted node binary path"; exit 1 ;; esac
if [ ! -x "$TRUSTED_GIT_BIN" ] || [ ! -x "$TRUSTED_NODE_BIN" ]; then
  echo "::error::trusted git/node binary is not executable"
  exit 1
fi

BRANCH="automation/boat-pon-research"
AUTHORITY_REMOTE_URL="https://github.com/m-shogo/boat-pon.git"
ALLOWED_PREFIXES=("automation/control/" "automation/requests/" "reports/automation/" "docs/automation/" "research/registries/experiments/" "research/registries/discoveries/")
IMMUTABLE_PREFIXES=("reports/automation/history/" "reports/automation/retained-outputs/" "research/registries/experiments/" "research/registries/discoveries/")
ALLOWED_EXACT=(
  "reports/n2/n2-dataset-canary.json"
  "reports/n2/n2-corrected-eligibility.json"
  "reports/n2/n2-win-refund-omission-audit.json"
  "reports/n2/n2-dataset-inventory.json"
  "reports/n2/n2-holdout-freeze.json"
  "reports/n2/n2-feature-coverage-audit.json"
  "reports/n2/n2-dataset-manifest.json"
  "reports/n2/n2-pit-audit.json"
  "reports/n2/n2-observation-ingest-readiness.json"
  "reports/n2/n2-official-program-canary-review-bundle.json"
)
MAX_BYTES=2097152

# task code は同じ job で動き、$GITHUB_ENV / $GITHUB_PATH 経由で後続 step の実行環境を変更できる。
# trusted helper は task-controlled PATH・Git/Node preload・dynamic-loader・proxy 環境を継承しない。
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
while IFS= read -r env_name; do
  case "$env_name" in
    GIT_*|DYLD_*) unset "$env_name" ;;
  esac
done < <(compgen -e)
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy
unset NODE_OPTIONS NODE_PATH BASH_ENV ENV LD_PRELOAD LD_LIBRARY_PATH
# self-hosted runner の user/system git config も task が永続変更できるため、trusted helper では参照しない。
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null

# task code は同じ worktree を使うため、repo-local git hooks / fsmonitor / commit signing を信頼しない。
# post-checkout / pre-commit / pre-push / gpg.program 等から CAS・index・push credential 境界を変更させない。
git_no_hooks() {
  "$TRUSTED_GIT_BIN" -c core.hooksPath=/dev/null -c core.fsmonitor=false -c commit.gpgSign=false "$@"
}

# task は .git/config を変更できるため、固定 URL を使っても url.*.insteadOf や
# http.* / credential.* で transport を別 endpoint / proxy / helper へ向けられる。
# trusted fetch/push の直前に repo-local transport config が一切無いことを要求する。
assert_trusted_transport_config() {
  local unsafe
  unsafe="$(git_no_hooks config --local --includes --name-only --get-regexp '^(http\.|url\.|credential\.|include(if)?\.)' 2>/dev/null || true)"
  if [ -n "$unsafe" ]; then
    echo "::error::untrusted repo-local git transport config detected; refusing authority network operation"
    printf '%s\n' "$unsafe" >&2
    exit 1
  fi
}

# task-controlled .git/config の core.worktree 等で Git が別 worktree を authority として
# 解釈しても、trusted helper 開始時の physical cwd から逸脱した top-level は受け入れない。
START_REPO_ROOT="$(pwd -P)"
GIT_TOP_LEVEL="$(git_no_hooks rev-parse --show-toplevel)"
if [ ! -d "$GIT_TOP_LEVEL" ]; then
  echo "::error::git top-level is not a directory; refusing untrusted worktree identity"
  exit 1
fi
GIT_TOP_LEVEL_PHYSICAL="$(cd "$GIT_TOP_LEVEL" && pwd -P)"
if [ "$GIT_TOP_LEVEL_PHYSICAL" != "$START_REPO_ROOT" ]; then
  echo "::error::git top-level escaped trusted physical cwd; refusing untrusted worktree identity"
  exit 1
fi
cd "$START_REPO_ROOT"
REPO_ROOT="$START_REPO_ROOT"

# 変更 path を取得（untracked 含む）。-uall で新規ディレクトリを個別 file まで展開する
# （git は全 untracked な新規 dir を "dir/" に畳むため、-uall が無いと control/ を取りこぼす）。
# macOS 標準 Bash 3.2 に無い mapfile は使わず、配列へ1行ずつ追加する。
CHANGED=()
while IFS= read -r changed_path; do
  CHANGED+=("$changed_path")
done < <(git_no_hooks status --porcelain -uall | sed 's/^...//' | sed 's/^"//;s/"$//' | sort -u)
if [ "${#CHANGED[@]}" -eq 0 ]; then
  echo "NO_CHANGE: nothing to commit"
  exit 0
fi

# intent workflow が置く一時 file は commit 対象外（skip）。
TRANSIENT=("canonical-request.json")

# allowlist / 安全性検査。
KEEP=()
for path in "${CHANGED[@]}"; do
  [ -z "$path" ] && continue
  skip=false
  for tr in "${TRANSIENT[@]}"; do [ "$path" = "$tr" ] && skip=true; done
  [ "$skip" = true ] && continue
  allowed=false
  for exact in "${ALLOWED_EXACT[@]}"; do
    [ "$path" = "$exact" ] && allowed=true
  done
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

# Immutable retained outputs are commit-eligible only when the same run's new
# terminal history references every retained path. Run this only after path and
# symlink validation so its history reads cannot traverse an unsafe candidate.
# This trusted boundary intentionally uses a dependency-free Node script so task-controlled
# node_modules/tsx cannot bypass the retained-output gate after task execution.
"$TRUSTED_NODE_BIN" scripts/check-research-retained-output-commit.mjs --run-id="${RUN_ID:-local}"

if [ "${#KEEP[@]}" -eq 0 ]; then
  echo "NO_CHANGE: no allowlisted files to commit"
  exit 0
fi

# materialize step が固定した automation branch SHA 以外は CAS authority として受け入れない。
# task-writable worktree file は参照しない。
if ! [[ "$EXPECTED_BASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::missing or invalid trusted automation branch base SHA"
  exit 1
fi

# 結果を一時領域へ退避（branch 切替で失わないため）。
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
for path in "${KEEP[@]}"; do
  mkdir -p "$STAGE/$(dirname "$path")"
  cp "$path" "$STAGE/$path"
done

git_no_hooks config user.name "boat-pon-automation"
git_no_hooks config user.email "automation@boat-pon.invalid"

# 作業ツリーを clean にしてから branch を切り替える（結果は STAGE にある）。
git_no_hooks checkout -- . 2>/dev/null || true
git_no_hooks clean -fdq -- automation reports docs research 2>/dev/null || true

# task-controlled transport config で canonical repository URL 自体を rewrite/proxy させない。
assert_trusted_transport_config
# task-controlled remote.origin.* をauthorityとして使わず、trusted GitHub repository URLへ直接fetchする。
git_no_hooks fetch "$AUTHORITY_REMOTE_URL" "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" --quiet
# compare-and-swap: materialize 時点の trusted step output から branch が進んでいたら
# control state を上書きせず fail-closed（concurrent 変更の silent clobber を防ぐ）。
CUR_SHA="$(git_no_hooks rev-parse "origin/$BRANCH" 2>/dev/null || echo none)"
if [ "$EXPECTED_BASE_SHA" != "$CUR_SHA" ]; then
  echo "::error::automation branch advanced during run ($EXPECTED_BASE_SHA -> $CUR_SHA); CAS conflict, refusing to clobber. re-dispatch to retry."
  exit 1
fi

# history / retained output / registry は append-only。authority branch に既存の同一pathがある場合、
# taskが内容を書き換えることを許可せず、完全同一bytesだけをidempotentとして受け入れる。
for path in "${KEEP[@]}"; do
  immutable=false
  for prefix in "${IMMUTABLE_PREFIXES[@]}"; do
    case "$path" in "$prefix"*) immutable=true ;; esac
  done
  [ "$immutable" = true ] || continue
  if git_no_hooks cat-file -e "origin/$BRANCH:$path" 2>/dev/null; then
    authority_hash="$(git_no_hooks rev-parse "origin/$BRANCH:$path")"
    source_hash="$(git_no_hooks hash-object --no-filters "$STAGE/$path")"
    if [ "$authority_hash" != "$source_hash" ]; then
      echo "::error::refusing to rewrite immutable research output: $path"
      exit 1
    fi
  fi
done

if git_no_hooks show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git_no_hooks checkout -B "$BRANCH" "origin/$BRANCH" --quiet
else
  git_no_hooks checkout -B "$BRANCH" --quiet
fi

# 退避した結果を書き戻す。
for path in "${KEEP[@]}"; do
  mkdir -p "$(dirname "$REPO_ROOT/$path")"
  cp "$STAGE/$path" "$REPO_ROOT/$path"
  git_no_hooks add -- "$path"
done

# task-controlled attributes / clean filters が git add 中に index を拡張・変換しても、
# allowlist外pathや退避元bytesと異なるblobは commit 前に必ず拒否する。
while IFS= read -r -d '' staged_path; do
  expected=false
  for path in "${KEEP[@]}"; do
    [ "$staged_path" = "$path" ] && expected=true
  done
  if [ "$expected" != true ]; then
    echo "::error::unexpected staged path after allowlist staging: $staged_path"
    exit 1
  fi
  source_path="$STAGE/$staged_path"
  if [ ! -f "$source_path" ]; then
    echo "::error::missing staged source copy: $staged_path"
    exit 1
  fi
  source_hash="$(git_no_hooks hash-object --no-filters "$source_path")"
  index_hash="$(git_no_hooks rev-parse ":$staged_path" 2>/dev/null || echo none)"
  if [ "$source_hash" != "$index_hash" ]; then
    echo "::error::staged blob differs from validated source bytes: $staged_path"
    exit 1
  fi
done < <(git_no_hooks diff --cached --name-only -z)

# git add は task-controlled clean filter を実行し得るため、fetch 前の検査だけでは不十分。
# filter の副作用で repo-local transport config が再注入されても、commit/push 境界へ進ませない。
assert_trusted_transport_config

if git_no_hooks diff --cached --quiet; then
  echo "NO_CHANGE: nothing staged after allowlist filter"
  git_no_hooks checkout main --quiet || true
  exit 0
fi

REQ_ID="$("$TRUSTED_NODE_BIN" -e "try{const s=require('./reports/automation/current-status.json');process.stdout.write(String(s.lastRequestId??'none'))}catch{process.stdout.write('none')}" 2>/dev/null || echo none)"
TASK_ID="$("$TRUSTED_NODE_BIN" -e "try{const s=require('./reports/automation/current-status.json');process.stdout.write(String(s.lastTaskId??'none'))}catch{process.stdout.write('none')}" 2>/dev/null || echo none)"

git_no_hooks commit -q -m "report(automation): research run ${RUN_ID:-local} (request ${REQ_ID}, task ${TASK_ID})"
if [ -n "$PUSH_TOKEN" ]; then
  auth_header="$(printf 'x-access-token:%s' "$PUSH_TOKEN" | base64 | tr -d '\n')"
  git_no_hooks -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth_header" push "$AUTHORITY_REMOTE_URL" "$BRANCH" --quiet
else
  git_no_hooks push "$AUTHORITY_REMOTE_URL" "$BRANCH" --quiet
fi
echo "pushed to $BRANCH"

# 次回 run のために main へ戻す（runner の作業ツリーを既定状態に保つ）。
git_no_hooks checkout main --quiet || true
