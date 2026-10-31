import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { atomicWriteJson, verifyJsonReadback } from "./executorSdk.js";
import { isolatedForwardVaultNodeChildEnv } from "./forwardEvaluationVault.nodeChildEnv.js";

describe("Forward Vault post-link process-termination boundary (disposable fixture)", () => {
  it("preserves published bytes but refuses orphan-hardlink readback after SIGKILL", { skip: process.platform === "win32", timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-kill-"));
    const destination = join(root, "synthetic-record.json");
    const temp = join(root, "synthetic-record.json.tmp-child");
    const value = { recordId: "synthetic-only", protocolVersion: "v1" };
    const content = JSON.stringify(value) + "\n";

    // The child holds precisely the post-link/pre-unlink boundary. Its
    // stdout handshake is emitted only after the link is published.
    // This tests process termination, NOT power loss or concurrent cleanup.
    const childScript = [
      'const { openSync, writeFileSync, fsyncSync, closeSync, linkSync } = require("node:fs");',
      "const [temp, destination, content] = process.argv.slice(1);",
      'const fd = openSync(temp, "wx", 0o600);',
      'try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }',
      "linkSync(temp, destination);",
      'process.stdout.write("LINKED\\n", () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0));',
    ].join("\n");
    const child = spawn(process.execPath, ["-e", childScript, temp, destination, content], {
      env: isolatedForwardVaultNodeChildEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    });
    let closed = false;
    child.once("close", () => { closed = true; });
    const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("close", (code, signal) => resolve({ code, signal }));
      child.once("error", reject);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => reject(new Error("child link handshake timed out")), 8_000);
        child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
          if (stdout.includes("LINKED\n")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("close", () => {
          clearTimeout(timer);
          reject(new Error("child closed before link handshake: " + stderr));
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      assert.equal(statSync(destination).nlink, 2);
      assert.equal(statSync(temp).ino, statSync(destination).ino);
      assert.equal(child.kill("SIGKILL"), true);
      const ended = await completion;
      assert.equal(ended.signal, "SIGKILL");
      assert.equal(ended.code, null);

      assert.equal(readFileSync(destination, "utf8"), content);
      assert.equal(statSync(destination).nlink, 2);
      const readback = verifyJsonReadback(destination);
      assert.equal(readback.ok, false);
      assert.match(readback.errors.join(" "), /single-link regular file/u);
      assert.throws(() => atomicWriteJson(destination, value), /target already exists/u);
      assert.equal(readFileSync(destination, "utf8"), content);
      // Deliberately no orphan cleanup or readback relaxation.
    } finally {
      if (!closed) child.kill("SIGKILL");
      await completion.catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
