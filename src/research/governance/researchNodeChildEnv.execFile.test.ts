import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isolatedResearchNodeChildEnv } from "./researchNodeChildEnv.js";

test("research execFileSync fixtures reject ambient NODE_OPTIONS preload", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, () => {
  const root = mkdtempSync(join(tmpdir(), "research-node-child-env-"));
  try {
    const preload = join(root, "preload.cjs");
    writeFileSync(preload, "process.stdout.write('PRELOAD\\n');\n", "utf8");
    const injected = { ...process.env, NODE_OPTIONS: "--require=" + preload };
    const args = ["-e", "process.stdout.write('CHILD\\n');"];
    const control = execFileSync(process.execPath, args, {
      env: injected, encoding: "utf8", timeout: 5_000,
    });
    assert.equal(control, "PRELOAD\nCHILD\n");

    const isolated = isolatedResearchNodeChildEnv(injected);
    assert.equal(Object.hasOwn(isolated, "NODE_OPTIONS"), false);
    assert.equal(injected.NODE_OPTIONS, "--require=" + preload);
    assert.equal(execFileSync(process.execPath, args, {
      env: isolated, encoding: "utf8", timeout: 5_000,
    }), "CHILD\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

