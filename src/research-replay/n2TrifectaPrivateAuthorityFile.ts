import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";

export const N2_TRIFECTA_PRIVATE_AUTHORITY_MAX_BYTES = 100_000;

export function readN2TrifectaPrivateAuthorityJson<T>(
  path: string,
  missingCode: string,
): T {
  if (!existsSync(path)) throw new Error(missingCode);
  const lst = lstatSync(path);
  if (lst.isSymbolicLink()) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_SYMLINK_NOT_ALLOWED");
  }
  if (!lst.isFile()) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_SIZE_OR_TYPE_INVALID");
  }
  if (lst.nlink !== 1) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_HARDLINK_NOT_ALLOWED");
  }
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0 || stat.size > N2_TRIFECTA_PRIVATE_AUTHORITY_MAX_BYTES) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_SIZE_OR_TYPE_INVALID");
  }
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_FILE_MODE_INVALID");
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_INVALID_JSON");
  }
}
