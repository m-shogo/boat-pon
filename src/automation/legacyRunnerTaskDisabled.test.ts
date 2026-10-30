import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());
const runner = resolve(root, "scripts/run-research-task.ts");

test("deprecated request-file task mode exits before request parsing or any executor path", () => {
  const source = readFileSync(runner, "utf8");
  const taskGate = source.indexOf('if (mode === "task") {');
  const requestParse = source.indexOf('const requestPath = arg("request");');
  const policyRead = source.indexOf("const policy = JSON.parse(");
  const lock = source.indexOf('if (!acquireLock(');
  const executor = source.indexOf('const { executor, code } = resolveExecutor(');

  assert.ok(taskGate >= 0 && policyRead > taskGate && requestParse > policyRead);
  const preRequestGate = source.slice(taskGate, requestParse);
  assert.match(preRequestGate, /DEPRECATED_DISABLED/u);
  assert.ok(preRequestGate.includes("process.exit(3);"));
  assert.ok(lock > requestParse);
  assert.ok(executor > lock);
});

test("deprecated task invocation without a request fails closed with exit 3", () => {
  // No request, queue mutation, workflow dispatch, private evidence or N2 executor.
  // If the guard regresses, the missing-request path fails before preflight.
  const child = spawnSync(process.execPath, ["--import", "tsx", runner, "task"], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 3, child.stderr);
  assert.match(child.stderr, /DEPRECATED_DISABLED: request-file task execution is disabled/u);
  assert.ok(!child.stderr.includes("--request=<request.json>"));
});

test("unknown legacy modes are denied before parsing a request or reaching an executor", () => {
  const source = readFileSync(runner, "utf8");
  const taskGate = source.indexOf('if (mode === "task") {');
  const unknownGate = source.indexOf('if (mode !== "validate-request" &&');
  const requestParse = source.indexOf('const requestPath = arg("request");');
  assert.ok(taskGate >= 0 && unknownGate > taskGate && policyRead > unknownGate && requestParse > policyRead);
  const preRequestGate = source.slice(unknownGate, requestParse);
  assert.ok(preRequestGate.includes("UNSUPPORTED_MODE"));
  assert.ok(preRequestGate.includes("process.exit(3);"));

  // An intentionally absent synthetic request path means a regression cannot
  // reach preflight, queue state, executor or protected research data.
  for (const mode of ["run-task", "execute", "TASK"]) {
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", runner, mode, "--request=__synthetic_missing_legacy_request__.json"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, NODE_OPTIONS: "" },
      },
    );
    assert.equal(child.error, undefined, mode);
    assert.equal(child.status, 3, `${mode}: ${child.stderr}`);
    assert.match(child.stderr, /UNSUPPORTED_MODE: only validate-request may parse a legacy request file/u);
    assert.ok(!child.stderr.includes("ENOENT"), mode);
  }
});

test("deprecated and unknown modes reject without any legacy policy or request file", () => {
  // A synthetic empty workspace proves that denial precedes even policy I/O.
  // Do not provide a valid request, task queue, executor data, or N2 inputs.
  const isolated = mkdtempSync(join(tmpdir(), "boat-pon-legacy-deny-"));
  try {
    const loader = import.meta.resolve("tsx");
    for (const mode of ["task", "run-task", "execute"]) {
      const child = spawnSync(
        process.execPath,
        ["--import", loader, runner, mode, "--request=__synthetic_missing_request__.json"],
        {
          cwd: isolated, encoding: "utf8", timeout: 15_000,
          env: { ...process.env, NODE_OPTIONS: "" },
        },
      );
      assert.equal(child.error, undefined, mode);
      assert.equal(child.status, 3, `${mode}: ${child.stderr}`);
      assert.match(child.stderr, mode === "task" ? /DEPRECATED_DISABLED/u : /UNSUPPORTED_MODE/u);
      assert.ok(!child.stderr.includes("ENOENT"), mode);
    }
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});
