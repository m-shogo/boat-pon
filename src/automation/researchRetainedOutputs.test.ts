import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("all mutable sources are validated before any retained file is created", () => {
  withRoot((root) => {
    const good = "reports/n2/good.json";
    const missing = "reports/n2/missing.json";
    put(root, good, JSON.stringify({ outputDigest: "d".repeat(64) }) + "\n");
    assert.throws(
      () => retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [good, missing] }),
      /RETAINED_OUTPUT_SOURCE_MISSING/u,
    );
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("different sources converging to the same retained target are deduplicated", () => {
  withRoot((root) => {
    const a = "reports/n2/example.json";
    const b = "reports/automation/example.json";
    const content = JSON.stringify({ outputDigest: "e".repeat(64), value: "same" }) + "\n";
    put(root, a, content);
    put(root, b, content);
    const result = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [a, b] });
    assert.equal(result.historyOutputs.length, 1);
    assert.equal(result.retainedOutputs.length, 1);
    assert.match(result.historyOutputs[0] ?? "", /^reports\/automation\/retained-outputs\/12345\/[0-9a-f]{64}-example\.json$/u);
  });
});

test("unique executor output path count is bounded before filesystem reads", () => {
  withRoot((root) => {
    const outputs = Array.from({ length: 65 }, (_, index) => `reports/n2/out-${index}.json`);
    assert.throws(
      () => retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: outputs }),
      /RETAINED_OUTPUT_COUNT_EXCEEDED:65>64/u,
    );
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("duplicate source paths do not consume the output-count budget twice", () => {
  withRoot((root) => {
    const source = "reports/n2/example.json";
    put(root, source, JSON.stringify({ outputDigest: "f".repeat(64) }) + "\n");
    const result = retainExecutorOutputs({
      repoRoot: root,
      runId: "12345",
      outputPaths: Array.from({ length: 100 }, () => source),
    });
    assert.equal(result.historyOutputs.length, 1);
  });
});

test("aggregate retained byte budget is checked before materialization", () => {
  withRoot((root) => {
    const outputs: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const source = `reports/n2/large-${index}.txt`;
      put(root, source, `${String(index)}${"x".repeat(1_799_999)}`);
      outputs.push(source);
    }
    assert.throws(
      () => retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: outputs }),
      /RETAINED_OUTPUT_TOTAL_BYTES_EXCEEDED/u,
    );
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});
