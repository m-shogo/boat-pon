import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

function components(rootDir: string, targetPath: string, includeTarget: boolean): string[] {
  const root = resolve(rootDir);
  const target = resolve(targetPath);
  const boundary = includeTarget ? target : dirname(target);
  const rel = relative(root, boundary);
  if (target === root || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("PRIVATE_AUTHORITY_PATH_OUTSIDE_DATA_ROOT");
  }
  const paths = [root];
  let current = root;
  for (const component of (rel === "" ? [] : rel.split(sep).filter(Boolean))) {
    current = resolve(current, component);
    paths.push(current);
  }
  return paths;
}

function verify(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("PRIVATE_AUTHORITY_PARENT_INVALID");
  }
}

export function assertN2TrifectaPrivateAuthorityParents(input: {
  dataRoot: string;
  targetPath: string;
}): void {
  for (const path of components(input.dataRoot, input.targetPath, false)) {
    if (!existsSync(path)) continue;
    verify(path);
  }
}

export function ensureN2TrifectaPrivateAuthorityDirectory(input: {
  dataRoot: string;
  directoryPath: string;
}): void {
  for (const path of components(input.dataRoot, input.directoryPath, true)) {
    if (existsSync(path)) {
      verify(path);
      continue;
    }
    mkdirSync(path, { mode: 0o700 });
  }
}
