import { resolve } from "node:path";

import {
  buildN2TrifectaPrivateMarketReadinessCatalog,
} from "../src/research-replay/n2TrifectaPrivateMarketReadinessCatalog";
import {
  canonicalReadinessCatalogGeneratedAt,
  writeVerifiedN2TrifectaPrivateMarketReadinessCatalog,
} from "../src/research-replay/n2TrifectaPrivateMarketReadinessCatalogWriteBoundary";

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const generatedAtArg = argument("generated-at");
let generatedAt: string;
try {
  generatedAt = canonicalReadinessCatalogGeneratedAt(generatedAtArg, new Date().toISOString());
} catch {
  console.error("invalid --generated-at");
  process.exit(2);
}
const dataRoot = resolve(process.env.BOAT_PON_DATA_ROOT?.trim() || process.cwd());
const catalog = buildN2TrifectaPrivateMarketReadinessCatalog({
  dataRoot,
  generatedAt,
});
const writePrivate = process.argv.includes("--write-private");
const writeResult = writePrivate
  ? writeVerifiedN2TrifectaPrivateMarketReadinessCatalog({ dataRoot, catalog })
  : null;

const persistedCatalogDigest = writeResult?.catalogDigest ?? catalog.catalogDigest;
const sanitized = {
  summaryVersion: "n2-trifecta-private-market-readiness-catalog-summary-v1",
  catalogVersion: catalog.catalogVersion,
  evidenceRole: catalog.evidenceRole,
  generatedAt: catalog.generatedAt,
  sourceArtifactCount: catalog.sourceArtifactCount,
  entryCount: catalog.entryCount,
  earliestDate: catalog.earliestDate,
  latestDate: catalog.latestDate,
  fullCoverageScopeCount: catalog.fullCoverageScopeCount,
  entries: catalog.entries,
  builtCatalogDigest: catalog.catalogDigest,
  catalogDigest: persistedCatalogDigest,
  privateWriteRequested: writePrivate,
  privateCatalogWrittenOrReused: writeResult != null,
  privateCatalogChanged: writeResult?.changed ?? false,
  privateCatalogReplacedExisting: writeResult?.replacedExisting ?? false,
  privateCatalogRelativePath: writeResult?.relativePath ?? null,
  privateResearchOnly: catalog.privateResearchOnly,
  automaticFreezeAuthorized: catalog.automaticFreezeAuthorized,
  outcomeDataRead: catalog.outcomeDataRead,
  validationDataRead: catalog.validationDataRead,
  holdoutDataRead: catalog.holdoutDataRead,
  rawCaptureEvidenceRead: catalog.rawCaptureEvidenceRead,
  rawOddsValuesRead: catalog.rawOddsValuesRead,
  rawOddsValuesPublished: catalog.rawOddsValuesPublished,
  networkRequestCount: catalog.networkRequestCount,
  databaseReadCount: catalog.databaseReadCount,
  databaseWriteCount: catalog.databaseWriteCount,
  currentBuyConnectionAuthorized: catalog.currentBuyConnectionAuthorized,
  lineConnectionAuthorized: catalog.lineConnectionAuthorized,
  automatedBettingAuthorized: catalog.automatedBettingAuthorized,
  publicPublishAuthorized: catalog.publicPublishAuthorized,
  productionApplyAuthorized: catalog.productionApplyAuthorized,
};
console.log(JSON.stringify(sanitized, null, 2));
