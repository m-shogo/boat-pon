import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { N2EdgeKnowledgeLineagePlan } from "./n2EdgeKnowledgeLineage";
import {
  N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
  persistN2EdgeKnowledgeLineage,
} from "./n2EdgeKnowledgeRegistryPersistence";

function invalidPlanThatMustNotBeRead(): N2EdgeKnowledgeLineagePlan {
  return null as unknown as N2EdgeKnowledgeLineagePlan;
}

test("registry root symlink is blocked before plan inspection or filesystem write", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-registry-symlink-root-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-n2-registry-outside-"));
  try {
    mkdirSync(join(root, "research"), { recursive: true });
    symlinkSync(outside, join(root, "research/registries"), "dir");

    const outcome = persistN2EdgeKnowledgeLineage({
      repoRoot: root,
      registryRoot: join(root, "research/registries"),
      plan: invalidPlanThatMustNotBeRead(),
      writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
    });

    assert.equal(outcome.status, "BLOCKED");
    assert.deepEqual(outcome.blockers, ["KNOWLEDGE_REGISTRY_SYMLINK_COMPONENT"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("experiments directory symlink is blocked before registry reads or writes", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-registry-symlink-kind-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-n2-registry-kind-outside-"));
  try {
    const registryRoot = join(root, "research/registries");
    mkdirSync(registryRoot, { recursive: true });
    symlinkSync(outside, join(registryRoot, "experiments"), "dir");

    const outcome = persistN2EdgeKnowledgeLineage({
      repoRoot: root,
      registryRoot,
      plan: invalidPlanThatMustNotBeRead(),
      writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
    });

    assert.equal(outcome.status, "BLOCKED");
    assert.deepEqual(outcome.blockers, ["KNOWLEDGE_REGISTRY_SYMLINK_COMPONENT"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("symlinked JSON record is blocked before registry reads or plan inspection", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-registry-symlink-record-"));
  const outside = mkdtempSync(join(tmpdir(), "boat-pon-n2-registry-record-outside-"));
  try {
    const registryRoot = join(root, "research/registries");
    const experimentsDir = join(registryRoot, "experiments");
    mkdirSync(experimentsDir, { recursive: true });
    const outsideRecord = join(outside, "outside.json");
    writeFileSync(outsideRecord, "{\"sensitive\":true}\n", "utf8");
    symlinkSync(outsideRecord, join(experimentsDir, "linked.json"), "file");

    const outcome = persistN2EdgeKnowledgeLineage({
      repoRoot: root,
      registryRoot,
      plan: invalidPlanThatMustNotBeRead(),
      writeIntent: N2_EDGE_KNOWLEDGE_REGISTRY_WRITE_INTENT,
    });

    assert.equal(outcome.status, "BLOCKED");
    assert.deepEqual(outcome.blockers, ["KNOWLEDGE_REGISTRY_SYMLINK_RECORD"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
