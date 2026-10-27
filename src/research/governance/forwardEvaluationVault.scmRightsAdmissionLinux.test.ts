import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Disposable research-only Linux negative controls for an untrusted FD handoff.
// No production bridge, real evidence, mounts, SDK behavior or recovery.
// String.raw preserves Python source escapes (prior LEARN fixture guardrail).
const pythonProbe = String.raw`
import array, errno, os, socket, struct, subprocess, sys
root, mode = sys.argv[1:]
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
source_fd = os.open(os.path.join(root, 'authorized'), flags)
received = []
try:
    if mode in ('truncation', 'multiple', 'cloexec'):
        sender, receiver = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
        try:
            count = 4 if mode == 'truncation' else 2 if mode == 'multiple' else 1
            capacity = 1 if mode == 'truncation' else 4
            sender.sendmsg([b'X'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [source_fd] * count))])
            payload, ancillary, msg_flags, _ = receiver.recvmsg(1, socket.CMSG_SPACE(array.array('i').itemsize * capacity), socket.MSG_CMSG_CLOEXEC)
            for level, kind, data in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    values = array.array('i')
                    assert len(data) % values.itemsize == 0
                    values.frombytes(data)
                    received.extend(values)
            assert payload == b'X'
            if mode == 'truncation':
                assert msg_flags & socket.MSG_CTRUNC, (msg_flags, received)
                print('TRUNCATED_ANCILLARY_REJECTED', flush=True)
            elif mode == 'multiple':
                assert not (msg_flags & socket.MSG_CTRUNC)
                assert len(received) == 2, received
                print('MULTIPLE_FDS_REJECTED', flush=True)
            else:
                assert msg_flags & ~socket.MSG_CMSG_CLOEXEC == 0 and len(received) == 1
                assert not os.get_inheritable(received[0]), 'MSG_CMSG_CLOEXEC not enforced'
                file_fd = os.open('synthetic.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=received[0])
                try:
                    assert os.read(file_fd, 4096) == b'synthetic-admission-only'
                finally:
                    os.close(file_fd)
                print('SINGLE_CLOEXEC_ACCEPTED', flush=True)
        finally:
            sender.close()
            receiver.close()
    elif mode in ('peer-accept', 'peer-reject'):
        path = os.path.join(root, 'handoff.sock')
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.settimeout(5)
        try:
            listener.bind(path)
            listener.listen(1)
            child_source = '''
import array, os, socket, sys
path, directory = sys.argv[1:]
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.connect(path)
fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    sock.sendmsg([b'X'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]))])
finally:
    os.close(fd)
    sock.close()
print('SENT', flush=True)
'''
            child = subprocess.Popen([sys.executable, '-c', child_source, path, os.path.join(root, 'authorized')], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            conn, _ = listener.accept()
            conn.settimeout(5)
            try:
                creds = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))
                pid, uid, gid = struct.unpack('3i', creds)
                assert (pid, uid, gid) == (child.pid, os.getuid(), os.getgid())
                payload, ancillary, msg_flags, _ = conn.recvmsg(1, socket.CMSG_SPACE(array.array('i').itemsize), socket.MSG_CMSG_CLOEXEC)
                for level, kind, data in ancillary:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        values = array.array('i')
                        assert len(data) % values.itemsize == 0
                        values.frombytes(data)
                        received.extend(values)
                assert payload == b'X' and msg_flags & ~socket.MSG_CMSG_CLOEXEC == 0 and len(received) == 1
                assert not os.get_inheritable(received[0])
                expected_pid = child.pid if mode == 'peer-accept' else child.pid + 1
                if pid != expected_pid:
                    print('UNAUTHORIZED_PEER_REJECTED', flush=True)
                else:
                    file_fd = os.open('synthetic.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=received[0])
                    try:
                        assert os.read(file_fd, 4096) == b'synthetic-admission-only'
                    finally:
                        os.close(file_fd)
                    print('AUTHORIZED_PEER_ACCEPTED', flush=True)
            finally:
                conn.close()
            stdout, stderr = child.communicate(timeout=5)
            assert child.returncode == 0 and stdout == 'SENT\\n' and stderr == '', (child.returncode, stdout, stderr)
        finally:
            listener.close()
    else:
        raise ValueError(mode)
finally:
    for fd in received:
        os.close(fd)
        try:
            os.fstat(fd)
        except OSError as error:
            assert error.errno == errno.EBADF
        else:
            raise AssertionError('received FD not closed')
    os.close(source_fd)
`;

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function probe(mode: "truncation" | "multiple" | "cloexec" | "peer-accept" | "peer-reject"): void {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-scm-admission-"));
  try {
    mkdirSync(join(root, "authorized"));
    writeFileSync(join(root, "authorized", "synthetic.json"), "synthetic-admission-only", { flag: "wx" });
    const result = spawnSync("python3", ["-c", pythonProbe, root, mode], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const expected = {
      truncation: "TRUNCATED_ANCILLARY_REJECTED\\n",
      multiple: "MULTIPLE_FDS_REJECTED\\n",
      cloexec: "SINGLE_CLOEXEC_ACCEPTED\\n",
      "peer-accept": "AUTHORIZED_PEER_ACCEPTED\\n",
      "peer-reject": "UNAUTHORIZED_PEER_REJECTED\\n",
    }[mode];
    assert.equal(result.stdout, expected);
    assert.equal(readFileSync(join(root, "authorized", "synthetic.json"), "utf8"), "synthetic-admission-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Forward Vault SCM_RIGHTS receiver admission (disposable Linux probe)", () => {
  it("rejects MSG_CTRUNC rather than accepting a partial FD set", { skip: !pythonAvailable, timeout: 20_000 }, () => { probe("truncation"); });
  it("rejects unexpected multiple descriptors", { skip: !pythonAvailable, timeout: 20_000 }, () => { probe("multiple"); });
  it("accepts exactly one descriptor with MSG_CMSG_CLOEXEC", { skip: !pythonAvailable, timeout: 20_000 }, () => { probe("cloexec"); });
  it("checks the actual connecting peer credentials before an authorized synthetic read", { skip: !pythonAvailable, timeout: 20_000 }, () => { probe("peer-accept"); });
  it("rejects a peer that does not match the expected process identity", { skip: !pythonAvailable, timeout: 20_000 }, () => { probe("peer-reject"); });
});
