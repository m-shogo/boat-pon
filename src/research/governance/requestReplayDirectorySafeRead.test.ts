import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const HELPER_URL = pathToFileURL(resolve(process.cwd(), "scripts/read-safe-utf8.mjs")).href;
const EVAL = `import { listSafeDirectoryNames } from ${JSON.stringify(HELPER_URL)};\ntry { process.stdout.write(JSON.stringify(listSafeDirectoryNames(process.argv[1], { label: "processed request directory", baseDir: process.argv[2], allowMissing: true }))); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }`;

function listViaHelper(path: string, baseDir: string): { status: number; output: string } {
  try {
    const stdout = execFileSync(process.execPath, ["--input-type=module", "--eval", EVAL, path, baseDir], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

test("processed request directory listing accepts a regular directory", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-replay-dir-regular-"));
  try {
    const dir = join(root, "completed");
    mkdirSync(dir);
    writeFileSync(join(dir, "REQ-test.json"), "{}\n", "utf8");
    const result = listViaHelper(dir, root);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.output), ["REQ-test.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("processed request directory listing rejects a symlinked ledger", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-replay-dir-symlink-"));
  try {
    const target = join(root, "target");
    mkdirSync(target);
    const alias = join(root, "completed");
    symlinkSync(target, alias);
    const result = listViaHelper(alias, root);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /processed request directory symlink forbidden/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("processed request directory listing permits a genuinely missing optional ledger", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-replay-dir-missing-"));
  try {
    const result = listViaHelper(join(root, "missing"), root);
    assert.deepEqual(result, { status: 0, output: "[]" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
