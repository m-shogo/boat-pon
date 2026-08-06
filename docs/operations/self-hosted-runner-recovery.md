# Boat Pon self-hosted runner recovery

Status: safe diagnosis and existing-service start only  
Default runner directory: `/Users/m-shogo/actions-runner-boat-pon`  
Runner name observed historically: `boat-pon-mac-local`

## Purpose

Exact-time private odds capture installation currently waits because GitHub cannot assign the queued job to the Mac self-hosted runner. These commands diagnose and start the already configured runner service without re-registering or replacing it.

The recovery path intentionally cannot:

- run `config.sh`;
- request or accept a registration token;
- remove the existing runner registration;
- reinstall the runner service;
- delete the runner directory;
- use `sudo`;
- edit repository or runner configuration;
- execute a queued research task directly.

## Diagnose

```bash
npm run runner:diagnose
```

The diagnosis is read-only. It verifies:

- macOS execution;
- the runner directory exists and is not a symlink;
- the directory is owned by the current user;
- `.runner` registration metadata exists as a regular file;
- `svc.sh` exists and is executable;
- `svc.sh status` result;
- a `Runner.Listener` process when present;
- bounded unauthenticated HTTPS reachability to GitHub and the GitHub API.

It prints only sanitized booleans, exit codes and blocker codes. It does not print `.runner`, `.credentials`, service output, tokens or environment secrets.

A stopped but otherwise valid runner returns:

```text
status: BLOCKED
blocker: RUNNER_NOT_RUNNING
startRecommended: true
```

## Recover

```bash
npm run runner:recover
```

The package command supplies the required explicit `--start` flag. The script:

1. repeats the path, owner, registration and service-script guards;
2. checks the existing service status;
3. returns success without restarting when already running;
4. otherwise runs exactly one `./svc.sh start` from the existing runner directory;
5. checks service status or `Runner.Listener` again;
6. fails closed if start cannot be verified.

Direct invocation without explicit authority is rejected:

```bash
bash scripts/recover-boat-pon-self-hosted-runner.sh
# BLOCKED: EXPLICIT_--start_REQUIRED
```

## Expected recovery sequence

```bash
cd /Users/m-shogo/Developer/personal/boat-pon
npm run runner:diagnose
npm run runner:recover
npm run runner:diagnose
```

When the runner becomes available, the existing queued temporary installation PR may be assigned automatically. Always inspect the queued PR and its pinned authority before leaving it open.

## Overrides

The default directory is fixed for this Mac. A test or migrated installation may supply:

```bash
BOAT_PON_RUNNER_DIR=/absolute/path/to/actions-runner \
  npm run runner:diagnose
```

Owner expectation can be overridden only through:

```bash
BOAT_PON_RUNNER_OWNER=<local-user>
```

These overrides do not bypass registration or service-script checks.

## Blocker codes

| Code | Meaning |
|---|---|
| `MACOS_REQUIRED` | Recovery was invoked outside macOS. |
| `RUNNER_DIR_NOT_FOUND` / `RUNNER_DIR_INVALID` | Expected runner directory is absent, a symlink or not a directory. |
| `RUNNER_OWNER_MISMATCH` | Directory is not owned by the expected local user. |
| `RUNNER_REGISTRATION_MISSING` | Existing `.runner` registration is absent or unsafe. No automatic re-registration occurs. |
| `RUNNER_SERVICE_SCRIPT_MISSING` | Existing `svc.sh` is unavailable. |
| `RUNNER_SERVICE_SCRIPT_NOT_EXECUTABLE` | `svc.sh` cannot be executed. |
| `RUNNER_NOT_RUNNING` | Valid runner exists but its service/listener is stopped. |
| `RUNNER_SERVICE_START_FAILED` | Existing `svc.sh start` returned non-zero. |
| `RUNNER_START_NOT_VERIFIED` | Start returned successfully but service/listener did not become observable. |
| `GITHUB_UNREACHABLE` / `GITHUB_API_UNREACHABLE` | Bounded unauthenticated HTTPS check failed. |

Registration damage or missing service installation is a manual repair boundary. This recovery tool will not guess, request a token or overwrite the runner.

## Safety evidence

Every recovery result explicitly reports:

```text
registrationChanged: false
registrationTokenRequested: false
configurationExecuted: false
runnerRemoved: false
serviceReinstalled: false
sudoUsed: false
```

The scripts have fixture tests for stopped, running and unregistered runners and a static forbidden-command check.
