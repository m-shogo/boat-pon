import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only, disposable session-replay negative control. Both peer and
// directory object are deliberately identical. Session labels are synthetic
// fixed fixtures, NOT authenticated challenges or a production protocol.
// String.raw preserves embedded Python source escapes (prior LEARN guardrail).
const pythonProbe = String.raw`
import array, os, socket, stat, struct, sys
root, mode = sys.argv[1:]
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
reference_fd = os.open(os.path.join(root, 'authorized'), flags)
sender_fd = os.open(os.path.join(root, 'authorized'), flags)
sender, receiver = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
consumed = set()
reads = 0

def receive(frame):
    sender.sendmsg([frame.encode('ascii')], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [sender_fd]))])
    payload, ancillary, msg_flags, _ = receiver.recvmsg(32, socket.CMSG_SPACE(array.array('i').itemsize * 4), socket.MSG_CMSG_CLOEXEC)
    received = []
    for level, kind, data in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            values = array.array('i')
            assert len(data) % values.itemsize == 0
            values.frombytes(data)
            received.extend(values)
    assert msg_flags & ~socket.MSG_CMSG_CLOEXEC == 0
    assert len(received) == 1
    fd = received[0]
    assert not os.get_inheritable(fd)
    expected = os.fstat(reference_fd)
    actual = os.fstat(fd)
    assert stat.S_ISDIR(actual.st_mode)
    assert (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
    return payload.decode('ascii'), fd

def read_synthetic(fd):
    global reads
    file_fd = os.open('synthetic.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        assert os.read(file_fd, 4096) == b'authorized-synthetic-only'
        reads += 1
    finally:
        os.close(file_fd)

def admit(frame, expected):
    if frame != expected or frame in consumed:
        return False
    consumed.add(frame)
    return True

try:
    credentials = receiver.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))
    assert struct.unpack('3i', credentials) == (os.getpid(), os.getuid(), os.getgid())
    if mode == 'stale-unbound':
        frame, fd = receive('SESSION_A')
        try:
            assert frame == 'SESSION_A'
            read_synthetic(fd)
            print('STALE_SESSION_UNBOUND_ACCEPTED', flush=True)
        finally:
            os.close(fd)
    elif mode == 'stale-deny':
        frame, fd = receive('SESSION_A')
        try:
            assert not admit(frame, 'SESSION_B')
            assert reads == 0
            print('STALE_SESSION_REJECTED_BEFORE_READ', flush=True)
        finally:
            os.close(fd)
    elif mode == 'current-accept':
        frame, fd = receive('SESSION_B')
        try:
            assert admit(frame, 'SESSION_B')
            read_synthetic(fd)
            assert reads == 1
            print('CURRENT_SESSION_ACCEPTED', flush=True)
        finally:
            os.close(fd)
    elif mode == 'duplicate-deny':
        frame, fd = receive('SESSION_B')
        try:
            assert admit(frame, 'SESSION_B')
            read_synthetic(fd)
        finally:
            os.close(fd)
        frame, fd = receive('SESSION_B')
        try:
            assert not admit(frame, 'SESSION_B')
            assert reads == 1
            print('DUPLICATE_SESSION_REJECTED_BEFORE_SECOND_READ', flush=True)
        finally:
            os.close(fd)
    else:
        raise AssertionError('unknown mode')
finally:
    sender.close()
    receiver.close()
    os.close(sender_fd)
    os.close(reference_fd)
`;

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function probe(mode: "stale-unbound" | "stale-deny" | "current-accept" | "duplicate-deny"): void {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-scm-session-"));
  try {
    mkdirSync(join(root, "authorized"));
    writeFileSync(join(root, "authorized", "synthetic.json"), "authorized-synthetic-only", { flag: "wx" });
    const result = spawnSync("python3", ["-c", pythonProbe, root, mode], {
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const expected = {
      "stale-unbound": "STALE_SESSION_UNBOUND_ACCEPTED",
      "stale-deny": "STALE_SESSION_REJECTED_BEFORE_READ",
      "current-accept": "CURRENT_SESSION_ACCEPTED",
      "duplicate-deny": "DUPLICATE_SESSION_REJECTED_BEFORE_SECOND_READ",
    }[mode];
    assert.equal(result.stdout, expected + "\n");
    assert.equal(readFileSync(join(root, "authorized", "synthetic.json"), "utf8"), "authorized-synthetic-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Forward Vault SCM_RIGHTS session freshness (disposable Linux probe)", () => {
  it("demonstrates that matching peer and directory object do not bind a stale session", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("stale-unbound"); });
  it("rejects a stale session label before opening the received directory payload", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("stale-deny"); });
  it("accepts a current, unconsumed synthetic session label and matching directory", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("current-accept"); });
  it("rejects the same session label a second time before any second payload read", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("duplicate-deny"); });
});
