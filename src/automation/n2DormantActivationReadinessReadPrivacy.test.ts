import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const plannerScript = resolve(process.cwd(), "scripts/report-n2-dormant-activation-plan.ts");

function escaped(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u");
}

test("N2 activation planner redacts private readiness read failures", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-readiness-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const directory = join(
    root,
    "data/raw/research/trifecta-market/2026-08-07/10/01/T-5",
  );
  mkdirSync(directory, { recursive: true });
  const rawRelativePath = "data/raw/research/trifecta-market/2026-08-07/10/01/T-5/capture.html";
  const envelopeRelativePath = "data/raw/research/trifecta-market/2026-08-07/10/01/T-5/capture.envelope.json";
  writeFileSync(join(root, rawRelativePath), "fixture\n", "utf8");
  writeFileSync(join(root, envelopeRelativePath), "{}\n", "utf8");
  writeFileSync(join(directory, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest: "c".repeat(64),
    checkpointKey: "b".repeat(64),
    raceIdentity: "20260807-10-01",
    checkpointLabel: "T-5",
    rawDocumentId: "fixture-document",
    rawSha256: "a".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: "2026-08-07T03:00:00.000Z",
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  })}\n`, "utf8");

  const privateSidecarPath = join(root, "private-sidecar.sqlite");
  writeFileSync(privateSidecarPath, "not a sqlite database\n", "utf8");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", plannerScript],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        BOAT_PON_DATA_ROOT: root,
        BOAT_PON_RESEARCH_REPLAY_DB: privateSidecarPath,
      },
    },
  );

  assert.equal(result.status, 3);
  const report = JSON.parse(result.stdout) as { blockers?: unknown };
  assert.deepEqual(report.blockers, ["READINESS_READ_FAILED"]);
  assert.doesNotMatch(result.stdout, escaped(root));
  assert.doesNotMatch(result.stderr, escaped(root));
  assert.equal(result.stderr, "");
});
