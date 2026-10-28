import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only Linux FD lifetime probe. A saved numeric descriptor is NOT a
// durable directory capability after close(); dup() keeps a live reference.
// Disposable synthetic JSON only; no SDK, recovery, mount or production change.
const pythonProbe = [
  "import ctypes, errno, os, stat, sys",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "renameat2 = getattr(libc, 'renameat2', None)",
  "if renameat2 is None: sys.exit(77)",
  "renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
  "renameat2.restype = ctypes.c_int",
  "root, mode = sys.argv[1:]",
  "flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC",
  "original_fd = os.open(os.path.join(root, 'original'), flags)",
  "saved_number = original_fd",
  "live_fd = os.dup(original_fd) if mode == 'retained' else None",
  "original_identity = os.fstat(original_fd)",
  "os.close(original_fd)",
  "decoy_fd = os.open(os.path.join(root, 'decoy'), flags)",
  "try:",
  "    assert decoy_fd == saved_number, (decoy_fd, saved_number)",
  "    assert (os.fstat(decoy_fd).st_dev, os.fstat(decoy_fd).st_ino) != (original_identity.st_dev, original_identity.st_ino)",
  "    target_fd = saved_number if mode == 'stale' else live_fd",
  "    assert target_fd is not None",
  "    if mode == 'retained':",
  "        current = os.fstat(target_fd)",
  "        assert (current.st_dev, current.st_ino) == (original_identity.st_dev, original_identity.st_ino)",
  "    rc = renameat2(target_fd, b'staged.json', target_fd, b'published.json', 1)",
  "    if rc != 0:",
  "        err = ctypes.get_errno()",
  "        if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL, errno.EPERM): sys.exit(77)",
  "        raise OSError(err, os.strerror(err))",
  "    os.fsync(target_fd)",
  "    fd = os.open('published.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=target_fd)",
  "    try:",
  "        record = os.fstat(fd)",
  "        assert stat.S_ISREG(record.st_mode) and record.st_nlink == 1",
  "        expected = b'{\"recordId\":\"synthetic-only\",\"writer\":\"decoy\"}\\n' if mode == 'stale' else b'{\"recordId\":\"synthetic-only\",\"writer\":\"original\"}\\n'",
  "        assert os.read(fd, 4096) == expected",
  "    finally: os.close(fd)",
  "    print('STALE_INTEGER_PUBLISHED_DECOY' if mode == 'stale' else 'LIVE_DUP_PUBLISHED_ORIGINAL', flush=True)",
  "finally:",
  "    os.close(decoy_fd)",
  "    if live_fd is not None: os.close(live_fd)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
}

function probe(mode: "stale" | "retained", t: { skip: (reason: string) => void }): void {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-fd-lifetime-"));
  const original = '{"recordId":"synthetic-only","writer":"original"}\n';
  const decoy = '{"recordId":"synthetic-only","writer":"decoy"}\n';
  try {
    mkdirSync(join(root, "original"));
    mkdirSync(join(root, "decoy"));
    stage(join(root, "original", "staged.json"), original);
    stage(join(root, "decoy", "staged.json"), decoy);
    const result = spawnSync("python3", ["-I", "-c", pythonProbe, root, mode], {
      encoding: "utf8", timeout: 8_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    if (result.status === 77) { t.skip("renameat2 RENAME_NOREPLACE unavailable"); return; }
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, mode === "stale"
      ? "STALE_INTEGER_PUBLISHED_DECOY\n"
      : "LIVE_DUP_PUBLISHED_ORIGINAL\n");
    const winner = mode === "stale" ? "decoy" : "original";
    const loser = mode === "stale" ? "original" : "decoy";
    assert.equal(existsSync(join(root, winner, "staged.json")), false);
    assert.equal(readFileSync(join(root, winner, "published.json"), "utf8"),
      mode === "stale" ? decoy : original);
    assert.equal(statSync(join(root, winner, "published.json")).nlink, 1);
    assert.equal(readFileSync(join(root, loser, "staged.json"), "utf8"),
      mode === "stale" ? original : decoy);
    assert.equal(existsSync(join(root, loser, "published.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Forward Vault directory FD lifetime and numeric reuse (disposable Linux probe)", () => {
  it("demonstrates that a closed directory FD number can be reused for an unrelated publisher", {
    skip: !pythonAvailable, timeout: 20_000,
  }, (t) => { probe("stale", t); });

  it("preserves the authorized directory object with a live duplicated FD despite numeric reuse", {
    skip: !pythonAvailable, timeout: 20_000,
  }, (t) => { probe("retained", t); });
});
