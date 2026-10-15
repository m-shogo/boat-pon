# shellcheck shell=bash
# スリープから復帰した直後は、名前解決がまだできないことがある。
# 2026-10-15 は 20:52〜22:02 のスリープ明けに 21:30 のジョブが動き、結果の取り込みが "fetch failed"（10/14 の分）になった。
# 使い方: source scripts/lib/wait-for-network.sh; wait_for_network www1.mbrace.or.jp
# 名前が引けるまで 5 秒ごとに最大 2 分待つ。引けなくても止めずに続ける（取り込み側が失敗を記録し、翌日に取り直す）。
wait_for_network() {
  local host="$1" waited=0
  while [ "$waited" -lt 120 ]; do
    if /usr/bin/dscacheutil -q host -a name "$host" 2>/dev/null | grep -q '^ip_address'; then
      [ "$waited" -gt 0 ] && echo "network: ${host} を ${waited} 秒待って引けた"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done
  echo "network: ${host} を 120 秒引けないまま続ける" >&2
  return 0
}
