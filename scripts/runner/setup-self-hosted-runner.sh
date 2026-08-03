#!/usr/bin/env bash
# boat-pon repo-scoped macOS self-hosted runner のセットアップ。
#
# - repo-scoped（m-shogo/boat-pon 専用）
# - labels: self-hosted, macOS, boat-pon-local
# - registration token は gh で都度発行し、Git へは保存しない
# - runner credential（.credentials / .runner）は runner dir にのみ置き、Git へ入れない
# - runner は job 待機のみ。研究処理を自発的な定期実行はしない（schedule/cron を作らない）
set -euo pipefail

REPO="${BOAT_PON_REPO:-m-shogo/boat-pon}"
RUNNER_DIR="${BOAT_PON_RUNNER_DIR:-$HOME/actions-runner-boat-pon}"
RUNNER_NAME="${BOAT_PON_RUNNER_NAME:-boat-pon-mac-local}"
LABELS="${BOAT_PON_RUNNER_LABELS:-boat-pon-local}"
RUNNER_VERSION="${BOAT_PON_RUNNER_VERSION:-2.319.1}"

command -v gh >/dev/null || { echo "gh CLI is required"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh auth login required"; exit 1; }

arch="$(uname -m)"
case "$arch" in
  arm64) pkg="actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz" ;;
  x86_64) pkg="actions-runner-osx-x64-${RUNNER_VERSION}.tar.gz" ;;
  *) echo "unsupported arch: $arch"; exit 1 ;;
esac

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -f ./config.sh ]; then
  echo "downloading $pkg ..."
  curl -fsSL -o "$pkg" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${pkg}"
  tar xzf "$pkg"
  rm -f "$pkg"
fi

if [ -f .runner ]; then
  echo "runner already configured in $RUNNER_DIR"
else
  # registration token は短命。標準出力へ出さない。
  TOKEN="$(gh api -X POST "repos/${REPO}/actions/runners/registration-token" --jq .token)"
  ./config.sh --unattended --replace \
    --url "https://github.com/${REPO}" \
    --token "$TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$LABELS" \
    --work _work
  unset TOKEN
fi

echo "installing launchd service (runner waits for jobs; it does NOT schedule research)"
./svc.sh install || true
./svc.sh start || true
./svc.sh status || true

echo "done. verify with: gh api repos/${REPO}/actions/runners --jq '.runners[] | {name,status,labels:[.labels[].name]}'"
