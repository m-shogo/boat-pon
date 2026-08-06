#!/usr/bin/env bash
set -euo pipefail

RUNNER_DIR="${BOAT_PON_RUNNER_DIR:-/Users/m-shogo/actions-runner-boat-pon}"
EXPECTED_OWNER="${BOAT_PON_RUNNER_OWNER:-$(id -un)}"
ALLOW_NON_DARWIN="${BOAT_PON_RUNNER_ALLOW_NON_DARWIN:-0}"
START_REQUESTED=false

for arg in "$@"; do
  case "$arg" in
    --start) START_REQUESTED=true ;;
    *)
      printf '%s\n' '{"status":"BLOCKED","blockers":["UNKNOWN_ARGUMENT"]}'
      exit 2
      ;;
  esac
done

if [[ "$START_REQUESTED" != true ]]; then
  printf '%s\n' '{"status":"BLOCKED","blockers":["EXPLICIT_--start_REQUIRED"],"serviceStartExecuted":false}'
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" && "$ALLOW_NON_DARWIN" != "1" ]]; then
  printf '%s\n' '{"status":"BLOCKED","blockers":["MACOS_REQUIRED"],"serviceStartExecuted":false}'
  exit 3
fi

blockers=()
service_start_executed=false
already_running=false
verified_running=false
start_exit_code=null
status_exit_code_before=null
status_exit_code_after=null

if [[ ! -d "$RUNNER_DIR" || -L "$RUNNER_DIR" ]]; then
  blockers+=("RUNNER_DIR_INVALID")
else
  if stat -f '%Su' "$RUNNER_DIR" >/dev/null 2>&1; then
    owner="$(stat -f '%Su' "$RUNNER_DIR")"
  else
    owner="$(stat -c '%U' "$RUNNER_DIR")"
  fi
  if [[ "$owner" != "$EXPECTED_OWNER" ]]; then
    blockers+=("RUNNER_OWNER_MISMATCH")
  fi
fi

if [[ ! -f "$RUNNER_DIR/.runner" || -L "$RUNNER_DIR/.runner" ]]; then
  blockers+=("RUNNER_REGISTRATION_MISSING")
fi
if [[ ! -f "$RUNNER_DIR/svc.sh" || -L "$RUNNER_DIR/svc.sh" ]]; then
  blockers+=("RUNNER_SERVICE_SCRIPT_MISSING")
elif [[ ! -x "$RUNNER_DIR/svc.sh" ]]; then
  blockers+=("RUNNER_SERVICE_SCRIPT_NOT_EXECUTABLE")
fi

if [[ ${#blockers[@]} -eq 0 ]]; then
  set +e
  (
    cd "$RUNNER_DIR"
    ./svc.sh status >/dev/null 2>&1
  )
  status_exit_code_before=$?
  set -e

  if [[ "$status_exit_code_before" -eq 0 ]] || pgrep -f '[R]unner.Listener' >/dev/null 2>&1; then
    already_running=true
    verified_running=true
  else
    service_start_executed=true
    set +e
    (
      cd "$RUNNER_DIR"
      ./svc.sh start >/dev/null 2>&1
    )
    start_exit_code=$?
    set -e

    if [[ "$start_exit_code" -ne 0 ]]; then
      blockers+=("RUNNER_SERVICE_START_FAILED")
    else
      sleep "${BOAT_PON_RUNNER_START_VERIFY_DELAY_SECONDS:-2}"
      set +e
      (
        cd "$RUNNER_DIR"
        ./svc.sh status >/dev/null 2>&1
      )
      status_exit_code_after=$?
      set -e
      if [[ "$status_exit_code_after" -eq 0 ]] || pgrep -f '[R]unner.Listener' >/dev/null 2>&1; then
        verified_running=true
      else
        blockers+=("RUNNER_START_NOT_VERIFIED")
      fi
    fi
  fi
fi

status="PASS"
if [[ ${#blockers[@]} -gt 0 ]]; then
  status="BLOCKED"
fi

BLOCKERS_JSON="[]"
if [[ ${#blockers[@]} -gt 0 ]]; then
  BLOCKERS_JOINED="$(printf '%s\n' "${blockers[@]}")"
  export BLOCKERS_JOINED
  BLOCKERS_JSON="$(python3 - <<'PY'
import json, os
print(json.dumps([line for line in os.environ.get("BLOCKERS_JOINED", "").splitlines() if line]))
PY
)"
fi

export RUNNER_DIR EXPECTED_OWNER status BLOCKERS_JSON service_start_executed already_running
export verified_running start_exit_code status_exit_code_before status_exit_code_after
python3 - <<'PY'
import json, os

def parse_bool(name):
    return os.environ[name] == "true"

def parse_nullable_int(name):
    value = os.environ[name]
    return None if value == "null" else int(value)

print(json.dumps({
    "evidenceVersion": "boat-pon-self-hosted-runner-recovery-v1",
    "status": os.environ["status"],
    "blockers": json.loads(os.environ["BLOCKERS_JSON"]),
    "runnerDir": os.environ["RUNNER_DIR"],
    "expectedOwner": os.environ["EXPECTED_OWNER"],
    "alreadyRunning": parse_bool("already_running"),
    "serviceStartExecuted": parse_bool("service_start_executed"),
    "serviceStartExitCode": parse_nullable_int("start_exit_code"),
    "serviceStatusExitCodeBefore": parse_nullable_int("status_exit_code_before"),
    "serviceStatusExitCodeAfter": parse_nullable_int("status_exit_code_after"),
    "verifiedRunning": parse_bool("verified_running"),
    "registrationChanged": False,
    "registrationTokenRequested": False,
    "configurationExecuted": False,
    "runnerRemoved": False,
    "serviceReinstalled": False,
    "sudoUsed": False,
}, ensure_ascii=False, indent=2))
PY

[[ "$status" == "PASS" ]] || exit 3
