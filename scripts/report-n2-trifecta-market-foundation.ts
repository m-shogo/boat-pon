import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { canonicalHash } from "../src/research-replay/canonical";
import { readLifecycleValidApprovalScopes } from "../src/research-replay/n2ObservationIngestApprovalScopes";
import { buildN2TrifectaMarketFoundation } from "../src/research-replay/n2TrifectaMarketFoundation";
import { readN2TrifectaMarketSourceInventory } from "../src/research-replay/n2TrifectaMarketSourceInventoryReader";
import { readN2ObservationIngestReadiness } from "../src/research-replay/n2ObservationIngestReadinessReader";

const root = resolve(process.cwd());
const policy = JSON.parse(readFileSync(join(root, "config/research-automation-policy.json"), "utf8"));
const dataRoot = resolve(String(policy.dataRoot ?? policy.repoPath ?? root));
const primaryDbPath = join(dataRoot, "data/boat.sqlite");
const sidecarDbPath = join(dataRoot, "data/research-replay.sqlite");
const outputPath = resolve(process.env.BOAT_PON_N2_TRIFECTA_FOUNDATION_REPORT
  ?? join(root, "reports/n2/n2-trifecta-market-foundation.json"));

function dbMeta(path: string): { exists: boolean; bytes: number | null; modifiedMs: number | null; walBytes: number } {
  const walPath = `${path}-wal`;
  return {
    exists: existsSync(path),
    bytes: existsSync(path) ? statSync(path).size : null,
    modifiedMs: existsSync(path) ? statSync(path).mtimeMs : null,
    walBytes: existsSync(walPath) ? statSync(walPath).size : 0,
  };
}

const primaryBefore = dbMeta(primaryDbPath);
const sidecarBefore = dbMeta(sidecarDbPath);
const generatedAt = new Date().toISOString();
const inventory = readN2TrifectaMarketSourceInventory({ primaryDbPath });
const readiness = readN2ObservationIngestReadiness({ primaryDbPath, sidecarDbPath });
const lifecycleValidApprovalScopes = readLifecycleValidApprovalScopes(sidecarDbPath);

// This report intentionally does not synthesize raw snapshot candidates from aggregate odds rows.
// A non-empty manifest requires a future reviewed raw-document reader with exact PIT and lineage fields.
const foundation = buildN2TrifectaMarketFoundation({
  inventory,
  candidates: [],
  requestedMaxRaces: 20,
});
const primaryAfter = dbMeta(primaryDbPath);
const sidecarAfter = dbMeta(sidecarDbPath);
const dbMetadataUnchanged = JSON.stringify(primaryBefore) === JSON.stringify(primaryAfter)
  && JSON.stringify(sidecarBefore) === JSON.stringify(sidecarAfter);
if (!dbMetadataUnchanged) throw new Error("DB_METADATA_CHANGED_DURING_READ_ONLY_FOUNDATION_REPORT");

const core = {
  reportVersion: "n2-trifecta-market-foundation-report-v1",
  generatedAt,
  status: foundation.status,
  dataStatus: inventory.totalRows > 0 ? "REAL_DATA_INVENTORY" : "NO_SOURCE_ROWS",
  sourceType: "trifecta_market" as const,
  inventory,
  foundation,
  existingState: {
    trifectaMarketObservationCount: readiness.input.sidecar.trifectaMarketObservationCount,
    captureAttemptCount: readiness.input.sidecar.captureAttemptCount,
    shadowWriteEnabled: readiness.input.rollout.shadowWriteEnabled,
    operationalGcEnabled: readiness.input.rollout.operationalGcEnabled,
    killSwitchEngaged: readiness.input.rollout.killSwitchEngaged,
    approvalPresent: lifecycleValidApprovalScopes.includes("N2_TRIFECTA_MARKET_OBSERVATION_CANARY"),
  },
  sourceCandidatesMaterialized: 0,
  sourceCandidatePolicy: "aggregate odds rows are inventory only and are never relabeled as raw official documents",
  writeAuthorized: false as const,
  approvalCreated: false as const,
  productionApplyExecuted: false as const,
  primaryDbWriteCount: 0 as const,
  sidecarWriteCount: 0 as const,
  dbMetadataUnchanged,
  dbEvidence: {
    primaryBefore,
    primaryAfter,
    sidecarBefore,
    sidecarAfter,
  },
};
const report = { ...core, outputDigest: canonicalHash(core) };
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
