import { existsSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

if (!existsSync(configuredDbPath)) {
  throw new Error("ROI_EDGE_MARKET_GAP_PRIMARY_DB_MISSING");
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ROI_EDGE_MARKET_GAP_PRIMARY_DB_IDENTITY_INVALID",
);

// The internal analyzer already opens SQLite read-only. Normalize its input to the
// verified canonical identity so the guarded path cannot reopen an unchecked alias.
process.env.BOAT_PON_DB_PATH = verifiedDbPath;
