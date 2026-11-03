import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isolatedForwardVaultNodeChildEnv } from "./forwardEvaluationVault.nodeChildEnv.js";

describe("Forward Vault synthetic Node child environment isolation", () => {
  it("blocks inherited NODE_OPTIONS preload without altering the source environment", {
    skip: process.platform === "win32",
    timeout: 10_000,
  }, () => {
    const root = mkdtempSync(join(tmpdir(), "forward-vault-node-child-env-"));
    try {
      const preload = join(root, "preload.cjs");
      writeFileSync(preload, "process.stdout.write('PRELOAD\\n');\n", "utf8");
      const injected = { ...process.env, NODE_OPTIONS: "--require=" + preload };
      const args = ["-e", "process.stdout.write('CHILD\\n');"];
      const control = spawnSync(process.execPath, args, {
        env: injected, encoding: "utf8", timeout: 5_000,
      });
      assert.equal(control.status, 0, control.stderr);
      assert.equal(control.stdout, "PRELOAD\nCHILD\n");

      const childEnv = isolatedForwardVaultNodeChildEnv(injected);
      assert.equal(Object.hasOwn(childEnv, "NODE_OPTIONS"), false);
      assert.equal(injected.NODE_OPTIONS, "--require=" + preload);
      const isolated = spawnSync(process.execPath, args, {
        env: childEnv, encoding: "utf8", timeout: 5_000,
      });
      assert.equal(isolated.status, 0, isolated.stderr);
      assert.equal(isolated.stdout, "CHILD\n");
      assert.equal(isolated.stderr, "");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
