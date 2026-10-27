import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { verifyJsonReadback } from "./executorSdk.js";

// Research-only negative fixture. A pinned dirfd protects the publisher's
// object, but a *real directory* replacement can pass the existing strict
// pathname reader's ancestor checks while resolving to unrelated valid JSON.
// No SDK API, production writer, recovery, or automatic deletion is changed.
const pythonProbe = [
  "import ctypes, errno, os, stat, sys",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "fn = getattr(libc, 'renameat2', None)",
  "if fn is None: sys.exit(77)",
  "fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
  "fn.restype = ctypes.c_int",
  "root = sys.argv[1]",
  "flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW",
  "root_fd = os.open(root, flags)",
  "try:",
  "    anchor_fd = os.open('anchor', flags, dir_fd=root_fd)",
  "    try:",
  "        vault_fd = os.open('vault', flags, dir_fd=anchor_fd)",
  "        try:",
  "            os.rename('anchor', 'moved', src_dir_fd=root_fd, dst_dir_fd=root_fd)",
  "            os.rename('decoy', 'anchor', src_dir_fd=root_fd, dst_dir_fd=root_fd)",
  "            rc = fn(vault_fd, b'staged.json', vault_fd, b'published.json', 1)",
  "            if rc != 0:",
  "                err = ctypes.get_errno()",
  "                if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL): sys.exit(77)",
  "                raise OSError(err, os.strerror(err))",
  "            fd = os.open('published.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=vault_fd)",
  "            try:",
  "                assert os.read(fd, 4096) == sys.argv[2].encode('utf-8')",
  "                st = os.fstat(fd)",
  "                assert stat.S_ISREG(st.st_mode) and st.st_nlink == 1",
  "            finally: os.close(fd)",
  "            print('PINNED_PUBLISHER_READBACK_OK', flush=True)",
  "            os.fsync(vault_fd)",
  "            os.fsync(root_fd)",
  "        finally: os.close(vault_fd)",
  "    finally: os.close(anchor_fd)",
  "finally: os.close(root_fd)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", [
    "-c", "import ctypes,sys; sys.exit(0 if hasattr(ctypes.CDLL(None), 'renameat2') else 1)",
  ], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
}

describe("Forward Vault real-ancestor replacement (disposable Linux negative probe)", () => {
  it("distinguishes pinned publisher bytes from strict pathname readback of a real decoy directory", {
    skip: !pythonAvailable,
    timeout: 20_000,
  }, (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-real-ancestor-"));
    const originalVault = join(root, "anchor", "vault");
    const decoyVault = join(root, "decoy", "vault");
    const declaredDigest = "synthetic-declared-digest";
    const anchoredJson = '{"recordId":"synthetic-only","writer":"anchored","outputDigest":"synthetic-declared-digest"}\n';
    const decoyJson = '{"recordId":"synthetic-only","writer":"decoy","outputDigest":"synthetic-declared-digest"}\n';
    try {
      mkdirSync(originalVault, { recursive: true });
      mkdirSync(decoyVault, { recursive: true });
      stage(join(originalVault, "staged.json"), anchoredJson);
      stage(join(decoyVault, "published.json"), decoyJson);

      const result = spawnSync("python3", ["-c", pythonProbe, root, anchoredJson], {
        encoding: "utf8",
        timeout: 8_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      if (result.status === 77) {
        t.skip("renameat2 RENAME_NOREPLACE unsupported on this runner/filesystem");
        return;
      }
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "PINNED_PUBLISHER_READBACK_OK\n");

      const movedPath = join(root, "moved", "vault", "published.json");
      const canonicalPath = join(root, "anchor", "vault", "published.json");
      assert.equal(lstatSync(join(root, "anchor")).isDirectory(), true);
      assert.equal(lstatSync(join(root, "anchor")).isSymbolicLink(), false);
      assert.equal(readFileSync(movedPath, "utf8"), anchoredJson);
      assert.equal(readFileSync(canonicalPath, "utf8"), decoyJson);
      assert.notEqual(readFileSync(movedPath, "utf8"), readFileSync(canonicalPath, "utf8"));
      assert.equal(statSync(movedPath).nlink, 1);
      assert.equal(statSync(canonicalPath).nlink, 1);

      // Both paths have real ancestors and single-link regular JSON files.
      // verifyJsonReadback checks a declared outputDigest field, not publisher
      // directory identity or a recomputed hash of the entire JSON payload.
      assert.equal(verifyJsonReadback(movedPath, declaredDigest).ok, true);
      assert.equal(verifyJsonReadback(canonicalPath, declaredDigest).ok, true);
      // No change to the decoy's published bytes, and no cleanup by stale path.
      assert.equal(readFileSync(canonicalPath, "utf8"), decoyJson);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
