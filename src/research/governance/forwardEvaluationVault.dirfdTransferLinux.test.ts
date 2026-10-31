import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only, disposable Linux directory-FD lifetime probe. The receiver
// validates synthetic content; it does not authenticate original provenance.
// String.raw prevents JS from changing Python source escapes (v390 guardrail).
// Python -I ignores ambient PYTHONOPTIMIZE, preserving assert-based synthetic test oracles.
const pythonProbe = String.raw`
import array, errno, os, socket, subprocess, sys
root, mode = sys.argv[1:]
if sys.flags.optimize != 0:
    raise RuntimeError("optimized Python disables synthetic assertion oracles")
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
        denied = subprocess.run([sys.executable, '-I', '-c', child_source, str(fd)], close_fds=False, capture_output=True, text=True, timeout=5)
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
        allowed = subprocess.run([sys.executable, '-I', '-c', child_source, str(fd), str(identity.st_dev), str(identity.st_ino)], pass_fds=(fd,), capture_output=True, text=True, timeout=5)
        assert allowed.returncode == 0, allowed.stderr
        assert allowed.stdout == 'EXPLICIT_INHERITANCE_CONFIRMED\n', (allowed.stdout, allowed.stderr)
        print('EXEC_BOUNDARY_CONFIRMED', flush=True)
    elif mode in ('transfer', 'transfer-deny-close'):
        parent_sock, child_sock = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        child_source = '''
import array, errno, os, socket, sys
sock = socket.socket(fileno=int(sys.argv[1]))
received = array.array('i')
try:
    message, anc, flags, address = sock.recvmsg(1, socket.CMSG_SPACE(received.itemsize))
    for level, kind, data in anc:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            assert len(data) % received.itemsize == 0
            received.frombytes(data)
    assert message == b'X' and len(received) == 1 and not flags
    info = os.fstat(received[0])
    matches = (info.st_dev, info.st_ino) == (int(sys.argv[2]), int(sys.argv[3]))
    if sys.argv[4] == 'transfer-deny-close':
        # Negative control: reject a mismatched pinned identity before any read.
        assert not matches
        outcome = 'MISMATCH_DENIED_BEFORE_READ_AND_FD_CLOSED'
    else:
        assert matches
        file_fd = os.open('synthetic.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=received[0])
        try:
            assert os.read(file_fd, 4096) == b'synthetic-cross-process-only'
        finally:
            os.close(file_fd)
        outcome = 'SCM_RIGHTS_LIVE_AFTER_PARENT_CLOSE'
finally:
    # recvmsg installs descriptors before identity admission. A rejection
    # must close them while this child process is still alive.
    for received_fd in received:
        os.close(received_fd)
        try:
            os.fstat(received_fd)
        except OSError as error:
            assert error.errno == errno.EBADF
        else:
            raise AssertionError('received FD survived receiver cleanup')
    sock.close()
print(outcome, flush=True)
'''
        proc = subprocess.Popen([sys.executable, '-I', '-c', child_source, str(child_sock.fileno()), str(identity.st_dev), str(identity.st_ino + (1 if mode == 'transfer-deny-close' else 0)), mode], pass_fds=(child_sock.fileno(),), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        child_sock.close()
        parent_sock.sendmsg([b'X'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]))])
        os.close(fd)
        fd = None
        parent_sock.close()
        stdout, stderr = proc.communicate(timeout=5)
        assert proc.returncode == 0, stderr
        expected = 'MISMATCH_DENIED_BEFORE_READ_AND_FD_CLOSED\n' if mode == 'transfer-deny-close' else 'SCM_RIGHTS_LIVE_AFTER_PARENT_CLOSE\n'
        assert stdout == expected, (stdout, stderr)
        print('TRANSFER_MISMATCH_REJECTED_AND_CLOSED' if mode == 'transfer-deny-close' else 'TRANSFER_CONFIRMED', flush=True)
    else:
        raise ValueError(mode)
finally:
    if fd is not None:
        os.close(fd)
`;

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function probe(mode: "exec" | "transfer" | "transfer-deny-close"): void {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-fd-transfer-"));
  try {
    mkdirSync(join(root, "authorized"));
    writeFileSync(join(root, "authorized", "synthetic.json"), "synthetic-cross-process-only", { flag: "wx" });
    const result = spawnSync("python3", ["-I", "-c", pythonProbe, root, mode], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, mode === "exec" ? "EXEC_BOUNDARY_CONFIRMED\n" : mode === "transfer-deny-close" ? "TRANSFER_MISMATCH_REJECTED_AND_CLOSED\n" : "TRANSFER_CONFIRMED\n");
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
  it("closes the received FD on a mismatched identity before child exit or any payload read", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("transfer-deny-close"); });
});
