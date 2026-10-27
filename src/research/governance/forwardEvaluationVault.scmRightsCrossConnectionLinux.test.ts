import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

// Research-only two-socket dispatch negative control. The same synthetic peer,
// directory object, and session label are deliberately valid on both sockets.
// A claimed channel string is forgeable; only the receiver-owned socket route
// is the synthetic admission oracle. No real authentication is implemented.
// String.raw preserves embedded Python source escapes (prior LEARN guardrail).
const pythonProbe = String.raw`
import array, errno, os, socket, stat, struct, sys
root, mode = sys.argv[1:]
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
reference_fd = os.open(os.path.join(root, 'authorized'), flags)
sender_fd = os.open(os.path.join(root, 'authorized'), flags)
sender_a, receiver_a = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
sender_b, receiver_b = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
reads = 0
rejected_received_fds = []

def send(sender):
    # Both connections claim the same current session and target channel.
    # The A-side claim is deliberately forged in this isolated negative control.
    sender.sendmsg([b'SESSION_SHARED|CHANNEL_B'], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [sender_fd]))])

def receive(sock, expected_payload=b'SESSION_SHARED|CHANNEL_B'):
    creds = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))
    assert struct.unpack('3i', creds) == (os.getpid(), os.getuid(), os.getgid())
    payload, ancillary, msg_flags, _ = sock.recvmsg(64, socket.CMSG_SPACE(array.array('i').itemsize * 4), socket.MSG_CMSG_CLOEXEC)
    received = []
    admitted = False
    try:
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
        expected, actual = os.fstat(reference_fd), os.fstat(fd)
        assert stat.S_ISDIR(actual.st_mode)
        assert (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
        assert payload == expected_payload
        admitted = True
        return fd
    finally:
        if not admitted:
            # recvmsg already installed any received descriptors. Rejection
            # before returning ownership must close them in this process.
            if mode == 'rejected-frame-close':
                rejected_received_fds.extend(received)
            for fd in received:
                os.close(fd)

def read_synthetic(fd):
    global reads
    file_fd = os.open('synthetic.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        assert os.read(file_fd, 4096) == b'authorized-synthetic-only'
        reads += 1
    finally:
        os.close(file_fd)

try:
    assert receiver_a.fileno() != receiver_b.fileno()
    # Queue both frames before dispatch: no scheduler-dependent timing or sleeps.
    send(sender_a)
    send(sender_b)
    if mode == 'rejected-frame-close':
        # The receiver rejects after recvmsg installs the FD but before
        # ownership is returned to the caller. Verify close while alive.
        try:
            receive(receiver_a, b'OTHER_EXPECTED_SESSION')
        except AssertionError:
            assert reads == 0
            assert len(rejected_received_fds) == 1
            for fd in rejected_received_fds:
                try:
                    os.fstat(fd)
                except OSError as error:
                    assert error.errno == errno.EBADF
                else:
                    raise AssertionError('rejected frame leaked a received FD')
            print('REJECTED_FRAME_FD_CLOSED_BEFORE_RETURN', flush=True)
        else:
            raise AssertionError('invalid frame was accepted')
    else:
        chosen = receiver_b if mode == 'correct-route' else receiver_a
        fd = receive(chosen)
        try:
            if mode == 'wrong-route-unbound':
                # Peer, directory, session and *claimed* channel all pass.
                # A receiver that ignores its own socket routing reads wrong-channel data.
                assert chosen.fileno() != receiver_b.fileno()
                read_synthetic(fd)
                assert reads == 1
                print('FORGED_CHANNEL_CLAIM_UNBOUND_ACCEPTED', flush=True)
            elif mode == 'wrong-route-deny':
                # Compare receiver-owned channel identity, not a sender-supplied label.
                assert chosen.fileno() != receiver_b.fileno()
                assert reads == 0
                print('WRONG_SOCKET_REJECTED_BEFORE_READ', flush=True)
            elif mode == 'correct-route':
                assert chosen.fileno() == receiver_b.fileno()
                read_synthetic(fd)
                assert reads == 1
                print('CORRECT_SOCKET_ACCEPTED', flush=True)
            else:
                raise AssertionError('unknown mode')
        finally:
            os.close(fd)
finally:
    sender_a.close()
    receiver_a.close()
    sender_b.close()
    receiver_b.close()
    os.close(sender_fd)
    os.close(reference_fd)
`;

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function probe(mode: "wrong-route-unbound" | "wrong-route-deny" | "correct-route" | "rejected-frame-close"): void {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-scm-cross-connection-"));
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
      "wrong-route-unbound": "FORGED_CHANNEL_CLAIM_UNBOUND_ACCEPTED",
      "wrong-route-deny": "WRONG_SOCKET_REJECTED_BEFORE_READ",
      "correct-route": "CORRECT_SOCKET_ACCEPTED",
      "rejected-frame-close": "REJECTED_FRAME_FD_CLOSED_BEFORE_RETURN",
    }[mode];
    assert.equal(result.stdout, expected + "\n");
    assert.equal(readFileSync(join(root, "authorized", "synthetic.json"), "utf8"), "authorized-synthetic-only");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Forward Vault SCM_RIGHTS cross-connection routing (disposable Linux probe)", () => {
  it("shows a forged channel claim can pass peer/object/session checks on the wrong socket", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("wrong-route-unbound"); });
  it("rejects the wrong receiver-owned socket route before any payload read", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("wrong-route-deny"); });
  it("accepts the correct socket route with the same synthetic peer, FD and session", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("correct-route"); });
  it("closes an SCM_RIGHTS FD when frame admission throws before ownership handoff", {
    skip: !pythonAvailable, timeout: 20_000,
  }, () => { probe("rejected-frame-close"); });
});
