import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { retainExecutorOutputs } from "./researchRetainedOutputs";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "retained-output-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function put(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

test("mutable report gets an immutable content-addressed history path", () => {
  withRoot((root) => {
    const source = "reports/n2/example.json";
    const content = JSON.stringify({ outputDigest: "a".repeat(64), value: 1 }) + "\n";
    put(root, source, content);
    const result = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [source] });
    assert.equal(result.retainedOutputs.length, 1);
    assert.match(result.historyOutputs[0] ?? "", /^reports\/automation\/retained-outputs\/12345\/[0-9a-f]{64}-example\.json$/u);
    assert.equal(readFileSync(join(root, result.historyOutputs[0] ?? ""), "utf8"), content);
  });
});

test("same run and same content is idempotent", () => {
  withRoot((root) => {
    const source = "reports/n2/example.json";
    put(root, source, JSON.stringify({ outputDigest: "b".repeat(64) }) + "\n");
    const first = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [source] });
    const second = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [source] });
    assert.deepEqual(second.historyOutputs, first.historyOutputs);
    assert.equal(first.retainedOutputs[0]?.changed, true);
    assert.equal(second.retainedOutputs[0]?.changed, false);
  });
});

test("registry output passes through unchanged", () => {
  withRoot((root) => {
    const source = "research/registries/experiments/EXP-1.json";
    put(root, source, JSON.stringify({ _digest: "c".repeat(64) }) + "\n");
    const result = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [source] });
    assert.deepEqual(result.historyOutputs, [source]);
    assert.deepEqual(result.retainedOutputs, []);
  });
});

test("automation control output is retained", () => {
  withRoot((root) => {
    const source = "automation/control/planner-candidates.json";
    put(root, source, JSON.stringify({ planner: "v1" }) + "\n");
    const result = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [source] });
    assert.match(result.historyOutputs[0] ?? "", /^reports\/automation\/retained-outputs\/12345\/[0-9a-f]{64}-planner-candidates\.json$/u);
  });
});
