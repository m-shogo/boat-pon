import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, realpathSync, renameSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { verifyJsonReadback } from "./executorSdk.js";

// Disposable Linux-only research fixture. The preflight is deliberately NOT
// proposed as a complete canonical-path reachability guarantee.
const pythonPreflight = [
  "import ctypes, errno, os, stat, sys",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "fn = getattr(libc, 'renameat2', None)",
  "if fn is None: sys.exit(77)",
  "fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
  "fn.restype = ctypes.c_int",
  "fd = os.open(sys.argv[1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)",
  "try:",
  "    print('READY', flush=True)",
  "    if sys.stdin.readline().strip() != 'CHECK': sys.exit(76)",
  "    original = os.fstat(fd)",
  "    try: current = os.stat(sys.argv[1], follow_symlinks=False)",
  "    except OSError: current = None",
  "    if current is None or not stat.S_ISDIR(current.st_mode) or (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):",
  "        print('REJECTED', flush=True)",
  "        sys.exit(0)",
  "    print('CHECKED', flush=True)",
  "    if sys.stdin.readline().strip() != 'GO': sys.exit(76)",
  "    rc = fn(fd, b'staged.json', fd, b'published.json', 1)",
  "    if rc == 0: print('RENAMED', flush=True); sys.exit(0)",
  "    err = ctypes.get_errno()",
  "    if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL): print('UNSUPPORTED', flush=True); sys.exit(77)",
  "    raise OSError(err, os.strerror(err))",
  "finally:",
  "    os.close(fd)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
}

function syncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

async function probe(t: { skip: (reason: string) => void }, swapAfterPreflight: boolean): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-reachability-"));
  const anchor = join(root, "anchor");
  const moved = join(root, "moved");
  const outside = join(root, "outside");
  mkdirSync(anchor);
  mkdirSync(outside);
  const content = '{"recordId":"synthetic-only","writer":"anchored"}\n';
  const decoy = '{"recordId":"synthetic-only","writer":"decoy"}\n';
  stage(join(anchor, "staged.json"), content);
  stage(join(outside, "staged.json"), decoy);

  const child = spawn("python3", ["-u", "-c", pythonPreflight, anchor], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let closed = false;
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("close", (code, signal) => { closed = true; resolve({ code, signal }); });
    child.once("error", (error) => { closed = true; reject(error); });
  });
  const waitFor = (marker: string) => new Promise<void>((resolve, reject) => {
    if (stdout.includes(marker)) { resolve(); return; }
    if (closed) { reject(new Error("child closed before " + marker + ": " + stdout + stderr)); return; }
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout waiting for " + marker + ": " + stdout + stderr)); }, 8_000);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
    };
    const onData = () => { if (stdout.includes(marker)) { cleanup(); resolve(); } };
    const onClose = () => { cleanup(); reject(new Error("child closed before " + marker + ": " + stdout + stderr)); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    child.stdout.on("data", onData);
    child.once("close", onClose);
    child.once("error", onError);
  });
  const swap = () => {
    renameSync(anchor, moved);
    symlinkSync(outside, anchor, "dir");
    assert.equal(lstatSync(anchor).isSymbolicLink(), true);
    assert.equal(realpathSync(anchor), realpathSync(outside));
  };
  try {
    await waitFor("READY\n");
    if (!swapAfterPreflight) swap();
    child.stdin.write("CHECK\n");
    if (swapAfterPreflight) {
      await waitFor("CHECKED\n");
      swap();
      child.stdin.end("GO\n");
    } else {
      await waitFor("REJECTED\n");
      child.stdin.end();
    }
    const result = await completed;
    if (result.code === 77) {
      t.skip("renameat2 RENAME_NOREPLACE unsupported on this runner/filesystem");
      return;
    }
    assert.deepEqual(result, { code: 0, signal: null }, stderr + stdout);
    assert.equal(stderr, "");
    assert.equal(readFileSync(join(outside, "staged.json"), "utf8"), decoy);
    assert.equal(existsSync(join(outside, "published.json")), false);
    assert.equal(existsSync(join(anchor, "published.json")), false);
    if (swapAfterPreflight) {
      assert.equal(stdout, "READY\nCHECKED\nRENAMED\n");
      assert.equal(existsSync(join(moved, "staged.json")), false);
      assert.equal(readFileSync(join(moved, "published.json"), "utf8"), content);
      assert.equal(statSync(join(moved, "published.json")).nlink, 1);
      assert.equal(verifyJsonReadback(join(moved, "published.json")).ok, true);
    } else {
      assert.equal(stdout, "READY\nREJECTED\n");
      assert.equal(readFileSync(join(moved, "staged.json"), "utf8"), content);
      assert.equal(existsSync(join(moved, "published.json")), false);
    }
    syncDirectory(moved);
    syncDirectory(root);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await completed.catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Forward Vault dirfd canonical reachability preflight TOCTOU (disposable Linux probe)", () => {
  it("rejects a parent pathname swap already visible before the identity preflight", {
    skip: !pythonAvailable,
    timeout: 20_000,
  }, async (t) => { await probe(t, false); });

  it("demonstrates that a successful identity preflight does not close a later swap window", {
    skip: !pythonAvailable,
    timeout: 20_000,
  }, async (t) => { await probe(t, true); });
});
