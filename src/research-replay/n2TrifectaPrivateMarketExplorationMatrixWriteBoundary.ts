import { existsSync, lstatSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import { canonicalHash } from "./canonical";
import {
  buildN2TrifectaPrivateMarketExplorationMatrix,
  privateMarketExplorationMatrixRelativePath,
  writeN2TrifectaPrivateMarketExplorationMatrix,
  type N2TrifectaPrivateMarketExplorationMatrix,
} from "./n2TrifectaPrivateMarketExplorationMatrix";

function assertSafeExistingAncestors(rootDir: string, targetPath: string): void {
  const root = resolve(rootDir);
  const parent = dirname(targetPath);
  const rel = relative(root, parent);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("EXPLORATION_MATRIX_PARENT_INVALID");
  }

  let current = root;
  const components = rel === "" ? [] : rel.split(sep).filter(Boolean);
  for (const component of ["", ...components]) {
    if (component !== "") current = resolve(current, component);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("EXPLORATION_MATRIX_PARENT_INVALID");
    }
  }
}

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

  const path = resolve(input.rootDir, privateMarketExplorationMatrixRelativePath(input.matrix));
  assertSafeExistingAncestors(input.rootDir, path);
  if (existsSync(path)) {
    const lst = lstatSync(path);
    if (!lst.isSymbolicLink() && lst.isFile() && statSync(path).nlink !== 1) {
      throw new Error("EXPLORATION_MATRIX_EXISTING_HARDLINK_NOT_ALLOWED");
    }
  }

  return writeN2TrifectaPrivateMarketExplorationMatrix(input);
}
