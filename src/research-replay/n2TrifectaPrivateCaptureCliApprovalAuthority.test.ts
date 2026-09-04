import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(process.cwd());
const script = resolve(repoRoot, "scripts/run-n2-trifecta-private-capture.ts");

function runWithApproval(approvalPath: string) {
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
  writeFileSync(approvalPath, "{}\n", "utf8");
  chmodSync(approvalPath, 0o644);

  const result = runWithApproval(approvalPath);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APPROVAL_MODE_INVALID/u);
});

test("private capture CLI rejects an execution approval reached through a symlinked ancestor", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-capture-approval-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-private-capture-approval-external-"));
  try {
    const externalDir = join(external, "authority");
    mkdirSync(externalDir, { mode: 0o700 });
    const realApprovalPath = join(externalDir, "approval.json");
    writeFileSync(realApprovalPath, "{}\n", "utf8");
    chmodSync(realApprovalPath, 0o600);

    const aliasDir = join(root, "authority");
    symlinkSync(externalDir, aliasDir, "dir");
    const result = runWithApproval(join(aliasDir, "approval.json"));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /APPROVAL_PATH_ALIAS_NOT_ALLOWED/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
