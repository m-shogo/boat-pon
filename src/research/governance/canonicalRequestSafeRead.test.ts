import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const SCRIPT = resolve(process.cwd(), "scripts/assert-canonical-request.mjs");

function runIn(cwd: string): { status: number; output: string } {
  try {
    execFileSync(process.execPath, [SCRIPT, "canonical-request.json"], { cwd, encoding: "utf8", stdio: "pipe" });
    return { status: 0, output: "" };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

test("canonical request validator rejects a symlinked request artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-canonical-request-symlink-"));
  try {
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{}\n", "utf8");
    symlinkSync(outside, join(root, "canonical-request.json"));

    const result = runIn(root);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /canonical request symlink forbidden/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical request validator rejects invalid UTF-8 bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-canonical-request-utf8-"));
  try {
    writeFileSync(join(root, "canonical-request.json"), Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]));

    const result = runIn(root);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /canonical request is not valid UTF-8/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
