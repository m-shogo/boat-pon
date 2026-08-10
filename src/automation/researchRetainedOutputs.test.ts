import assert from "node:assert/strict";
import { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function retain(root: string, outputPaths: string[], historyOutputDigest = "0".repeat(64)) {
  return retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths, historyOutputDigest });
}

test("mutable report gets an immutable content-addressed history path", () => {
  withRoot((root) => {
    const source = "reports/n2/example.json";
    const digest = "a".repeat(64);
    const content = JSON.stringify({ outputDigest: digest, value: 1 }) + "\n";
    put(root, source, content);
    const result = retain(root, [source], digest);
    assert.equal(result.retainedOutputs.length, 1);
    assert.match(result.historyOutputs[0] ?? "", /^reports\/automation\/retained-outputs\/12345\/[0-9a-f]{64}-example\.json$/u);
    assert.equal(readFileSync(join(root, result.historyOutputs[0] ?? ""), "utf8"), content);
  });
});

test("same run and same content is idempotent", () => {
  withRoot((root) => {
    const source = "reports/n2/example.json";
    const digest = "b".repeat(64);
    put(root, source, JSON.stringify({ outputDigest: digest }) + "\n");
    const first = retain(root, [source], digest);
    const second = retain(root, [source], digest);
    assert.deepEqual(second.historyOutputs, first.historyOutputs);
    assert.equal(first.retainedOutputs[0]?.changed, true);
    assert.equal(second.retainedOutputs[0]?.changed, false);
  });
});

test("registry output passes through unchanged", () => {
  withRoot((root) => {
    const source = "research/registries/experiments/EXP-1.json";
    put(root, source, JSON.stringify({ _digest: "c".repeat(64) }) + "\n");
    const result = retain(root, [source]);
    assert.deepEqual(result.historyOutputs, [source]);
    assert.deepEqual(result.retainedOutputs, []);
  });
});

test("automation control JSON without embedded outputDigest is retained", () => {
  withRoot((root) => {
    const source = "automation/control/planner-candidates.json";
    put(root, source, JSON.stringify({ planner: "v1" }) + "\n");
    const result = retain(root, [source]);
    assert.match(result.historyOutputs[0] ?? "", /^reports\/automation\/retained-outputs\/12345\/[0-9a-f]{64}-planner-candidates\.json$/u);
  });
});

test("all mutable sources are validated before any retained file is created", () => {
  withRoot((root) => {
    const good = "reports/n2/good.json";
    const missing = "reports/n2/missing.json";
    const digest = "d".repeat(64);
    put(root, good, JSON.stringify({ outputDigest: digest }) + "\n");
    assert.throws(
      () => retain(root, [good, missing], digest),
      /RETAINED_OUTPUT_SOURCE_MISSING/u,
    );
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("mutable retained sources reject symlinks and hardlinks", () => {
  withRoot((root) => {
    const real = "reports/n2/real.json";
    const symlink = "reports/n2/symlink.json";
    const hardlink = "reports/n2/hardlink.json";
    const content = JSON.stringify({ value: 1 }) + "\n";
    put(root, real, content);
    symlinkSync(join(root, real), join(root, symlink));
    assert.throws(() => retain(root, [symlink]), /RETAINED_OUTPUT_SOURCE_FILE_TYPE_INVALID/u);

    linkSync(join(root, real), join(root, hardlink));
    assert.throws(() => retain(root, [hardlink]), /RETAINED_OUTPUT_SOURCE_FILE_TYPE_INVALID/u);
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("mutable retained sources reject symlinked parent directories", () => {
  withRoot((root) => {
    const outside = mkdtempSync(join(tmpdir(), "retained-output-outside-"));
    try {
      writeFileSync(join(outside, "escaped.json"), JSON.stringify({ value: "outside" }) + "\n", "utf8");
      mkdirSync(join(root, "reports"), { recursive: true });
      symlinkSync(outside, join(root, "reports/n2"), "dir");

      assert.throws(
        () => retain(root, ["reports/n2/escaped.json"]),
        /RETAINED_OUTPUT_SOURCE_PATH_ALIAS/u,
      );
      assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("retained targets reject symlinked parent directories before materialization", () => {
  withRoot((root) => {
    const outside = mkdtempSync(join(tmpdir(), "retained-target-outside-"));
    try {
      const source = "reports/n2/target-parent.json";
      put(root, source, JSON.stringify({ value: "inside" }) + "\n");
      symlinkSync(outside, join(root, "reports/automation"), "dir");

      assert.throws(
        () => retain(root, [source]),
        /RETAINED_OUTPUT_TARGET_PATH_ALIAS/u,
      );
      assert.equal(existsSync(join(outside, "retained-outputs")), false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("existing retained targets reject symlink and hardlink aliases", () => {
  withRoot((root) => {
    const source = "reports/n2/existing.json";
    const digest = "7".repeat(64);
    const content = JSON.stringify({ outputDigest: digest, value: "stable" }) + "\n";
    put(root, source, content);
    const first = retain(root, [source], digest);
    const retained = join(root, first.historyOutputs[0] ?? "");

    rmSync(retained);
    symlinkSync(join(root, source), retained);
    assert.throws(() => retain(root, [source], digest), /RETAINED_OUTPUT_EXISTING_FILE_TYPE_INVALID/u);

    rmSync(retained);
    const decoy = "reports/n2/existing-decoy.json";
    put(root, decoy, content);
    linkSync(join(root, decoy), retained);
    assert.throws(() => retain(root, [source], digest), /RETAINED_OUTPUT_EXISTING_FILE_TYPE_INVALID/u);
  });
});

test("different sources converging to the same retained target are deduplicated", () => {
  withRoot((root) => {
    const a = "reports/n2/example.json";
    const b = "reports/automation/example.json";
    const digest = "e".repeat(64);
    const content = JSON.stringify({ outputDigest: digest, value: "same" }) + "\n";
    put(root, a, content);
    put(root, b, content);
    const result = retain(root, [a, b], digest);
    assert.equal(result.historyOutputs.length, 1);
    assert.equal(result.retainedOutputs.length, 1);
    assert.match(result.historyOutputs[0] ?? "", /^reports\/automation\/retained-outputs\/12345\/[0-9a-f]{64}-example\.json$/u);
  });
});

test("unique executor output path count is bounded before filesystem reads", () => {
  withRoot((root) => {
    const outputs = Array.from({ length: 65 }, (_, index) => `reports/n2/out-${index}.json`);
    assert.throws(
      () => retain(root, outputs),
      /RETAINED_OUTPUT_COUNT_EXCEEDED:65>64/u,
    );
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("duplicate source paths do not consume the output-count budget twice", () => {
  withRoot((root) => {
    const source = "reports/n2/example.json";
    const digest = "f".repeat(64);
    put(root, source, JSON.stringify({ outputDigest: digest }) + "\n");
    const result = retain(root, Array.from({ length: 100 }, () => source), digest);
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
      () => retain(root, outputs),
      /RETAINED_OUTPUT_TOTAL_BYTES_EXCEEDED/u,
    );
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("invalid retained JSON is rejected before materialization", () => {
  withRoot((root) => {
    const source = "reports/n2/broken.json";
    put(root, source, "{not-json\n");
    assert.throws(() => retain(root, [source]), /RETAINED_OUTPUT_JSON_INVALID/u);
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("malformed UTF-8 retained JSON is rejected before lossy decoding", () => {
  withRoot((root) => {
    const source = "reports/n2/malformed-utf8.json";
    const path = join(root, source);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, Buffer.concat([
      Buffer.from('{"value":"', "utf8"),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}\n', "utf8"),
    ]));
    assert.throws(() => retain(root, [source]), /RETAINED_OUTPUT_JSON_INVALID_UTF8/u);
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("JSON array is rejected because scanner requires an object", () => {
  withRoot((root) => {
    const source = "reports/n2/array.json";
    put(root, source, "[]\n");
    assert.throws(() => retain(root, [source]), /RETAINED_OUTPUT_JSON_INVALID/u);
  });
});

test("embedded outputDigest must match the executor history digest when present", () => {
  withRoot((root) => {
    const source = "reports/n2/mismatch.json";
    put(root, source, JSON.stringify({ outputDigest: "1".repeat(64), value: 1 }) + "\n");
    assert.throws(
      () => retain(root, [source], "2".repeat(64)),
      /RETAINED_OUTPUT_HISTORY_DIGEST_MISMATCH/u,
    );
    assert.equal(existsSync(join(root, "reports/automation/retained-outputs/12345")), false);
  });
});

test("history output digest input itself must be canonical sha256", () => {
  withRoot((root) => {
    assert.throws(
      () => retainExecutorOutputs({ repoRoot: root, runId: "12345", outputPaths: [], historyOutputDigest: "short" }),
      /RETAINED_OUTPUT_HISTORY_DIGEST_INVALID/u,
    );
  });
});
