import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const commitScript = resolve(repoRoot, "scripts/automation-commit.sh");

test("automation commit rejects unexpected suffixes beside named N2 outputs", () => {
  const cwd = mkdtempSync(join(tmpdir(), "boat-pon-automation-exact-n2-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
    execFileSync("git", ["config", "user.name", "Boat Pon Test"], { cwd });
    writeFileSync(join(cwd, "README.md"), "base\n");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-qm", "base"], { cwd });

    mkdirSync(join(cwd, "reports/n2"), { recursive: true });
    writeFileSync(join(cwd, "reports/n2/n2-dataset-manifest.private"), "must-not-commit\n");

    const result = spawnSync("bash", [commitScript], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, RUN_ID: "test" },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /path not in allowlist/);
    assert.match(result.stdout + result.stderr, /n2-dataset-manifest\.private/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
