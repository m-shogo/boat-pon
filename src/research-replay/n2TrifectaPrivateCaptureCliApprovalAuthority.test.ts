import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdtempSync } from "node:fs";

const repoRoot = resolve(process.cwd());
const script = resolve(repoRoot, "scripts/run-n2-trifecta-private-capture.ts");

function runWithApproval(approvalPath: string): ReturnType<typeof spawnSync> {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-capture-cli-"));
  const planPath = join(root, "plan.json");
  writeFileSync(planPath, "{}\n", "utf8");
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      script,
      "--root",
      root,
      "--plan",
      planPath,
      "--approval",
      approvalPath,
      "--execute",
      "--now",
      "2026-08-07T00:00:00.000Z",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

test("private capture CLI rejects a hardlinked execution approval before executor entry", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-capture-approval-hardlink-"));
  const aliasPath = join(root, "approval-alias.json");
  const approvalPath = join(root, "approval.json");
  writeFileSync(aliasPath, "{}\n", "utf8");
  chmodSync(aliasPath, 0o600);
  linkSync(aliasPath, approvalPath);

  const result = runWithApproval(approvalPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APPROVAL_HARDLINK_NOT_ALLOWED/u);
});

test("private capture CLI rejects a non-private execution approval before executor entry", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-capture-approval-mode-"));
  const approvalPath = join(root, "approval.json");
  mkdirSync(root, { recursive: true });
  writeFileSync(approvalPath, "{}\n", "utf8");
  chmodSync(approvalPath, 0o644);

  const result = runWithApproval(approvalPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APPROVAL_MODE_INVALID/u);
});
