import { lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export function assertCanonicalSingleLinkRegularFile(path: string, errorCode: string): string {
  const lexicalPath = resolve(path);
  let leaf;
  try {
    leaf = lstatSync(lexicalPath);
  } catch {
    throw new Error(errorCode);
  }
  if (leaf.isSymbolicLink() || !leaf.isFile() || leaf.nlink !== 1) {
    throw new Error(errorCode);
  }
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(lexicalPath);
  } catch {
    throw new Error(errorCode);
  }
  if (canonicalPath !== lexicalPath) {
    throw new Error(errorCode);
  }
  return lexicalPath;
}
