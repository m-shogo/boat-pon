import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only, disposable Linux contract probe. EAGAIN is injected at the
// syscall adapter boundary; this does NOT claim the kernel emitted EAGAIN
// during a rename race, nor does it modify the SDK or add a native bridge.
const pythonProbe = [
  "import ctypes, errno, os, platform, stat, sys",
  "if platform.machine() not in ('x86_64', 'aarch64'): sys.exit(77)",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "class OpenHow(ctypes.Structure):",
  "    _fields_ = [('flags', ctypes.c_uint64), ('mode', ctypes.c_uint64), ('resolve', ctypes.c_uint64)]",
  "RESOLVE_NO_XDEV = 0x01",
  "RESOLVE_NO_SYMLINKS = 0x04",
  "RESOLVE_BENEATH = 0x08",
  "RESOLVE = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV",
  "def kernel_openat2(dirfd, name, resolve):",
  "    how = OpenHow(os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, 0, resolve)",
  "    fd = libc.syscall(437, dirfd, os.fsencode(name), ctypes.byref(how), ctypes.sizeof(how))",
  "    if fd < 0:",
  "        err = ctypes.get_errno()",
  "        if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EPERM): sys.exit(77)",
  "        raise OSError(err, os.strerror(err))",
  "    return fd",
  "def read_once(open_impl, dirfd, name):",
  "    try:",
  "        fd = open_impl(dirfd, name, RESOLVE)",
  "    except OSError as error:",
  "        if error.errno == errno.EAGAIN:",
  "            return ('INDETERMINATE_DENY', None)",
  "        return ('ERROR_DENY', None)",
  "    try:",
  "        st = os.fstat(fd)",
  "        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:",
  "            return ('IDENTITY_DENY', None)",
  "        return ('READ_OK', os.read(fd, 4096))",
  "    finally:",
  "        os.close(fd)",
  "root, expected = sys.argv[1:]",
  "root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)",
  "try:",
  "    assert read_once(kernel_openat2, root_fd, 'anchor/vault/published.json') == ('READ_OK', expected.encode())",
  "    print('KERNEL_CONTROL_READ_OK', flush=True)",
  "    calls = []",
  "    def injected_eagain(dirfd, name, resolve):",
  "        calls.append((dirfd, name, resolve))",
  "        raise OSError(errno.EAGAIN, os.strerror(errno.EAGAIN))",
  "    assert read_once(injected_eagain, root_fd, 'anchor/vault/published.json') == ('INDETERMINATE_DENY', None)",
  "    assert calls == [(root_fd, 'anchor/vault/published.json', RESOLVE)], calls",
  "    assert read_once(kernel_openat2, root_fd, 'anchor/vault/published.json') == ('READ_OK', expected.encode())",
  "    print('INJECTED_EAGAIN_ONE_ATTEMPT_DENIED_NO_FALLBACK', flush=True)",
  "finally:",
  "    os.close(root_fd)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

describe("Forward Vault openat2 EAGAIN fail-closed contract (disposable Linux probe)", () => {
  it("denies injected resolution uncertainty after one attempt without a pathname fallback", {
    skip: !pythonAvailable, timeout: 20_000,
  }, (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-openat2-eagain-"));
    const content = '{"recordId":"synthetic-only","writer":"original"}\n';
    try {
      mkdirSync(join(root, "anchor", "vault"), { recursive: true });
      const path = join(root, "anchor", "vault", "published.json");
      const fd = openSync(path, "wx", 0o600);
      try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
      finally { closeSync(fd); }
      const result = spawnSync("python3", ["-I", "-c", pythonProbe, root, content], {
        encoding: "utf8", timeout: 8_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      if (result.status === 77) { t.skip("openat2 syscall unavailable or blocked"); return; }
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout,
        "KERNEL_CONTROL_READ_OK\nINJECTED_EAGAIN_ONE_ATTEMPT_DENIED_NO_FALLBACK\n");
      assert.equal(readFileSync(path, "utf8"), content);
      assert.equal(statSync(path).nlink, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
