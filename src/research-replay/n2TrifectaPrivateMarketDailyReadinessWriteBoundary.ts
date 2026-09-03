import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaPrivateMarketDailyReadiness,
  writeN2TrifectaPrivateMarketDailyReadiness,
  type N2TrifectaPrivateMarketDailyReadiness,
} from "./n2TrifectaPrivateMarketDailyReadiness";

/**
 * Verified creation boundary for immutable private daily-readiness evidence.
 *
 * The catalog later consumes readiness artifacts as historical snapshots, so old
 * artifacts must not be rebound when source evidence advances. Instead, rebuild
 * the readiness snapshot from the verified day-index/heartbeat sources at the
 * exact checkedAt immediately before first persistence and reject caller-invented
 * counts or status metadata even when the caller recomputes a valid self-digest.
 */
export function writeVerifiedN2TrifectaPrivateMarketDailyReadiness(input: {
  dataRoot: string;
  readiness: N2TrifectaPrivateMarketDailyReadiness;
}): { relativePath: string; created: boolean; outputDigest: string; fileMode: 0o600 } {
  const rebuilt = buildN2TrifectaPrivateMarketDailyReadiness({
    dataRoot: input.dataRoot,
    date: input.readiness.date,
    venueCode: input.readiness.venueCode,
    checkedAt: input.readiness.checkedAt,
  });

  if (canonicalHash(rebuilt) !== canonicalHash(input.readiness)) {
    throw new Error("DAILY_READINESS_WRITE_AUTHORITY_INVALID");
  }

  return writeN2TrifectaPrivateMarketDailyReadiness(input);
}
