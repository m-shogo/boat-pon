import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("../../scripts/audit-official-racer-relationships.ts", import.meta.url));

function runAudit(sourcePublishedDate: string, verifiedAt: string) {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-relationship-audit-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "official-racer-relationships.json"), JSON.stringify({
      schemaVersion: 1,
      policy: {
        allowedRelationshipTypes: ["mentor_apprentice"],
        sourcePolicy: "official only",
        analysisPolicy: "個人別の疑惑判定には使わない",
      },
      relationships: [{
        relationshipType: "mentor_apprentice",
        mentor: { registrationNo: "1001", name: "Mentor" },
        apprentice: { registrationNo: "1002", name: "Apprentice" },
        sourceUrl: "https://www.boatrace.jp/fixture",
        sourcePublishedDate,
        evidenceSummary: "公式記事 fixture",
        verifiedAt,
      }],
    }));
    return spawnSync(process.execPath, ["--import", "tsx", scriptPath], { cwd: root, encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("official relationship audit rejects impossible calendar dates", () => {
  for (const date of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01"]) {
    const published = runAudit(date, "2026-08-01");
    assert.equal(published.status, 1);
    assert.match(published.stderr, /invalid sourcePublishedDate/);

    const verified = runAudit("2026-08-01", date);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /invalid verifiedAt/);
  }
});

test("official relationship audit accepts a real leap-day date", () => {
  const result = runAudit("2028-02-29", "2028-02-29");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /official relationship registry: ok/);
});
