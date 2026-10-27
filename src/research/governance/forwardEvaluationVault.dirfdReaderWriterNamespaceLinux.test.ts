import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { verifyJsonReadback } from "./executorSdk.js";

// Research-only, disposable Linux fixture. An FD-relative reader and writer
// share an object namespace even after an ancestor rename, while a legacy
// pathname reader can see a different, individually valid JSON document.
// This is NOT a proposed SDK API, recovery routine or production writer.
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
  "            os.symlink('decoy', 'anchor', dir_fd=root_fd)",
  "            rc = fn(vault_fd, b'staged.json', vault_fd, b'published.json', 1)",
  "            if rc != 0:",
  "                err = ctypes.get_errno()",
  "                if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL): sys.exit(77)",
  "                raise OSError(err, os.strerror(err))",
  "            record_fd = os.open('published.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=vault_fd)",
  "            try:",
  "                observed = os.read(record_fd, 4096)",
  "                assert observed == b'{\"recordId\":\"synthetic-only\",\"writer\":\"anchored\"}\\n'",
  "                assert os.fstat(record_fd).st_nlink == 1",
  "                assert stat.S_ISREG(os.fstat(record_fd).st_mode)",
  "            finally: os.close(record_fd)",
  "            print('FD_READER_MATCHES_WRITER', flush=True)",
  "            with open(os.path.join(root, 'anchor', 'vault', 'published.json'), 'rb') as path_reader:",
  "                assert path_reader.read() == b'{\"recordId\":\"synthetic-only\",\"writer\":\"decoy\"}\\n'",
  "            print('PATH_READER_DIVERGES', flush=True)",
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

describe("Forward Vault same-dirfd reader/writer namespace (disposable Linux probe)", () => {
  it("keeps FD-relative readback bound to the writer while the original pathname reads valid decoy JSON", {
    skip: !pythonAvailable,
    timeout: 20_000,
  }, (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-fd-reader-"));
    const anchor = join(root, "anchor", "vault");
    const decoy = join(root, "decoy", "vault");
    const anchoredJson = '{"recordId":"synthetic-only","writer":"anchored"}\n';
    const decoyJson = '{"recordId":"synthetic-only","writer":"decoy"}\n';
    try {
      mkdirSync(anchor, { recursive: true });
      mkdirSync(decoy, { recursive: true });
      stage(join(anchor, "staged.json"), anchoredJson);
      stage(join(decoy, "published.json"), decoyJson);

      const result = spawnSync("python3", ["-c", pythonProbe, root], {
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
      assert.equal(result.stdout, "FD_READER_MATCHES_WRITER\nPATH_READER_DIVERGES\n");

      // A raw path reader follows the substituted ancestor to valid decoy
      // JSON. The existing strict SDK reader rejects that symlink ancestor,
      // but cannot reach the anchored publisher's record by the old path.
      assert.equal(lstatSync(join(root, "anchor")).isSymbolicLink(), true);
      assert.equal(existsSync(join(root, "moved", "vault", "staged.json")), false);
      assert.equal(readFileSync(join(root, "moved", "vault", "published.json"), "utf8"), anchoredJson);
      assert.equal(statSync(join(root, "moved", "vault", "published.json")).nlink, 1);
      assert.equal(readFileSync(join(root, "anchor", "vault", "published.json"), "utf8"), decoyJson);
      assert.equal(verifyJsonReadback(join(root, "moved", "vault", "published.json")).ok, true);
      const strictCanonical = verifyJsonReadback(join(root, "anchor", "vault", "published.json"));
      assert.equal(strictCanonical.ok, false);
      assert.equal(strictCanonical.errors.some((error) => error.includes("parent path must be a real directory")), true);
      assert.equal(readFileSync(join(decoy, "published.json"), "utf8"), decoyJson);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
