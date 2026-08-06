#!/usr/bin/env bash
set -euo pipefail

RUNNER_DIR="${BOAT_PON_RUNNER_DIR:-/Users/m-shogo/actions-runner-boat-pon}"
EXPECTED_OWNER="${BOAT_PON_RUNNER_OWNER:-$(id -un)}"
ALLOW_NON_DARWIN="${BOAT_PON_RUNNER_ALLOW_NON_DARWIN:-0}"
SKIP_NETWORK="${BOAT_PON_RUNNER_SKIP_NETWORK:-0}"

if [[ "$(uname -s)" != "Darwin" && "$ALLOW_NON_DARWIN" != "1" ]]; then
  printf '%s\n' '{"status":"BLOCKED","blockers":["MACOS_REQUIRED"]}'
  exit 3
fi

blockers=()
runner_exists=false
runner_is_symlink=false
runner_owner=""
registration_exists=false
service_script_exists=false
service_script_executable=false
service_status_exit=null
service_running=false
listener_running=false
github_reachable=null
api_github_reachable=null

if [[ -e "$RUNNER_DIR" ]]; then
  runner_exists=true
  if [[ -L "$RUNNER_DIR" ]]; then
    runner_is_symlink=true
    blockers+=("RUNNER_DIR_SYMLINK_NOT_ALLOWED")
  elif [[ ! -d "$RUNNER_DIR" ]]; then
    blockers+=("RUNNER_DIR_NOT_DIRECTORY")
  else
    if stat -f '%Su' "$RUNNER_DIR" >/dev/null 2>&1; then
      runner_owner="$(stat -f '%Su' "$RUNNER_DIR")"
    else
      runner_owner="$(stat -c '%U' "$RUNNER_DIR")"
    fi
    if [[ "$runner_owner" != "$EXPECTED_OWNER" ]]; then
      blockers+=("RUNNER_OWNER_MISMATCH")
    fi
  fi
else
  blockers+=("RUNNER_DIR_NOT_FOUND")
fi

if [[ -d "$RUNNER_DIR" && ! -L "$RUNNER_DIR" ]]; then
  if [[ -f "$RUNNER_DIR/.runner" && ! -L "$RUNNER_DIR/.runner" ]]; then
    registration_exists=true
  else
    blockers+=("RUNNER_REGISTRATION_MISSING")
  fi

  if [[ -f "$RUNNER_DIR/svc.sh" && ! -L "$RUNNER_DIR/svc.sh" ]]; then
    service_script_exists=true
    if [[ -x "$RUNNER_DIR/svc.sh" ]]; then
      service_script_executable=true
      set +e
      (
        cd "$RUNNER_DIR"
        ./svc.sh status >/dev/null 2>&1
      )
      status_code=$?
      set -e
      service_status_exit=$status_code
      if [[ "$status_code" -eq 0 ]]; then
        service_running=true
      fi
    else
      blockers+=("RUNNER_SERVICE_SCRIPT_NOT_EXECUTABLE")
    fi
  else
    blockers+=("RUNNER_SERVICE_SCRIPT_MISSING")
  fi
fi

if pgrep -f '[R]unner.Listener' >/dev/null 2>&1; then
  listener_running=true
fi

if [[ "$SKIP_NETWORK" != "1" ]]; then
  if command -v curl >/dev/null 2>&1; then
    if curl -fsSI --max-time 5 https://github.com/ >/dev/null 2>&1; then
      github_reachable=true
    else
      github_reachable=false
      blockers+=("GITHUB_UNREACHABLE")
    fi
    if curl -fsSI --max-time 5 https://api.github.com/ >/dev/null 2>&1; then
      api_github_reachable=true
    else
      api_github_reachable=false
      blockers+=("GITHUB_API_UNREACHABLE")
    fi
  else
    blockers+=("CURL_NOT_FOUND")
  fi
fi

if [[ "$registration_exists" == true && "$service_script_executable" == true ]]; then
  if [[ "$service_running" != true && "$listener_running" != true ]]; then
    blockers+=("RUNNER_NOT_RUNNING")
  fi
fi

status="READY"
start_recommended=false
if [[ ${#blockers[@]} -gt 0 ]]; then
  status="BLOCKED"
  if [[ "$registration_exists" == true && "$service_script_executable" == true \
      && "$service_running" != true && "$listener_running" != true ]]; then
    start_recommended=true
  fi
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

export RUNNER_DIR EXPECTED_OWNER status BLOCKERS_JSON runner_exists runner_is_symlink runner_owner
export registration_exists service_script_exists service_script_executable service_status_exit
export service_running listener_running github_reachable api_github_reachable start_recommended
python3 - <<'PY'
import json, os

def parse_bool(name):
    return os.environ[name] == "true"

def parse_nullable(name):
    value = os.environ[name]
    if value == "null":
        return None
    if value in {"true", "false"}:
        return value == "true"
    return int(value)

print(json.dumps({
    "evidenceVersion": "boat-pon-self-hosted-runner-diagnosis-v1",
    "status": os.environ["status"],
    "blockers": json.loads(os.environ["BLOCKERS_JSON"]),
    "runnerDir": os.environ["RUNNER_DIR"],
    "expectedOwner": os.environ["EXPECTED_OWNER"],
    "runnerExists": parse_bool("runner_exists"),
    "runnerDirSymlink": parse_bool("runner_is_symlink"),
    "runnerOwner": os.environ["runner_owner"] or None,
    "registrationExists": parse_bool("registration_exists"),
    "serviceScriptExists": parse_bool("service_script_exists"),
    "serviceScriptExecutable": parse_bool("service_script_executable"),
    "serviceStatusExitCode": parse_nullable("service_status_exit"),
    "serviceRunning": parse_bool("service_running"),
    "listenerRunning": parse_bool("listener_running"),
    "githubReachable": parse_nullable("github_reachable"),
    "githubApiReachable": parse_nullable("api_github_reachable"),
    "startRecommended": parse_bool("start_recommended"),
    "registrationChanged": False,
    "tokenRequested": False,
    "runnerRemoved": False,
}, ensure_ascii=False, indent=2))
PY

[[ "$status" == "READY" ]] || exit 3
