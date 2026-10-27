import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only, disposable Linux namespace-provenance probe. A pinned root
// directory FD is a traversal boundary, not evidence that a subsequently
// opened mutable child name is the previously authorized directory object.
// No SDK, native production bridge, recovery, mount or protected N2 changes.
const pythonProbe = [
  "import ctypes, errno, os, stat, sys",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "renameat2 = getattr(libc, 'renameat2', None)",
  "if renameat2 is None: sys.exit(77)",
  "renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
  "renameat2.restype = ctypes.c_int",
  "root, mode = sys.argv[1:]",
  "flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW",
  "root_fd = os.open(root, flags)",
  "try:",
  "    authorized_fd = os.open('anchor/vault', flags, dir_fd=root_fd)",
  "    try:",
  "        expected = os.fstat(authorized_fd)",
  "        os.rename('anchor', 'moved', src_dir_fd=root_fd, dst_dir_fd=root_fd)",
  "        os.rename('decoy', 'anchor', src_dir_fd=root_fd, dst_dir_fd=root_fd)",
  "        late_fd = os.open('anchor/vault', flags, dir_fd=root_fd)",
  "        try:",
  "            actual = os.fstat(late_fd)",
  "            assert (expected.st_dev, expected.st_ino) != (actual.st_dev, actual.st_ino)",
  "            print('PINNED_ROOT_NOT_FINAL_IDENTITY', flush=True)",
  "            if mode == 'guarded':",
  "                print('EXPECTED_FINAL_IDENTITY_MISMATCH_DENIED', flush=True)",
  "            elif mode == 'unguarded':",
  "                rc = renameat2(late_fd, b'staged.json', late_fd, b'published.json', 1)",
  "                if rc != 0:",
  "                    err = ctypes.get_errno()",
  "                    if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL, errno.EPERM): sys.exit(77)",
  "                    raise OSError(err, os.strerror(err))",
  "                read_fd = os.open('published.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=late_fd)",
  "                try:",
  "                    record = os.fstat(read_fd)",
  "                    assert stat.S_ISREG(record.st_mode) and record.st_nlink == 1",
  "                    assert os.read(read_fd, 4096) == b'{\"recordId\":\"synthetic-only\",\"writer\":\"decoy\"}\\n'",
  "                finally: os.close(read_fd)",
  "                print('LATE_PIN_READER_WRITER_AGREE_ON_DECOY', flush=True)",
  "            else: raise AssertionError('unknown mode')",
  "        finally: os.close(late_fd)",
  "    finally: os.close(authorized_fd)",
  "finally: os.close(root_fd)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
}

function probe(mode: "guarded" | "unguarded", t: { skip: (reason: string) => void }): void {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-bootstrap-"));
  const original = '{"recordId":"synthetic-only","writer":"original"}\n';
  const decoy = '{"recordId":"synthetic-only","writer":"decoy"}\n';
  try {
    mkdirSync(join(root, "anchor", "vault"), { recursive: true });
    mkdirSync(join(root, "decoy", "vault"), { recursive: true });
    stage(join(root, "anchor", "vault", "staged.json"), original);
    stage(join(root, "decoy", "vault", "staged.json"), decoy);
    const result = spawnSync("python3", ["-c", pythonProbe, root, mode], {
      encoding: "utf8", timeout: 8_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    if (result.status === 77) { t.skip("renameat2 RENAME_NOREPLACE unavailable"); return; }
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const prefix = "PINNED_ROOT_NOT_FINAL_IDENTITY\n";
    assert.equal(result.stdout, prefix + (mode === "guarded"
      ? "EXPECTED_FINAL_IDENTITY_MISMATCH_DENIED\n"
      : "LATE_PIN_READER_WRITER_AGREE_ON_DECOY\n"));
    assert.equal(readFileSync(join(root, "moved", "vault", "staged.json"), "utf8"), original);
    assert.equal(existsSync(join(root, "moved", "vault", "published.json")), false);
    if (mode === "guarded") {
      assert.equal(readFileSync(join(root, "anchor", "vault", "staged.json"), "utf8"), decoy);
      assert.equal(existsSync(join(root, "anchor", "vault", "published.json")), false);
    } else {
      assert.equal(existsSync(join(root, "anchor", "vault", "staged.json")), false);
      assert.equal(readFileSync(join(root, "anchor", "vault", "published.json"), "utf8"), decoy);
      assert.equal(statSync(join(root, "anchor", "vault", "published.json")).nlink, 1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Forward Vault pinned-root bootstrap provenance (disposable Linux probe)", () => {
  it("demonstrates that reader/writer agreement after a late child pin does not authenticate the publisher", {
    skip: !pythonAvailable, timeout: 20_000,
  }, (t) => { probe("unguarded", t); });

  it("denies a late child pin when its identity differs from a simulated pre-authorized final directory", {
    skip: !pythonAvailable, timeout: 20_000,
  }, (t) => { probe("guarded", t); });
});
