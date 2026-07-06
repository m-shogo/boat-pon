#!/usr/bin/env node
/**
 * Dependency-free E2E check for scripts/manage-research-rules.ts's
 * --dry-run mode, plus a small docs-completeness check.
 *
 * Uses only Node built-ins (fs/os/path/child_process/crypto), same
 * temp-copy-with-explicit-.ts-extensions approach as
 * scripts/verify-roi-smoke.mjs — see that file for why this is needed
 * instead of just running the real source with tsx.
 *
 * This is NOT a replacement for `pnpm test` — it's a fallback for
 * environments where `pnpm install` cannot complete. See
 * docs/ai/05-VERIFICATION.md.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempDir = mkdtempSync(join(tmpdir(), "boatpon-verify-rule-dry-run-"));
const tempDomainDir = join(tempDir, "src", "domain");
const tempScriptsDir = join(tempDir, "scripts");
const storePath = join(tempDir, "rules.json");

let failures = 0;

try {
  mkdirSync(tempDomainDir, { recursive: true });
  mkdirSync(tempScriptsDir, { recursive: true });
  for (const name of ["researchRule.ts", "researchRuleLifecycle.ts", "researchRuleStore.ts"]) {
    copyFileSync(join(repoRoot, "src", "domain", name), join(tempDomainDir, name));
  }
  copyFileSync(join(repoRoot, "scripts", "manage-research-rules.ts"), join(tempScriptsDir, "manage-research-rules.ts"));
  addExplicitTsExtensions(tempDomainDir);
  addExplicitTsExtensions(tempScriptsDir);

  console.log("--- dry-run add does not write the file ---");
  const dryAdd = run(["add", "--rule-id", "r1", "--reason", "x", "--dry-run"]);
  check("dry-run add exits 0", dryAdd.status === 0);
  check("dry-run add does not create the store file", !existsSync(storePath));
  check("dry-run add prints dryRun JSON with the would-be rule", parseJson(dryAdd.stdout)?.wouldAdd?.status === "candidate");

  console.log("--- real add, then dry-run transition does not write the file ---");
  const realAdd = run(["add", "--rule-id", "r1", "--reason", "x"]);
  check("real add exits 0", realAdd.status === 0);
  check("real add creates the store file", existsSync(storePath));
  const hashBefore = hashFile(storePath);

  const dryTransition = run(["transition", "--rule-id", "r1", "--to", "backtest", "--dry-run"]);
  check("dry-run transition exits 0", dryTransition.status === 0);
  check("dry-run transition does not change the store file", hashFile(storePath) === hashBefore);
  check("dry-run transition prints the would-be new status", parseJson(dryTransition.stdout)?.wouldUpdate?.status === "backtest");

  console.log("--- dry-run still rejects candidate -> production ---");
  const dryInvalid = run(["transition", "--rule-id", "r1", "--to", "production", "--dry-run"]);
  check("dry-run direct-to-production exits 1", dryInvalid.status === 1);
  check("dry-run direct-to-production does not change the store file", hashFile(storePath) === hashBefore);

  console.log("--- docs/ai/09-RULE-CANDIDATE-MIGRATION.md covers every rule-candidates.md status ---");
  const migrationDoc = readFileSync(join(repoRoot, "docs", "ai", "09-RULE-CANDIDATE-MIGRATION.md"), "utf8");
  for (const status of ["watch", "candidate", "reject", "adopted", "reverted"]) {
    check(`migration doc mentions status "${status}"`, new RegExp("`" + status + "`").test(migrationDoc));
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s) did not pass`);
  process.exit(1);
}
console.log("OK: all research-rules dry-run checks passed");

function check(label, ok) {
  console.log(`${ok ? "ok" : "NOT OK"} - ${label}`);
  if (!ok) failures++;
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    check("output is valid JSON", false);
    return null;
  }
}

function run(args) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(tempScriptsDir, "manage-research-rules.ts"), ...args],
    { encoding: "utf8", env: { ...process.env, BOAT_PON_RULE_STORE_PATH: storePath } },
  );
}

function addExplicitTsExtensions(dir) {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const path = join(dir, name);
    const content = readFileSync(path, "utf8");
    const fixed = content
      .replace(/from\s+"(\.\.?\/[^"]+)"/g, (full, spec) => (/\.[a-zA-Z]+$/.test(spec) ? full : full.replace(spec, `${spec}.ts`)));
    if (fixed !== content) writeFileSync(path, fixed, "utf8");
  }
}
