import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPublicDashboardSnapshotIntegrity } from "./publicSnapshotTransport";

test("export command writes one verified sanitized snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "boat-pon-public-snapshot-"));
  try {
    const catalogPath = join(root, "catalog.json");
    const queuePath = join(root, "queue.json");
    const currentRunPath = join(root, "current-run.json");
    const readinessPath = join(root, "readiness.json");
    const outputPath = join(root, "public-data", "latest.json");

    await Promise.all([
      writeJson(catalogPath, {
        tasks: [
          { taskId: "TASK-N2-001", title: "dataset canary", dependencies: [] },
          { taskId: "TASK-N2-010", title: "dataset expansion", dependencies: ["TASK-N2-001"] },
        ],
      }),
      writeJson(queuePath, {
        updatedAt: "2026-08-05T09:00:00.000Z",
        tasks: {
          "TASK-N2-001": {
            status: "PASS",
            evidenceLinks: ["reports/n2/canary.json"],
            updatedAt: "2026-08-04T09:00:00.000Z",
          },
          "TASK-N2-010": {
            status: "READY",
            evidenceLinks: [],
            updatedAt: "2026-08-05T09:00:00.000Z",
          },
        },
      }),
      writeJson(currentRunPath, {
        updatedAt: "2026-08-05T08:58:00.000Z",
        lastResult: "FAILED",
        blocks: ["/Users/example/private.sqlite"],
      }),
      writeJson(readinessPath, {
        evaluatedAt: "2026-08-05T08:59:00.000Z",
        verdict: "PASS",
        pendingTask: "TASK-N2-010",
        checks: [
          { name: "n2_001to006_PASS", status: "PASS" },
          { name: "holdoutFreezePresent", status: "PASS" },
        ],
      }),
    ]);

    const result = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "scripts/export-public-dashboard-snapshot.ts",
      "--catalog",
      catalogPath,
      "--queue-state",
      queuePath,
      "--current-run",
      currentRunPath,
      "--readiness",
      readinessPath,
      "--output",
      outputPath,
      "--model-version",
      "boat-pon-main:test",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
    const verified = await verifyPublicDashboardSnapshotIntegrity(output);
    assert.equal(verified.ok, true, verified.errors.join("\n"));
    assert.equal(verified.snapshot?.status.nextTask, "TASK-N2-010");
    assert.equal(verified.snapshot?.status.runner, "BLOCKED");

    const serialized = JSON.stringify(output);
    assert.doesNotMatch(serialized, /Users\/example|private\.sqlite/);
    assert.deepEqual(findForbiddenKeys(output), []);
    assert.doesNotMatch(result.stdout, new RegExp(root.replaceAll("\\", "\\\\")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function findForbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => findForbiddenKeys(item, found));
    return found;
  }
  if (typeof value !== "object" || value === null) return found;

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
    if (["selection", "recommendedamount", "currentodds", "requiredodds", "stake"].some((item) => normalized.includes(item))) {
      found.push(key);
    }
    findForbiddenKeys(child, found);
  }
  return found;
}
