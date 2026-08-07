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

test("mutable report gets a content-addressed history path and is idempotent", () => {
  withRoot((root) => {
    const source = "reports/n2/example.json";
    const content = JSON.stringify({ outputDigest: "a".repeat(64), value: 1 }) + "\n";
    put(root, source, content);
    const first = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [source] });
    const second = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [source] });
    assert.match(first.historyOutputs[0] ?? "", /^reports\/automation\/retained-outputs\/12345\/[0-9a-f]{64}-example\.json$/u);
    assert.equal(readFileSync(join(root, first.historyOutputs[0] ?? ""), "utf8"), content);
    assert.equal(first.retainedOutputs[0]?.changed, true);
    assert.equal(second.retainedOutputs[0]?.changed, false);
    assert.deepEqual(second.historyOutputs, first.historyOutputs);
  });
});

test("registry stays append-only original while control output is retained", () => {
  withRoot((root) => {
    const registry = "research/registries/experiments/EXP-1.json";
    const control = "automation/control/planner-candidates.json";
    put(root, registry, JSON.stringify({ _digest: "b".repeat(64) }) + "\n");
    put(root, control, JSON.stringify({ planner: "v1" }) + "\n");
    const result = retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [registry, control] });
    assert.equal(result.historyOutputs[0], registry);
    assert.match(result.historyOutputs[1] ?? "", /^reports\/automation\/retained-outputs\/12345\/[0-9a-f]{64}-planner-candidates\.json$/u);
    assert.equal(result.retainedOutputs.length, 1);
  });
});

test("unknown output root fails closed", () => {
  withRoot((root) => {
    put(root, "tmp/output.json", "{}\n");
    assert.throws(
      () => retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: ["tmp/output.json"] }),
      /RETAINED_OUTPUT_SOURCE_NOT_ALLOWED/u,
    );
  });
});
