import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaPrivateMarketFeatureDayIndex,
  writeN2TrifectaPrivateMarketFeatureDayIndex,
  type N2TrifectaPrivateMarketFeatureDayIndex,
} from "./n2TrifectaPrivateMarketFeatureDayIndex";

/**
 * Verified write boundary for the rebuildable private feature-day index.
 *
 * The underlying writer intentionally owns filesystem/idempotency semantics, but
 * an exported writer must not be allowed to persist caller-invented summary
 * counts merely because the caller supplied a self-consistent digest. Rebuild
 * from the verified private feature artifacts immediately before persistence and
 * require the entire candidate index to match that canonical projection.
 */
export function writeVerifiedN2TrifectaPrivateMarketFeatureDayIndex(input: {
  rootDir: string;
  index: N2TrifectaPrivateMarketFeatureDayIndex;
}): { relativePath: string; changed: boolean; indexDigest: string; fileMode: 0o600 } {
  const rebuilt = buildN2TrifectaPrivateMarketFeatureDayIndex({
    rootDir: input.rootDir,
    date: input.index.date,
    venueCode: input.index.venueCode,
    generatedAt: input.index.generatedAt,
  });

  if (canonicalHash(rebuilt) !== canonicalHash(input.index)) {
    throw new Error("PRIVATE_FEATURE_DAY_INDEX_WRITE_AUTHORITY_INVALID");
  }

  return writeN2TrifectaPrivateMarketFeatureDayIndex(input);
}
