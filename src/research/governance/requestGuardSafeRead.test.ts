import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const HELPER_URL = pathToFileURL(resolve(process.cwd(), "scripts/read-safe-utf8.mjs")).href;
const EVAL = `import { readSafeUtf8 } from ${JSON.stringify(HELPER_URL)};\nconst options = { label: "test file" }; if (process.argv[2] !== "-") options.maxBytes = Number(process.argv[2]); if (process.argv[3]) options.baseDir = process.argv[3]; try { process.stdout.write(readSafeUtf8(process.argv[1], options)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }`;

function readViaHelper(path: string, maxBytes?: number, baseDir?: string): { status: number; output: string } {
  try {
    const args = ["--input-type=module", "--eval", EVAL, path, maxBytes === undefined ? "-" : String(maxBytes), baseDir ?? ""];
    const stdout = execFileSync(process.execPath, args, { encoding: "utf8", stdio: "pipe" });
    return { status: 0, output: stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failed.status ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

test("safe UTF-8 reader returns a regular file unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-safe-utf8-regular-"));
  try {
    const path = join(root, "input.json");
    writeFileSync(path, "{\"ok\":true}\n", "utf8");
    assert.deepEqual(readViaHelper(path, undefined, root), { status: 0, output: "{\"ok\":true}\n" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safe UTF-8 reader rejects symlinked input", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-safe-utf8-symlink-"));
  try {
    const target = join(root, "target.json");
    const path = join(root, "input.json");
    writeFileSync(target, "{}\n", "utf8");
    symlinkSync(target, path);
    const result = readViaHelper(path, undefined, root);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /symlink forbidden/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safe UTF-8 reader rejects parent directory symlinks within its base", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-safe-utf8-parent-symlink-"));
  try {
    const targetDir = join(root, "target");
    mkdirSync(targetDir);
    writeFileSync(join(targetDir, "input.json"), "{}\n", "utf8");
    const aliasDir = join(root, "alias");
    symlinkSync(targetDir, aliasDir);
    const result = readViaHelper(join(aliasDir, "input.json"), undefined, root);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /parent symlink forbidden/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safe UTF-8 reader rejects invalid UTF-8 bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-safe-utf8-invalid-"));
  try {
    const path = join(root, "input.json");
    writeFileSync(path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]));
    const result = readViaHelper(path, undefined, root);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /not valid UTF-8/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("safe UTF-8 reader preserves an explicit byte ceiling", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-safe-utf8-size-"));
  try {
    const path = join(root, "input.json");
    writeFileSync(path, "12345", "utf8");
    const result = readViaHelper(path, 4, root);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /too large: 5 bytes/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
