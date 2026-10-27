import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  closeSync, existsSync, fsyncSync, mkdtempSync, openSync,
  readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { verifyJsonReadback } from "./executorSdk.js";

// Disposable synthetic process fixture. This models the normal post-link,
// pre-unlink publication window; it is NOT the full SDK writer, an observed
// production race, crash recovery, or evidence of power-loss durability.
const childScript = [
  'const { linkSync, unlinkSync } = require("node:fs");',
  "const [temp, destination] = process.argv.slice(1);",
  "linkSync(temp, destination);",
  'process.stdout.write("LINKED\\n");',
  'process.stdin.once("data", () => { unlinkSync(temp); process.stdout.write("CLEANED\\n"); });',
].join("\n");

describe("Forward Vault readback during normal publication (disposable fixture)", () => {
  it("denies the two-link visibility window and accepts after the writer unlinks its temp name", {
    skip: process.platform === "win32",
    timeout: 20_000,
  }, async () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-readback-window-"));
    const temp = join(root, "staged-synthetic.json");
    const destination = join(root, "published-synthetic.json");
    const content = JSON.stringify({ recordId: "synthetic-only", version: 1 }) + "\n";
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, content, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    const child = spawn(process.execPath, ["-e", childScript, temp, destination], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
      child.once("error", reject);
    });
    const linked = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("LINKED handshake timed out")), 8_000);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes("LINKED\n")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("close", () => {
        clearTimeout(timer);
        reject(new Error("writer exited before LINKED handshake: " + stderr));
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    try {
      await linked;
      assert.equal(statSync(temp).ino, statSync(destination).ino);
      assert.equal(statSync(destination).nlink, 2);
      assert.equal(readFileSync(destination, "utf8"), content);

      // The destination is fully visible, but strict single-link readback
      // intentionally fails closed while the normal writer is paused.
      const during = verifyJsonReadback(destination);
      assert.equal(during.ok, false);
      assert.match(during.errors.join(" "), /single-link regular file/u);

      child.stdin.end("CONTINUE\n");
      assert.deepEqual(await completed, { code: 0, signal: null });
      assert.equal(stdout, "LINKED\nCLEANED\n");
      assert.equal(stderr, "");
      assert.equal(existsSync(temp), false);
      assert.equal(statSync(destination).nlink, 1);
      assert.equal(readFileSync(destination, "utf8"), content);
      assert.equal(verifyJsonReadback(destination).ok, true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await completed.catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
