import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { verifyJsonReadback } from "./executorSdk.js";
import { isolatedForwardVaultNodeChildEnv } from "./forwardEvaluationVault.nodeChildEnv.js";

// Disposable synthetic harness of the SDK's linkSync no-replace publication
// boundary. This is NOT an SDK writer invocation, native renameat2 probe,
// crash-consistency proof, or authorization for automatic orphan cleanup.
const childScript = [
  'const { linkSync, unlinkSync } = require("node:fs");',
  "const [temp, destination] = process.argv.slice(1);",
  'process.stdout.write("READY\\n");',
  'process.stdin.once("data", () => {',
  '  try { linkSync(temp, destination); process.stdout.write("WON\\n"); }',
  '  catch (error) { if (error && error.code === "EEXIST") process.stdout.write("LOST\\n"); else { process.stderr.write(String(error)); process.exitCode = 2; } }',
  '  finally { unlinkSync(temp); }',
  '});',
].join("\n");

function launchContender(temp: string, destination: string) {
  const child = spawn(process.execPath, ["-e", childScript, temp, destination], {
    env: isolatedForwardVaultNodeChildEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let sawReady = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("close", (code, signal) => {
      if (!sawReady) rejectReady(new Error("contender closed before READY: " + stderr));
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      rejectReady(error);
      reject(error);
    });
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    if (!sawReady && stdout.includes("READY\n")) {
      sawReady = true;
      resolveReady();
    }
  });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  return { child, ready, completed, output: () => stdout, errorOutput: () => stderr };
}

describe("Forward Vault concurrent no-replace publication (disposable fixture)", () => {
  it("publishes exactly one complete record across two competing processes", {
    skip: process.platform === "win32",
    timeout: 20_000,
  }, async () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-contenders-"));
    const destination = join(root, "synthetic-record.json");
    const candidates: Array<{ temp: string; value: { recordId: string; writer: number }; content: string }> = [];
    const contenders: ReturnType<typeof launchContender>[] = [];
    try {
      for (let writer = 0; writer < 2; writer += 1) {
        const temp = join(root, `staged-${writer}.json`);
        const value = { recordId: "synthetic-only", writer };
        const content = JSON.stringify(value) + "\n";
        const fd = openSync(temp, "wx", 0o600);
        try {
          writeFileSync(fd, content, "utf8");
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        candidates.push({ temp, value, content });
      }

      for (const candidate of candidates) {
        contenders.push(launchContender(candidate.temp, destination));
      }
      // Both children must reach the barrier before either may publish.
      await Promise.all(contenders.map((contender) => contender.ready));
      assert.equal(existsSync(destination), false);
      for (const contender of contenders) contender.child.stdin.end("GO\n");

      const exits = await Promise.all(contenders.map((contender) => contender.completed));
      assert.deepEqual(exits.map((exit) => exit.code), [0, 0]);
      assert.deepEqual(exits.map((exit) => exit.signal), [null, null]);
      const outputs = contenders.map((contender) => contender.output());
      assert.equal(outputs.filter((output) => output === "READY\nWON\n").length, 1);
      assert.equal(outputs.filter((output) => output === "READY\nLOST\n").length, 1);
      assert.deepEqual(contenders.map((contender) => contender.errorOutput()), ["", ""]);

      const winnerIndex = outputs.findIndex((output) => output.includes("WON\n"));
      assert.equal(readFileSync(destination, "utf8"), candidates[winnerIndex]!.content);
      assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), candidates[winnerIndex]!.value);
      assert.equal(statSync(destination).nlink, 1);
      assert.equal(verifyJsonReadback(destination).ok, true);
      for (const candidate of candidates) assert.equal(existsSync(candidate.temp), false);
    } finally {
      for (const contender of contenders) {
        if (contender.child.exitCode === null && contender.child.signalCode === null) {
          contender.child.kill("SIGKILL");
        }
      }
      await Promise.allSettled(contenders.map((contender) => contender.completed));
      rmSync(root, { recursive: true, force: true });
    }
  });
});
