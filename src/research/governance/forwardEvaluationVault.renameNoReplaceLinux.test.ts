import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { atomicWriteJson, verifyJsonReadback } from "./executorSdk.js";

// Linux-only disposable synthetic syscall probe. Node renameSync is NOT
// equivalent to glibc renameat2(RENAME_NOREPLACE). This does not alter the
// SDK writer, establish portability, or prove power-loss durability.
const pythonRename = [
  "import ctypes, errno, os, sys, time",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "fn = getattr(libc, 'renameat2', None)",
  "if fn is None: sys.exit(77)",
  "fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
  "fn.restype = ctypes.c_int",
  "rc = fn(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 1)",
  "if rc == 0:",
  "    print('RENAMED', flush=True)",
  "    if os.environ.get('PROBE_HOLD_AFTER_RENAME') == '1': time.sleep(30)",
  "    sys.exit(0)",
  "err = ctypes.get_errno()",
  "if err == errno.EEXIST: print('EEXIST', flush=True); sys.exit(17)",
  "if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL): print('UNSUPPORTED', flush=True); sys.exit(77)",
  "raise OSError(err, os.strerror(err))",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(root: string, name: string, content: string): string {
  const path = join(root, name);
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return path;
}

function renameNoReplace(source: string, destination: string) {
  return spawnSync("python3", ["-c", pythonRename, source, destination], {
    encoding: "utf8", timeout: 8_000,
  });
}

function syncDirectory(root: string) {
  const fd = openSync(root, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

describe("Forward Vault Linux renameat2 no-replace candidate (disposable probe)", () => {
  it("publishes complete staged JSON as a single-link record with no temp-name readback window", {
    skip: !pythonAvailable,
  }, (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-renameat2-"));
    try {
      const content = JSON.stringify({ recordId: "synthetic-only", version: 1 }) + "\n";
      const source = stage(root, "staged.json", content);
      const destination = join(root, "published.json");
      const result = renameNoReplace(source, destination);
      if (result.status === 77) { t.skip("renameat2 RENAME_NOREPLACE unsupported on this runner/filesystem"); return; }
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, "RENAMED\n");
      assert.equal(existsSync(source), false);
      assert.equal(readFileSync(destination, "utf8"), content);
      assert.equal(statSync(destination).nlink, 1);
      assert.equal(verifyJsonReadback(destination).ok, true);
      assert.equal(createHash("sha256").update(readFileSync(destination)).digest("hex"),
        createHash("sha256").update(content).digest("hex"));
      syncDirectory(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses regular-file and symlink collisions without replacing either", {
    skip: !pythonAvailable,
  }, (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-renameat2-"));
    try {
      const destination = join(root, "existing.json");
      const original = { recordId: "synthetic-only", version: 1 };
      atomicWriteJson(destination, original);
      const source = stage(root, "candidate.json", '{"recordId":"synthetic-only","version":2}\n');
      const first = renameNoReplace(source, destination);
      if (first.status === 77) { t.skip("renameat2 RENAME_NOREPLACE unsupported on this runner/filesystem"); return; }
      assert.equal(first.status, 17, first.stderr);
      assert.equal(first.stdout, "EEXIST\n");
      assert.equal(existsSync(source), true);
      assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), original);
      assert.equal(verifyJsonReadback(destination).ok, true);

      const target = stage(root, "target.json", '{"protected":"synthetic"}\n');
      const link = join(root, "link.json");
      symlinkSync(target, link);
      const second = renameNoReplace(source, link);
      assert.equal(second.status, 17, second.stderr);
      assert.equal(second.stdout, "EEXIST\n");
      assert.equal(lstatSync(link).isSymbolicLink(), true);
      assert.equal(readlinkSync(link), target);
      assert.equal(readFileSync(target, "utf8"), '{"protected":"synthetic"}\n');
      assert.equal(existsSync(source), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains single-link strict readback after SIGKILL immediately following publication", {
    skip: !pythonAvailable,
    timeout: 20_000,
  }, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-renameat2-kill-"));
    const content = '{"recordId":"synthetic-only","version":3}\n';
    const source = stage(root, "staged.json", content);
    const destination = join(root, "published.json");
    const child = spawn("python3", ["-u", "-c", pythonRename, source, destination], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PROBE_HOLD_AFTER_RENAME: "1" },
    });
    let stdout = "";
    let stderr = "";
    const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
      child.once("error", reject);
    });
    const published = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("renameat2 publication handshake timed out")), 8_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes("RENAMED\n")) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("close", () => {
        clearTimeout(timer);
        reject(new Error("child exited before renameat2 handshake: " + stdout + stderr));
      });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    try {
      await published;
      assert.equal(child.kill("SIGKILL"), true);
      assert.deepEqual(await completed, { code: null, signal: "SIGKILL" });
      assert.equal(stderr, "");
      assert.equal(existsSync(source), false);
      assert.equal(statSync(destination).nlink, 1);
      assert.equal(readFileSync(destination, "utf8"), content);
      assert.equal(verifyJsonReadback(destination).ok, true);
      syncDirectory(root);
    } catch (error) {
      if (child.exitCode === 77) t.skip("renameat2 RENAME_NOREPLACE unsupported on this runner/filesystem");
      else throw error;
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await completed.catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
