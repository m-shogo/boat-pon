import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only Linux openat2 probe. The trusted root FD and resolver flags
// constrain traversal, but do NOT pin a mutable intermediate directory name.
// No SDK API, production writer, mount operation, recovery or deletion is changed.
const pythonProbe = [
  "import ctypes, errno, os, platform, stat, sys",
  "if platform.machine() not in ('x86_64', 'aarch64'): sys.exit(77)",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "class OpenHow(ctypes.Structure):",
  "    _fields_ = [('flags', ctypes.c_uint64), ('mode', ctypes.c_uint64), ('resolve', ctypes.c_uint64)]",
  "RESOLVE_NO_XDEV = 0x01",
  "RESOLVE_NO_SYMLINKS = 0x04",
  "RESOLVE_BENEATH = 0x08",
  "def openat2(dirfd, name, resolve):",
  "    how = OpenHow(os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, 0, resolve)",
  "    fd = libc.syscall(437, dirfd, os.fsencode(name), ctypes.byref(how), ctypes.sizeof(how))",
  "    if fd < 0:",
  "        err = ctypes.get_errno()",
  "        if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EPERM): sys.exit(77)",
  "        raise OSError(err, os.strerror(err))",
  "    return fd",
  "def readat(dirfd, name, resolve):",
  "    fd = openat2(dirfd, name, resolve)",
  "    try:",
  "        st = os.fstat(fd)",
  "        assert stat.S_ISREG(st.st_mode) and st.st_nlink == 1",
  "        return os.read(fd, 4096)",
  "    finally: os.close(fd)",
  "def rejected(dirfd, name, resolve, expected):",
  "    try: fd = openat2(dirfd, name, resolve)",
  "    except OSError as error:",
  "        assert error.errno in expected, (name, error.errno)",
  "    else:",
  "        os.close(fd)",
  "        raise AssertionError('unsafe resolution accepted: ' + name)",
  "mode = sys.argv[1]",
  "if mode == 'namespace':",
  "    root, original, decoy = sys.argv[2:]",
  "    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW",
  "    root_fd = os.open(root, flags)",
  "    try:",
  "        anchor_fd = os.open('anchor', flags, dir_fd=root_fd)",
  "        try:",
  "            vault_fd = os.open('vault', flags, dir_fd=anchor_fd)",
  "            try:",
  "                resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS",
  "                assert readat(root_fd, 'anchor/vault/published.json', resolve) == original.encode()",
  "                print('ROOTFD_CONTROL_ORIGINAL', flush=True)",
  "                rejected(root_fd, 'alias/vault/published.json', resolve, (errno.ELOOP,))",
  "                rejected(root_fd, '../outside.json', resolve, (errno.EXDEV,))",
  "                print('SYMLINK_AND_ESCAPE_REJECTED', flush=True)",
  "                os.rename('anchor', 'moved', src_dir_fd=root_fd, dst_dir_fd=root_fd)",
  "                os.rename('decoy', 'anchor', src_dir_fd=root_fd, dst_dir_fd=root_fd)",
  "                assert readat(root_fd, 'anchor/vault/published.json', resolve) == decoy.encode()",
  "                assert readat(vault_fd, 'published.json', resolve) == original.encode()",
  "                print('ROOTFD_REPLACED_PINNED_ORIGINAL', flush=True)",
  "            finally: os.close(vault_fd)",
  "        finally: os.close(anchor_fd)",
  "    finally: os.close(root_fd)",
  "elif mode == 'mount':",
  "    if not os.path.isfile('/proc/version') or os.stat('/').st_dev == os.stat('/proc').st_dev: sys.exit(77)",
  "    root_fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)",
  "    try:",
  "        resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS",
  "        assert readat(root_fd, 'proc/version', resolve).startswith(b'Linux version')",
  "        print('MOUNT_BASELINE_READ_OK', flush=True)",
  "        rejected(root_fd, 'proc/version', resolve | RESOLVE_NO_XDEV, (errno.EXDEV,))",
  "        print('MOUNT_CROSSING_REJECTED', flush=True)",
  "    finally: os.close(root_fd)",
  "else: raise AssertionError('unknown mode')",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
}

describe("Forward Vault openat2 trust-root and mount boundaries (disposable Linux probes)", () => {
  it("rejects symlink/escape traversal but does not pin a replaced real intermediate directory", {
    skip: !pythonAvailable, timeout: 20_000,
  }, (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-openat2-"));
    const original = '{"recordId":"synthetic-only","writer":"original"}\n';
    const decoy = '{"recordId":"synthetic-only","writer":"decoy"}\n';
    try {
      mkdirSync(join(root, "anchor", "vault"), { recursive: true });
      mkdirSync(join(root, "decoy", "vault"), { recursive: true });
      stage(join(root, "anchor", "vault", "published.json"), original);
      stage(join(root, "decoy", "vault", "published.json"), decoy);
      symlinkSync(join(root, "decoy"), join(root, "alias"), "dir");
      const result = spawnSync("python3", ["-I", "-c", pythonProbe, "namespace", root, original, decoy], {
        encoding: "utf8", timeout: 8_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      if (result.status === 77) { t.skip("openat2 syscall unavailable or blocked"); return; }
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout,
        "ROOTFD_CONTROL_ORIGINAL\nSYMLINK_AND_ESCAPE_REJECTED\nROOTFD_REPLACED_PINNED_ORIGINAL\n");
      assert.equal(readFileSync(join(root, "moved", "vault", "published.json"), "utf8"), original);
      assert.equal(readFileSync(join(root, "anchor", "vault", "published.json"), "utf8"), decoy);
      assert.equal(statSync(join(root, "moved", "vault", "published.json")).nlink, 1);
      assert.equal(statSync(join(root, "anchor", "vault", "published.json")).nlink, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an existing /proc mount crossing with RESOLVE_NO_XDEV without modifying mounts", {
    skip: !pythonAvailable, timeout: 20_000,
  }, (t) => {
    const result = spawnSync("python3", ["-I", "-c", pythonProbe, "mount"], {
      encoding: "utf8", timeout: 8_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    if (result.status === 77) { t.skip("openat2 or distinct /proc mount unavailable"); return; }
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "MOUNT_BASELINE_READ_OK\nMOUNT_CROSSING_REJECTED\n");
  });
});
