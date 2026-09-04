import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export const N2_TRIFECTA_PRIVATE_AUTHORITY_MAX_BYTES = 100_000;

function assertSafeAuthorityAncestors(path: string, trustedRoot: string): void {
  const root = resolve(trustedRoot);
  const target = resolve(path);
  const parent = dirname(target);
  const rel = relative(root, parent);
  if (target === root || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_PATH_OUTSIDE_TRUSTED_ROOT");
  }

  let current = root;
  const components = rel === "" ? [] : rel.split(sep).filter(Boolean);
  for (const component of ["", ...components]) {
    if (component !== "") current = resolve(current, component);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_PARENT_INVALID");
    }
  }
}

export function readN2TrifectaPrivateAuthorityJson<T>(
  path: string,
  missingCode: string,
  trustedRoot?: string,
): T {
  if (trustedRoot != null) assertSafeAuthorityAncestors(path, trustedRoot);
  if (!existsSync(path)) throw new Error(missingCode);
  const lst = lstatSync(path);
  if (lst.isSymbolicLink()) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_SYMLINK_NOT_ALLOWED");
  }
  if (!lst.isFile()) {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_SIZE_OR_TYPE_INVALID");
  }

  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_OPEN_FAILED");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > N2_TRIFECTA_PRIVATE_AUTHORITY_MAX_BYTES) {
      throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_SIZE_OR_TYPE_INVALID");
    }
    if (stat.nlink !== 1) {
      throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_HARDLINK_NOT_ALLOWED");
    }
    if ((stat.mode & 0o777) !== 0o600) {
      throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_FILE_MODE_INVALID");
    }
    try {
      return JSON.parse(readFileSync(fd, "utf8")) as T;
    } catch {
      throw new Error("LOCAL_CAPTURE_PRIVATE_AUTHORITY_INVALID_JSON");
    }
  } finally {
    closeSync(fd);
  }
}
