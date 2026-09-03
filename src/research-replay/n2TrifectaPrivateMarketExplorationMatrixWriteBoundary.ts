import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaPrivateMarketExplorationMatrix,
  writeN2TrifectaPrivateMarketExplorationMatrix,
  type N2TrifectaPrivateMarketExplorationMatrix,
} from "./n2TrifectaPrivateMarketExplorationMatrix";

/**
 * Verified creation boundary for immutable private exploration-matrix evidence.
 *
 * The matrix is derived entirely from its immutable experiment-input manifest
 * and the manifest-bound private feature artifacts. Rebuild immediately before
 * first persistence so a caller cannot invent/re-hash row counts, lineage, or
 * feature values and have them accepted merely because the digest is self-consistent.
 */
export function writeVerifiedN2TrifectaPrivateMarketExplorationMatrix(input: {
  rootDir: string;
  matrix: N2TrifectaPrivateMarketExplorationMatrix;
}): ReturnType<typeof writeN2TrifectaPrivateMarketExplorationMatrix> {
  const rebuilt = buildN2TrifectaPrivateMarketExplorationMatrix({
    rootDir: input.rootDir,
    manifestDigest: input.matrix.manifestDigest,
  });

  if (canonicalHash(rebuilt) !== canonicalHash(input.matrix)) {
    throw new Error("EXPLORATION_MATRIX_WRITE_AUTHORITY_INVALID");
  }

  return writeN2TrifectaPrivateMarketExplorationMatrix(input);
}
