import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaPrivateMarketExperimentInputManifest,
  writeN2TrifectaPrivateMarketExperimentInputManifest,
  type N2TrifectaPrivateMarketExperimentInputManifest,
} from "./n2TrifectaPrivateMarketExperimentInputManifest";

/**
 * Verified creation boundary for the immutable experiment-input manifest.
 *
 * A manifest is later consumed by digest and must remain reproducible after its
 * mutable day indices advance, so downstream readers should not rebind an old
 * manifest to current indices. Instead, bind the manifest once immediately
 * before its first persistence: rebuild from the explicit source scopes and
 * require the caller-provided snapshot to match that canonical source view.
 */
export function writeVerifiedN2TrifectaPrivateMarketExperimentInputManifest(input: {
  rootDir: string;
  manifest: N2TrifectaPrivateMarketExperimentInputManifest;
}): { relativePath: string; created: boolean; manifestDigest: string; fileMode: 0o600 } {
  const scopes = input.manifest.sourceIndices.map((source) => ({
    date: source.date,
    venueCode: source.venueCode,
  }));
  const rebuilt = buildN2TrifectaPrivateMarketExperimentInputManifest({
    rootDir: input.rootDir,
    scopes,
  });

  if (canonicalHash(rebuilt) !== canonicalHash(input.manifest)) {
    throw new Error("EXPERIMENT_INPUT_MANIFEST_WRITE_AUTHORITY_INVALID");
  }

  return writeN2TrifectaPrivateMarketExperimentInputManifest(input);
}
