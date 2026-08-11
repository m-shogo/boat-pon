import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const guardScript = resolve(repoRoot, "scripts/guard-intent-push.ts");
const tsxLoader = import.meta.resolve("tsx");

test("intent push guard rejects a push that mixes an intent with another main change", () => {
  const cwd = mkdtempSync(join(tmpdir(), "boat-pon-intent-push-scope-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
    execFileSync("git", ["config", "user.name", "Boat Pon Test"], { cwd });
    mkdirSync(join(cwd, "config"), { recursive: true });
    writeFileSync(join(cwd, "config/actor-allowlist-policy.json"), JSON.stringify({
      repository: "m-shogo/boat-pon",
      rules: { pullRequestEventAllowed: false },
      allowedActors: [{ actor: "m-shogo", verified: true }],
    }));
    writeFileSync(join(cwd, "README.md"), "base\n");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-qm", "base"], { cwd });
    const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

    mkdirSync(join(cwd, "automation/requests/intents"), { recursive: true });
    mkdirSync(join(cwd, "scripts"), { recursive: true });
    writeFileSync(join(cwd, "automation/requests/intents/INTENT-20260811-scope.json"), "{}\n");
    writeFileSync(join(cwd, "scripts/foreign.ts"), "export {};\n");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["commit", "-qm", "mixed push"], { cwd });
    const after = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

    const result = spawnSync(process.execPath, ["--import", tsxLoader, guardScript], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        ACTOR: "m-shogo",
        REPO: "m-shogo/boat-pon",
        EVENT: "push",
        BEFORE_SHA: before,
        AFTER_SHA: after,
        COMMIT_AUTHOR: "m-shogo",
        COMMIT_COMMITTER: "m-shogo",
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /intent dispatch push must contain only automation\/requests\/intents\/ changes/);
    assert.match(result.stderr, /A:scripts\/foreign\.ts/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
