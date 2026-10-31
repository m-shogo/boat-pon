import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Disposable research-only capability-binding negative control. The trusted
// directory FD is a synthetic fixture assumption, not authenticated provenance.
// String.raw preserves Python newlines (prior embedded-fixture LEARN guardrail).
// Python -I ignores ambient PYTHONOPTIMIZE, preserving assert-based synthetic test oracles.
const pythonProbe = String.raw`
import array, errno, os, socket, stat, struct, sys
root, mode = sys.argv[1:]
if sys.flags.optimize != 0:
    raise RuntimeError("optimized Python disables synthetic assertion oracles")
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
authorized_fd = os.open(os.path.join(root, 'authorized'), flags)
decoy_fd = os.open(os.path.join(root, 'decoy'), flags)
received = []
sender, receiver = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
try:
    credentials = receiver.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))
    pid, uid, gid = struct.unpack('3i', credentials)
    assert (pid, uid, gid) == (os.getpid(), os.getuid(), os.getgid())
    offered_fd = authorized_fd if mode == 'bound-accept' else decoy_fd
    sender.sendmsg([b'X'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [offered_fd]))])
    payload, ancillary, msg_flags, _ = receiver.recvmsg(1, socket.CMSG_SPACE(array.array('i').itemsize * 4), socket.MSG_CMSG_CLOEXEC)
    for level, kind, data in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            values = array.array('i')
            assert len(data) % values.itemsize == 0
            values.frombytes(data)
            received.extend(values)
    assert payload == b'X' and msg_flags & ~socket.MSG_CMSG_CLOEXEC == 0
    assert len(received) == 1 and not os.get_inheritable(received[0])
    expected = os.fstat(authorized_fd)
    actual = os.fstat(received[0])
    assert stat.S_ISDIR(actual.st_mode)
    same_object = (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
    if mode == 'bound-deny':
        assert not same_object
        # Do not open any payload through a rejected received descriptor.
        print('BOUND_DIRECTORY_MISMATCH_REJECTED', flush=True)
    elif mode == 'peer-only':
        assert not same_object
        # Negative control: a matching peer identity alone would admit a decoy.
        file_fd = os.open('synthetic.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=received[0])
        try:
            assert os.read(file_fd, 4096) == b'decoy-synthetic-only'
        finally:
            os.close(file_fd)
        print('PEER_ONLY_WRONG_DIRECTORY_ACCEPTED', flush=True)
    elif mode == 'bound-accept':
        assert same_object
        file_fd = os.open('synthetic.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=received[0])
        try:
            assert os.read(file_fd, 4096) == b'authorized-synthetic-only'
        finally:
            os.close(file_fd)
        print('BOUND_AUTHORIZED_DIRECTORY_ACCEPTED', flush=True)
    else:
        raise AssertionError('unknown mode')
finally:
    for fd in received:
        os.close(fd)
        try:
            os.fstat(fd)
        except OSError as error:
            assert error.errno == errno.EBADF
        else:
            raise AssertionError('received FD not closed')
    sender.close()
    receiver.close()
    os.close(decoy_fd)
    os.close(authorized_fd)
`;

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function probe(mode: "peer-only" | "bound-deny" | "bound-accept"): void {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-scm-binding-"));
  try {
    mkdirSync(join(root, "authorized"));
    mkdirSync(join(root, "decoy"));
    writeFileSync(join(root, "authorized", "synthetic.json"), "authorized-synthetic-only", { flag: "wx" });
    writeFileSync(join(root, "decoy", "synthetic.json"), "decoy-synthetic-only", { flag: "wx" });
    const result = spawnSync("python3", ["-I", "-c", pythonProbe, root, mode], {
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const expected = {
      "peer-only": "PEER_ONLY_WRONG_DIRECTORY_ACCEPTED\n",
      "bound-deny": "BOUND_DIRECTORY_MISMATCH_REJECTED\n",
      "bound-accept": "BOUND_AUTHORIZED_DIRECTORY_ACCEPTED\n",
    }[mode];
    assert.equal(result.stdout, expected);
    assert.equal(readFileSync(join(root, "authorized", "synthetic.json"), "utf8"), "authorized-synthetic-only");
    assert.equal(readFileSync(join(root, "decoy", "synthetic.json"), "utf8"), "decoy-synthetic-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Forward Vault SCM_RIGHTS directory binding (disposable Linux probe)", () => {
  it("demonstrates that matching peer credentials alone admit a wrong directory capability", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("peer-only"); });
  it("denies the wrong directory FD against a pre-pinned synthetic identity before any read", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("bound-deny"); });
  it("admits the exact pre-pinned synthetic directory FD with a bounded read", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("bound-accept"); });
});
