import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const diagnoseScript = join(repoRoot, "scripts/diagnose-boat-pon-self-hosted-runner.sh");
const recoverScript = join(repoRoot, "scripts/recover-boat-pon-self-hosted-runner.sh");

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function withTempDir(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-runner-recovery-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeExecutable(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  chmodSync(path, 0o755);
}

function createFakeRunner(root: string, state: "running" | "stopped" = "stopped"): {
  runnerDir: string;
  statePath: string;
  logPath: string;
  binDir: string;
} {
  const runnerDir = join(root, "runner");
  const statePath = join(root, "service-state.txt");
  const logPath = join(root, "svc-calls.log");
  const binDir = join(root, "bin");
  mkdirSync(runnerDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(runnerDir, ".runner"), "{}\n", "utf8");
  writeFileSync(statePath, `${state}\n`, "utf8");
  writeExecutable(join(runnerDir, "svc.sh"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$1" >> "${logPath}"
case "$1" in
  status)
    test "$(cat "${statePath}")" = "running"
    ;;
  start)
    printf 'running\\n' > "${statePath}"
    ;;
  *)
    exit 91
    ;;
esac
`);
  writeExecutable(join(binDir, "pgrep"), `#!/usr/bin/env bash
exit 1
`);
  writeExecutable(join(binDir, "curl"), `#!/usr/bin/env bash
exit 0
`);
  return { runnerDir, statePath, logPath, binDir };
}

function runScript(
  script: string,
  args: string[],
  input: { runnerDir: string; binDir: string },
): CommandResult {
  const result = spawnSync("bash", [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${input.binDir}:${process.env.PATH ?? ""}`,
      BOAT_PON_RUNNER_DIR: input.runnerDir,
      BOAT_PON_RUNNER_OWNER: process.env.USER ?? process.env.LOGNAME ?? "root",
      BOAT_PON_RUNNER_ALLOW_NON_DARWIN: "1",
      BOAT_PON_RUNNER_SKIP_NETWORK: "1",
      BOAT_PON_RUNNER_START_VERIFY_DELAY_SECONDS: "0",
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseOutput(result: CommandResult): Record<string, unknown> {
  assert.ok(result.stdout.trim(), `expected JSON stdout, stderr=${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

test("diagnosis is read-only and recommends start for a configured stopped runner", () => {
  withTempDir((root) => {
    const fake = createFakeRunner(root, "stopped");
    const beforeState = readFileSync(fake.statePath, "utf8");
    const result = runScript(diagnoseScript, [], fake);
    assert.equal(result.status, 3);
    const output = parseOutput(result);
    assert.equal(output.status, "BLOCKED");
    assert.equal(output.registrationExists, true);
    assert.equal(output.serviceScriptExecutable, true);
    assert.equal(output.serviceRunning, false);
    assert.equal(output.startRecommended, true);
    assert.deepEqual(output.blockers, ["RUNNER_NOT_RUNNING"]);
    assert.equal(readFileSync(fake.statePath, "utf8"), beforeState);
    assert.deepEqual(readFileSync(fake.logPath, "utf8").trim().split("\n"), ["status"]);
  });
});

test("recovery requires explicit --start and performs no service call otherwise", () => {
  withTempDir((root) => {
    const fake = createFakeRunner(root, "stopped");
    const result = runScript(recoverScript, [], fake);
    assert.equal(result.status, 2);
    const output = parseOutput(result);
    assert.equal(output.status, "BLOCKED");
    assert.deepEqual(output.blockers, ["EXPLICIT_--start_REQUIRED"]);
    assert.equal(output.serviceStartExecuted, false);
    assert.throws(() => readFileSync(fake.logPath, "utf8"));
  });
});

test("missing registration blocks before svc.sh status or start", () => {
  withTempDir((root) => {
    const fake = createFakeRunner(root, "stopped");
    rmSync(join(fake.runnerDir, ".runner"));
    const result = runScript(recoverScript, ["--start"], fake);
    assert.equal(result.status, 3);
    const output = parseOutput(result);
    assert.equal(output.status, "BLOCKED");
    assert.deepEqual(output.blockers, ["RUNNER_REGISTRATION_MISSING"]);
    assert.equal(output.serviceStartExecuted, false);
    assert.throws(() => readFileSync(fake.logPath, "utf8"));
  });
});

test("a stopped configured runner is started exactly once and verified", () => {
  withTempDir((root) => {
    const fake = createFakeRunner(root, "stopped");
    const result = runScript(recoverScript, ["--start"], fake);
    assert.equal(result.status, 0, result.stderr);
    const output = parseOutput(result);
    assert.equal(output.status, "PASS");
    assert.equal(output.alreadyRunning, false);
    assert.equal(output.serviceStartExecuted, true);
    assert.equal(output.serviceStartExitCode, 0);
    assert.equal(output.verifiedRunning, true);
    assert.equal(readFileSync(fake.statePath, "utf8").trim(), "running");
    const calls = readFileSync(fake.logPath, "utf8").trim().split("\n");
    assert.deepEqual(calls, ["status", "start", "status"]);
    assert.equal(calls.filter((call) => call === "start").length, 1);
  });
});

test("an already running service is not restarted", () => {
  withTempDir((root) => {
    const fake = createFakeRunner(root, "running");
    const result = runScript(recoverScript, ["--start"], fake);
    assert.equal(result.status, 0, result.stderr);
    const output = parseOutput(result);
    assert.equal(output.status, "PASS");
    assert.equal(output.alreadyRunning, true);
    assert.equal(output.serviceStartExecuted, false);
    assert.equal(output.verifiedRunning, true);
    assert.deepEqual(readFileSync(fake.logPath, "utf8").trim().split("\n"), ["status"]);
  });
});

test("recovery scripts contain no registration, removal, token, sudo or reinstall command", () => {
  const sources = [diagnoseScript, recoverScript]
    .map((path) => `${basename(path)}\n${readFileSync(path, "utf8")}`)
    .join("\n");
  assert.doesNotMatch(
    sources,
    /(?:^|\n)\s*(?:sudo\b|\.\/config(?:\.sh)?\b|\.\/svc\.sh\s+(?:install|uninstall)\b|rm\s+-rf\s+[^\n]*actions-runner)/imu,
  );
  assert.doesNotMatch(sources, /(?:^|\s)--token(?:=|\s)/imu);
  assert.match(readFileSync(recoverScript, "utf8"), /\.\/svc\.sh start/);
});
