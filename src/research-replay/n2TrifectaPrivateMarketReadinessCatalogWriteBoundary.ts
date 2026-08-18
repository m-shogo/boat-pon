import {
  N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION,
  writeN2TrifectaPrivateMarketReadinessCatalog,
  type N2TrifectaPrivateMarketReadinessCatalog,
} from "./n2TrifectaPrivateMarketReadinessCatalog";

function requireProducerBoundary(catalog: N2TrifectaPrivateMarketReadinessCatalog): void {
  if (catalog.catalogVersion !== N2_TRIFECTA_PRIVATE_MARKET_READINESS_CATALOG_VERSION
    || catalog.evidenceRole !== "EXPLORATION_READINESS_CATALOG_ONLY") {
    throw new Error("READINESS_CATALOG_WRITE_PRODUCER_CONTRACT_INVALID");
  }
  if (catalog.privateResearchOnly !== true
    || catalog.automaticFreezeAuthorized !== false
    || catalog.outcomeDataRead !== false
    || catalog.validationDataRead !== false
    || catalog.holdoutDataRead !== false
    || catalog.rawCaptureEvidenceRead !== false
    || catalog.rawOddsValuesRead !== false
    || catalog.rawOddsValuesPublished !== false
    || catalog.networkRequestCount !== 0
    || catalog.databaseReadCount !== 0
    || catalog.databaseWriteCount !== 0
    || catalog.currentBuyConnectionAuthorized !== false
    || catalog.lineConnectionAuthorized !== false
    || catalog.automatedBettingAuthorized !== false
    || catalog.publicPublishAuthorized !== false
    || catalog.productionApplyAuthorized !== false) {
    throw new Error("READINESS_CATALOG_WRITE_PROTECTED_BOUNDARY_INVALID");
  }
}

export function writeVerifiedN2TrifectaPrivateMarketReadinessCatalog(input: {
  dataRoot: string;
  catalog: N2TrifectaPrivateMarketReadinessCatalog;
}): ReturnType<typeof writeN2TrifectaPrivateMarketReadinessCatalog> {
  requireProducerBoundary(input.catalog);
  return writeN2TrifectaPrivateMarketReadinessCatalog(input);
}
