import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only, disposable Linux directory-FD lifetime probe. The receiver
// validates synthetic content; it does not authenticate original provenance.
// String.raw prevents JS from changing Python source escapes (v390 guardrail).
const pythonProbe = String.raw`
import array, errno, os, socket, subprocess, sys
root, mode = sys.argv[1:]
fd = os.open(os.path.join(root, 'authorized'), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    identity = os.fstat(fd)
    if mode == 'exec':
        child_source = '''
import errno, os, sys
fd = int(sys.argv[1])
try:
    os.fstat(fd)
except OSError as error:
    assert error.errno == errno.EBADF
    print('CLOEXEC_DENIED', flush=True)
else:
    raise AssertionError('unexpected inherited directory FD')
'''
        denied = subprocess.run([sys.executable, '-c', child_source, str(fd)], close_fds=False, capture_output=True, text=True, timeout=5)
        assert denied.returncode == 0, denied.stderr
        assert denied.stdout == 'CLOEXEC_DENIED\n', (denied.stdout, denied.stderr)
        # Explicit pass_fds intentionally clears close-on-exec for this child.
        child_source = '''
import os, sys
fd = int(sys.argv[1])
info = os.fstat(fd)
assert (info.st_dev, info.st_ino) == (int(sys.argv[2]), int(sys.argv[3]))
print('EXPLICIT_INHERITANCE_CONFIRMED', flush=True)
'''
        allowed = subprocess.run([sys.executable, '-c', child_source, str(fd), str(identity.st_dev), str(identity.st_ino)], pass_fds=(fd,), capture_output=True, text=True, timeout=5)
        assert allowed.returncode == 0, allowed.stderr
        assert allowed.stdout == 'EXPLICIT_INHERITANCE_CONFIRMED\n', (allowed.stdout, allowed.stderr)
        print('EXEC_BOUNDARY_CONFIRMED', flush=True)
    elif mode == 'transfer':
        parent_sock, child_sock = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        child_source = '''
import array, os, socket, sys
sock = socket.socket(fileno=int(sys.argv[1]))
message, anc, flags, address = sock.recvmsg(1, socket.CMSG_SPACE(array.array('i').itemsize))
received = array.array('i')
for level, kind, data in anc:
    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
        received.frombytes(data[:len(data) - len(data) % received.itemsize])
assert message == b'X' and len(received) == 1 and not flags
received_fd = received[0]
info = os.fstat(received_fd)
assert (info.st_dev, info.st_ino) == (int(sys.argv[2]), int(sys.argv[3]))
file_fd = os.open('synthetic.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=received_fd)
try:
    assert os.read(file_fd, 4096) == b'synthetic-cross-process-only'
finally:
    os.close(file_fd)
os.close(received_fd)
print('SCM_RIGHTS_LIVE_AFTER_PARENT_CLOSE', flush=True)
'''
        proc = subprocess.Popen([sys.executable, '-c', child_source, str(child_sock.fileno()), str(identity.st_dev), str(identity.st_ino)], pass_fds=(child_sock.fileno(),), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        child_sock.close()
        parent_sock.sendmsg([b'X'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]))])
        os.close(fd)
        fd = None
        parent_sock.close()
        stdout, stderr = proc.communicate(timeout=5)
        assert proc.returncode == 0, stderr
        assert stdout == 'SCM_RIGHTS_LIVE_AFTER_PARENT_CLOSE\n', (stdout, stderr)
        print('TRANSFER_CONFIRMED', flush=True)
    else:
        raise ValueError(mode)
finally:
    if fd is not None:
        os.close(fd)
`;

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function probe(mode: "exec" | "transfer"): void {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-fd-transfer-"));
  try {
    mkdirSync(join(root, "authorized"));
    writeFileSync(join(root, "authorized", "synthetic.json"), "synthetic-cross-process-only", { flag: "wx" });
    const result = spawnSync("python3", ["-c", pythonProbe, root, mode], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, mode === "exec" ? "EXEC_BOUNDARY_CONFIRMED\n" : "TRANSFER_CONFIRMED\n");
    assert.equal(readFileSync(join(root, "authorized", "synthetic.json"), "utf8"), "synthetic-cross-process-only");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("Forward Vault cross-process directory FD lifetime (disposable Linux probe)", () => {
  it("honors O_CLOEXEC unless a child is explicitly granted the descriptor", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("exec"); });
  it("retains the directory object across SCM_RIGHTS after the sender closes its FD", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("transfer"); });
});
