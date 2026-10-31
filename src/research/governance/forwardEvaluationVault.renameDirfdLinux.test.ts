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

// Research-only Linux/glibc namespace probe. It does not change the SDK
// publisher or implement cleanup, recovery, or production behavior.
const pythonDirfd = [
  "import ctypes, errno, os, sys",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "fn = getattr(libc, 'renameat2', None)",
  "if fn is None: sys.exit(77)",
  "fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
  "fn.restype = ctypes.c_int",
  "fd = os.open(sys.argv[1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)",
  "try:",
  "    print('READY', flush=True)",
  "    if sys.stdin.readline().strip() != 'GO': sys.exit(76)",
  "    rc = fn(fd, b'staged.json', fd, b'published.json', 1)",
  "    if rc == 0: print('RESULT:RENAMED', flush=True); sys.exit(0)",
  "    err = ctypes.get_errno()",
  "    if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL): print('RESULT:UNSUPPORTED', flush=True); sys.exit(77)",
  "    raise OSError(err, os.strerror(err))",
  "finally:",
  "    os.close(fd)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(root: string, name: string, content: string): string {
  const path = join(root, name);
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
  return path;
}

function syncDirectory(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

describe("Forward Vault Linux renameat2 dirfd namespace anchoring (disposable probe)", () => {
  it("publishes in the originally opened directory after parent path becomes a symlink", {
    skip: !pythonAvailable,
    timeout: 20_000,
  }, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-dirfd-"));
    const anchor = join(root, "anchor");
    const moved = join(root, "moved");
    const outside = join(root, "outside");
    mkdirSync(anchor);
    mkdirSync(outside);
    const content = '{"recordId":"synthetic-only","writer":"anchored"}\n';
    const decoy = '{"recordId":"synthetic-only","writer":"decoy"}\n';
    stage(anchor, "staged.json", content);
    stage(outside, "staged.json", decoy);
    const child = spawn("python3", ["-I", "-u", "-c", pythonDirfd, anchor], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let closed = false;
    const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("close", (code, signal) => { closed = true; resolve({ code, signal }); });
      child.once("error", (error) => { closed = true; reject(error); });
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("dirfd READY timeout: " + stdout + stderr)), 8_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes("READY\n")) { clearTimeout(timer); resolve(); }
      });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("close", () => {
        clearTimeout(timer);
        if (!stdout.includes("READY\n")) reject(new Error("child exited before READY: " + stdout + stderr));
      });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    try {
      await ready;
      assert.equal(closed, false);
      renameSync(anchor, moved);
      symlinkSync(outside, anchor, "dir");
      assert.equal(lstatSync(anchor).isSymbolicLink(), true);
      assert.equal(realpathSync(anchor), realpathSync(outside));
      child.stdin.end("GO\n");
      const result = await completed;
      if (result.code === 77) {
        t.skip("renameat2 RENAME_NOREPLACE unsupported on this runner/filesystem");
        return;
      }
      assert.deepEqual(result, { code: 0, signal: null }, stderr + stdout);
      assert.equal(stdout, "READY\nRESULT:RENAMED\n");
      assert.equal(stderr, "");
      assert.equal(existsSync(join(moved, "staged.json")), false);
      assert.equal(readFileSync(join(moved, "published.json"), "utf8"), content);
      assert.equal(statSync(join(moved, "published.json")).nlink, 1);
      assert.equal(verifyJsonReadback(join(moved, "published.json")).ok, true);
      assert.equal(readFileSync(join(outside, "staged.json"), "utf8"), decoy);
      assert.equal(existsSync(join(outside, "published.json")), false);
      syncDirectory(moved);
      syncDirectory(root);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await completed.catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
