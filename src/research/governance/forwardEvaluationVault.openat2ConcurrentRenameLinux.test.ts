import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only bounded kernel race observation: EAGAIN is permitted but not
// required for PASS. No retry/fallback or SDK integration is implemented.
// All renames occur inside a disposable synthetic directory, never N2.
const pythonProbe = [
  "import collections, ctypes, errno, os, platform, stat, sys, threading",
  "if platform.machine() not in ('x86_64', 'aarch64'): sys.exit(77)",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "class OpenHow(ctypes.Structure):",
  "    _fields_ = [('flags', ctypes.c_uint64), ('mode', ctypes.c_uint64), ('resolve', ctypes.c_uint64)]",
  "root, expected = sys.argv[1:]",
  "root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)",
  "stop = threading.Event()",
  "thread_errors = []",
  "def renamer():",
  "    try:",
  "        while not stop.is_set():",
  "            os.rename('anchor', 'moved', src_dir_fd=root_fd, dst_dir_fd=root_fd)",
  "            os.rename('moved', 'anchor', src_dir_fd=root_fd, dst_dir_fd=root_fd)",
  "    except Exception as error: thread_errors.append(str(error))",
  "thread = threading.Thread(target=renamer)",
  "counts = collections.Counter()",
  "try:",
  "    thread.start()",
  "    how = OpenHow(os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, 0, 0x01 | 0x04 | 0x08)",
  "    for _ in range(8000):",
  "        fd = libc.syscall(437, root_fd, b'anchor/../anchor/vault/published.json', ctypes.byref(how), ctypes.sizeof(how))",
  "        if fd >= 0:",
  "            try:",
  "                st = os.fstat(fd)",
  "                assert stat.S_ISREG(st.st_mode) and st.st_nlink == 1",
  "                assert os.read(fd, 4096) == expected.encode()",
  "            finally: os.close(fd)",
  "            counts['OK'] += 1",
  "        else:",
  "            error = ctypes.get_errno()",
  "            if error in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EPERM): sys.exit(77)",
  "            assert error in (errno.EAGAIN, errno.ENOENT, errno.EXDEV), (error, counts)",
  "            counts[errno.errorcode[error]] += 1",
  "finally:",
  "    stop.set()",
  "    if thread.is_alive(): thread.join(timeout=5)",
  "    os.close(root_fd)",
  "assert not thread.is_alive(), 'rename thread failed to stop'",
  "assert not thread_errors, thread_errors",
  "assert sum(counts.values()) == 8000, counts",
  "print('BOUNDED_KERNEL_RENAME_ATTEMPTS=8000', flush=True)",
  "print('OK=%d EAGAIN=%d ENOENT=%d EXDEV=%d' % tuple(counts[x] for x in ('OK','EAGAIN','ENOENT','EXDEV')), flush=True)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

describe("Forward Vault bounded real-kernel openat2 concurrent rename (disposable Linux probe)", () => {
  it("never accepts unexpected errors or bytes; EAGAIN occurrence is observational, not required", {
    skip: !pythonAvailable, timeout: 25_000,
  }, (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-openat2-rename-"));
    const content = '{"recordId":"synthetic-only","writer":"original"}\n';
    try {
      mkdirSync(join(root, "anchor", "vault"), { recursive: true });
      const path = join(root, "anchor", "vault", "published.json");
      const fd = openSync(path, "wx", 0o600);
      try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
      finally { closeSync(fd); }
      const result = spawnSync("python3", ["-c", pythonProbe, root, content], {
        encoding: "utf8", timeout: 15_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      if (result.status === 77) { t.skip("openat2 syscall unavailable or blocked"); return; }
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const match = /^BOUNDED_KERNEL_RENAME_ATTEMPTS=8000\nOK=(\d+) EAGAIN=(\d+) ENOENT=(\d+) EXDEV=(\d+)\n$/.exec(result.stdout);
      assert.ok(match, result.stdout);
      const counts = match.slice(1).map(Number);
      assert.equal(counts.reduce((a, b) => a + b, 0), 8_000);
      // Do not assert an EAGAIN minimum: kernel scheduling is not deterministic.
      assert.equal(readFileSync(path, "utf8"), content);
      assert.equal(statSync(path).nlink, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
