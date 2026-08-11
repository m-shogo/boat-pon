import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const gate = readFileSync(resolve(process.cwd(), "src/automation/researchRetainedOutputCommitGate.ts"), "utf8");
const cli = readFileSync(resolve(process.cwd(), "scripts/check-research-retained-output-commit.mjs"), "utf8");
const commit = readFileSync(resolve(process.cwd(), "scripts/automation-commit.sh"), "utf8");

test("commit gate is metadata-only and isolated from product/private behavior", () => {
  assert.match(gate, /reports\/automation\/retained-outputs/u);
  assert.match(gate, /reports\/automation\/history/u);
  assert.match(gate, /RETAINED_COMMIT_ORPHAN/u);
  assert.doesNotMatch(gate, /data\/raw|data\/private|boat\.sqlite|sidecar/u);
  assert.doesNotMatch(gate, /send-line|notify|auto_purchase|auto_vote|production_writer|live_odds_writer/u);
  assert.doesNotMatch(gate, /writeFile|appendFile|rename|unlink|DatabaseSync|\bfetch\s*\(/u);
});

test("trusted CLI inspects only git changes under retained-output and history roots", () => {
  assert.match(cli, /reports\/automation\/retained-outputs/u);
  assert.match(cli, /reports\/automation\/history/u);
  assert.match(cli, /const TRUSTED_GIT_BIN = process\.env\.TRUSTED_GIT_BIN/u);
  assert.match(cli, /gitLines\(\["diff", "--no-ext-diff", "--name-only"/u);
  assert.match(cli, /gitLines\(\["ls-files", "--others"/u);
  assert.doesNotMatch(cli, /writeFile|appendFile|rename|unlink|rmSync|DatabaseSync|\bfetch\s*\(/u);
  assert.match(cli, /currentBuyConnectionAuthorized:\s*false/u);
  assert.match(cli, /productionApplyAuthorized:\s*false/u);
});

test("trusted CLI binds history validation and readback to one file descriptor", () => {
  assert.match(cli, /openSync\(absolutePath, fsConstants\.O_RDONLY \| fsConstants\.O_NOFOLLOW \| fsConstants\.O_NONBLOCK\)/u);
  assert.match(cli, /const stat = fstatSync\(fd\)/u);
  assert.match(cli, /stat\.dev !== expectedStat\.dev/u);
  assert.match(cli, /stat\.ino !== expectedStat\.ino/u);
  assert.match(cli, /stat\.size !== expectedStat\.size/u);
  assert.match(cli, /return readFileSync\(fd, "utf8"\)/u);
  assert.doesNotMatch(cli, /return readFileSync\(absolutePath, "utf8"\)/u);
});

test("automation commit runs retained gate before staging, cleaning or branch switching", () => {
  const gateIndex = commit.indexOf("check-research-retained-output-commit.mjs");
  const stageIndex = commit.indexOf('STAGE="$(mktemp -d)"');
  const cleanIndex = commit.indexOf("git_no_hooks clean -fdq -- automation reports docs research");
  const checkoutBranchIndex = commit.indexOf('git_no_hooks checkout -B "$BRANCH"');
  assert.ok(gateIndex >= 0);
  assert.ok(stageIndex > gateIndex);
  assert.ok(cleanIndex > stageIndex);
  assert.ok(checkoutBranchIndex > cleanIndex);
  assert.match(commit, /--run-id="\$\{RUN_ID:-local\}"/u);
});

test("existing automation commit safety gates remain intact", () => {
  assert.match(commit, /MAX_BYTES=2097152/u);
  assert.match(commit, /path not in allowlist/u);
  assert.match(commit, /refusing to commit DB\/archive\/model artifact/u);
  assert.match(commit, /CAS conflict, refusing to clobber/u);
  assert.doesNotMatch(commit, /--force|force-with-lease/u);
});
