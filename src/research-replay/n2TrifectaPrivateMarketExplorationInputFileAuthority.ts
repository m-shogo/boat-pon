import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const MAX_MANIFEST_BYTES = 5_000_000;

/**
 * Preflight immutable private files that can influence exploration-matrix rows.
 *
 * Semantic/digest validation remains owned by the canonical matrix builder. This
 * boundary only rejects alternate hard-link identities before any manifest-bound
 * feature artifact is accepted as research authority.
 */
export function assertN2TrifectaPrivateMarketExplorationInputSingleLinks(
  rootDir: string,
  manifestDigest: string,
): void {
  const root = resolve(rootDir);
  const manifestPath = resolve(
    root,
    "data/private/trifecta-market-experiments/manifests",
    `${manifestDigest}.json`,
  );
  if (!existsSync(manifestPath)) return;
  const manifestLst = lstatSync(manifestPath);
  if (manifestLst.isSymbolicLink() || !manifestLst.isFile()) return;
  const manifestStat = statSync(manifestPath);
  if (manifestStat.nlink !== 1) {
    throw new Error("EXPLORATION_MATRIX_MANIFEST_HARDLINK_NOT_ALLOWED");
  }
  if (manifestStat.size <= 0 || manifestStat.size > MAX_MANIFEST_BYTES) return;

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return;
  }
  if (typeof manifest !== "object" || manifest == null || Array.isArray(manifest)) return;
  const races = (manifest as { races?: unknown }).races;
  if (!Array.isArray(races)) return;

  for (const race of races) {
    if (typeof race !== "object" || race == null || Array.isArray(race)) continue;
    const relativePath = (race as { featureArtifactRelativePath?: unknown }).featureArtifactRelativePath;
    if (typeof relativePath !== "string" || relativePath.length === 0) continue;
    const featurePath = resolve(root, relativePath);
    if (featurePath === root || !featurePath.startsWith(`${root}${sep}`)) continue;
    if (!existsSync(featurePath)) continue;
    const featureLst = lstatSync(featurePath);
    if (featureLst.isSymbolicLink() || !featureLst.isFile()) continue;
    if (statSync(featurePath).nlink !== 1) {
      throw new Error("EXPLORATION_MATRIX_FEATURE_HARDLINK_NOT_ALLOWED");
    }
  }
}
