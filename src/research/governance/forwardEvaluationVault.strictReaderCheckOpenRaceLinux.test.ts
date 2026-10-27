import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { verifyJsonReadback } from "./executorSdk.js";

// Disposable research-only Linux interleaving. The Python child mirrors the
// SDK's real-ancestor preflight followed by O_NOFOLLOW on the final component.
// It does NOT hook the SDK between those operations or modify its behavior.
// A pinned FD supplies an independent same-object comparison.
const pythonReader = [
  "import os, stat, sys",
  "root, mode, original, decoy = sys.argv[1:]",
  "flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW",
  "root_fd = os.open(root, flags)",
  "try:",
  "    anchor_fd = os.open('anchor', flags, dir_fd=root_fd)",
  "    try:",
  "        vault_fd = os.open('vault', flags, dir_fd=anchor_fd)",
  "        try:",
  "            path = os.path.join(root, 'anchor', 'vault', 'published.json')",
  "            for parent in [root, os.path.join(root, 'anchor'), os.path.join(root, 'anchor', 'vault')]:",
  "                st = os.lstat(parent)",
  "                assert stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode)",
  "            print('ANCESTORS_CHECKED', flush=True)",
  "            if sys.stdin.readline().strip() != 'OPEN': sys.exit(76)",
  "            path_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)",
  "            try:",
  "                path_stat = os.fstat(path_fd)",
  "                assert stat.S_ISREG(path_stat.st_mode) and path_stat.st_nlink == 1",
  "                path_bytes = os.read(path_fd, 4096)",
  "            finally: os.close(path_fd)",
  "            pinned_fd = os.open('published.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=vault_fd)",
  "            try:",
  "                pinned_stat = os.fstat(pinned_fd)",
  "                assert stat.S_ISREG(pinned_stat.st_mode) and pinned_stat.st_nlink == 1",
  "                pinned_bytes = os.read(pinned_fd, 4096)",
  "            finally: os.close(pinned_fd)",
  "            assert pinned_bytes == original.encode('utf-8')",
  "            assert path_bytes == (decoy if mode == 'swap' else original).encode('utf-8')",
  "            print('PATH_DECOY_PINNED_ORIGINAL' if mode == 'swap' else 'PATH_AND_PINNED_ORIGINAL', flush=True)",
  "        finally: os.close(vault_fd)",
  "    finally: os.close(anchor_fd)",
  "finally: os.close(root_fd)",
].join("\n");

const pythonAvailable = process.platform === "linux" &&
  spawnSync("python3", [
    "-c", "import os,sys; sys.exit(0 if hasattr(os, 'O_NOFOLLOW') and hasattr(os, 'O_DIRECTORY') else 1)",
  ], { encoding: "utf8", timeout: 5_000 }).status === 0;

function stage(path: string, content: string): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); }
  finally { closeSync(fd); }
}

async function runInterleaving(swap: boolean): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "forward-vault-read-check-open-"));
  const anchorVault = join(root, "anchor", "vault");
  const decoyVault = join(root, "decoy", "vault");
  const original = '{"recordId":"synthetic-only","writer":"original","outputDigest":"synthetic-declared"}\n';
  const decoy = '{"recordId":"synthetic-only","writer":"decoy","outputDigest":"synthetic-declared"}\n';
  mkdirSync(anchorVault, { recursive: true });
  mkdirSync(decoyVault, { recursive: true });
  stage(join(anchorVault, "published.json"), original);
  stage(join(decoyVault, "published.json"), decoy);

  const child = spawn("python3", ["-u", "-c", pythonReader, root, swap ? "swap" : "control", original, decoy], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let closed = false;
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("close", (code, signal) => { closed = true; resolve({ code, signal }); });
    child.once("error", (error) => { closed = true; reject(error); });
  });
  const waitForLine = (line: string) => new Promise<void>((resolve, reject) => {
    const observed = () => stdout.split("\n").includes(line);
    if (observed()) { resolve(); return; }
    if (closed) { reject(new Error("reader closed before " + line + ": " + stdout + stderr)); return; }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout waiting for complete line " + line + ": " + stdout + stderr));
    }, 8_000);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
    };
    const onData = () => { if (observed()) { cleanup(); resolve(); } };
    const onClose = () => { cleanup(); reject(new Error("reader closed before " + line + ": " + stdout + stderr)); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    child.stdout.on("data", onData);
    child.once("close", onClose);
    child.once("error", onError);
  });

  try {
    await waitForLine("ANCESTORS_CHECKED");
    if (swap) {
      // The entire ancestor check finished before either real-directory rename.
      // The pathname then resolves to an unrelated, structurally valid file.
      renameSync(join(root, "anchor"), join(root, "moved"));
      renameSync(join(root, "decoy"), join(root, "anchor"));
      assert.equal(lstatSync(join(root, "anchor")).isDirectory(), true);
      assert.equal(lstatSync(join(root, "anchor")).isSymbolicLink(), false);
    }
    child.stdin.end("OPEN\n");
    const result = await completed;
    assert.deepEqual(result, { code: 0, signal: null }, stderr + stdout);
    assert.equal(stderr, "");
    assert.equal(stdout,
      swap ? "ANCESTORS_CHECKED\nPATH_DECOY_PINNED_ORIGINAL\n"
        : "ANCESTORS_CHECKED\nPATH_AND_PINNED_ORIGINAL\n");

    const canonical = join(root, "anchor", "vault", "published.json");
    const originalPath = swap ? join(root, "moved", "vault", "published.json") : canonical;
    assert.equal(readFileSync(originalPath, "utf8"), original);
    assert.equal(readFileSync(canonical, "utf8"), swap ? decoy : original);
    assert.equal(statSync(originalPath).nlink, 1);
    assert.equal(statSync(canonical).nlink, 1);
    // A fresh SDK invocation after the swap accepts valid decoy JSON.
    // This does not claim an instrumented SDK call was paused mid-read.
    assert.equal(verifyJsonReadback(canonical, "synthetic-declared").ok, true);
    assert.equal(verifyJsonReadback(originalPath, "synthetic-declared").ok, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await completed.catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("Forward Vault strict reader check-to-open interleaving (disposable Linux negative fixture)", () => {
  it("keeps original pathname and pinned object aligned without a swap", {
    skip: !pythonAvailable, timeout: 20_000,
  }, async () => { await runInterleaving(false); });

  it("redirects the pathname after completed real-ancestor checks but before O_NOFOLLOW open", {
    skip: !pythonAvailable, timeout: 20_000,
  }, async () => { await runInterleaving(true); });
});
