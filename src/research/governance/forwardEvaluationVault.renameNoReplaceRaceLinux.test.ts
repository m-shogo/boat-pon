import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { verifyJsonReadback } from "./executorSdk.js";

// Disposable Linux-only native syscall probe. Neither the SDK writer nor any
// production, recovery, or scoring path invokes this candidate implementation.
const pythonRace = [
  "import ctypes, errno, os, sys",
  "libc = ctypes.CDLL(None, use_errno=True)",
  "fn = getattr(libc, 'renameat2', None)",
  "if fn is None: print('RESULT:UNSUPPORTED', flush=True); sys.exit(77)",
  "fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
  "fn.restype = ctypes.c_int",
  "print('READY', flush=True)",
  "if sys.stdin.readline().strip() != 'GO': sys.exit(76)",
  "rc = fn(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 1)",
  "if rc == 0:",
  "    print('RESULT:WON', flush=True)",
  "    if sys.stdin.readline().strip() != 'DONE': sys.exit(76)",
  "    sys.exit(0)",
  "err = ctypes.get_errno()",
  "if err == errno.EEXIST: print('RESULT:LOST', flush=True); sys.exit(17)",
  "if err in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL): print('RESULT:UNSUPPORTED', flush=True); sys.exit(77)",
  "raise OSError(err, os.strerror(err))",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(root: string, name: string, content: string): string {
  const path = join(root, name);
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
  return path;
}

function launch(source: string, destination: string) {
  const child = spawn("python3", ["-u", "-c", pythonRace, source, destination], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  let closed = false;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); notify(); });
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); notify(); });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("close", (code, signal) => { closed = true; notify(); resolve({ code, signal }); });
    child.once("error", (error) => { closed = true; notify(); reject(error); });
  });
  const waitFor = (marker: string | RegExp) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      listeners.delete(check);
      reject(new Error("timeout waiting for " + marker + ": " + output + " " + errors));
    }, 8_000);
    function check() {
      if (typeof marker === "string" ? output.includes(marker) : marker.test(output)) { clearTimeout(timer); listeners.delete(check); resolve(); }
      else if (closed) {
        clearTimeout(timer); listeners.delete(check);
        reject(new Error("child exited before " + marker + ": " + output + " " + errors));
      }
    }
    listeners.add(check);
    check();
  });
  return { child, completed, waitFor, output: () => output, errors: () => errors };
}

describe("Forward Vault Linux renameat2 two-writer/reader race (disposable probe)", () => {
  it("admits one publisher, preserves the losing stage, and allows strict readback while winner is paused", {
    skip: !pythonAvailable,
    timeout: 20_000,
  }, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-rename-race-"));
    const destination = join(root, "published.json");
    const contents = [0, 1].map((writer) => JSON.stringify({ recordId: "synthetic-only", writer }) + "\n");
    const sources = contents.map((value, writer) => stage(root, "staged-" + writer + ".json", value));
    const contenders = sources.map((source) => launch(source, destination));
    try {
      await Promise.all(contenders.map((contender) => contender.waitFor("READY\n")));
      assert.equal(existsSync(destination), false);
      for (const contender of contenders) contender.child.stdin.write("GO\n");
      // A stdout chunk can end between RESULT:LOST and its newline. Wait for
      // a complete outcome line before comparing exact outputs.
      await Promise.all(contenders.map((contender) => contender.waitFor(/RESULT:(?:WON|LOST|UNSUPPORTED)\n/u)));
      const outcomes = contenders.map((contender) => contender.output());
      if (outcomes.some((output) => output.includes("RESULT:UNSUPPORTED"))) {
        t.skip("renameat2 RENAME_NOREPLACE unsupported on this runner/filesystem");
        return;
      }
      const winner = outcomes.findIndex((output) => output === "READY\nRESULT:WON\n");
      const loser = outcomes.findIndex((output) => output === "READY\nRESULT:LOST\n");
      assert.notEqual(winner, -1, JSON.stringify(outcomes));
      assert.notEqual(loser, -1, JSON.stringify(outcomes));
      assert.notEqual(winner, loser);
      assert.deepEqual(await contenders[loser]!.completed, { code: 17, signal: null });
      assert.equal(contenders[winner]!.child.exitCode, null);
      assert.equal(readFileSync(destination, "utf8"), contents[winner]);
      assert.equal(statSync(destination).nlink, 1);
      assert.equal(verifyJsonReadback(destination).ok, true);
      assert.equal(existsSync(sources[winner]!), false);
      assert.equal(existsSync(sources[loser]!), true);
      assert.equal(readFileSync(sources[loser]!, "utf8"), contents[loser]);
      assert.deepEqual(contenders.map((contender) => contender.errors()), ["", ""]);

      // EEXIST does not authorize deletion by a stale filename. The losing
      // staged file remains intact until the disposable test directory teardown.
      contenders[winner]!.child.stdin.end("DONE\n");
      assert.deepEqual(await contenders[winner]!.completed, { code: 0, signal: null });
      assert.equal(verifyJsonReadback(destination).ok, true);
    } finally {
      for (const contender of contenders) {
        if (contender.child.exitCode === null && contender.child.signalCode === null) contender.child.kill("SIGKILL");
      }
      await Promise.allSettled(contenders.map((contender) => contender.completed));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
