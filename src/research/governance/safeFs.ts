import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

export function assertGovernanceDirectorySafe(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`governance scan symlink forbidden: ${path}`);
  if (!stat.isDirectory()) throw new Error(`governance scan container must be directory: ${path}`);
}

export function listJsonFilesFailClosed(root: string): string[] {
  assertGovernanceDirectorySafe(root);
  const files: string[] = [];

  const walk = (current: string): void => {
    assertGovernanceDirectorySafe(current);
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`governance scan symlink forbidden: ${full}`);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) throw new Error(`governance scan non-regular entry forbidden: ${full}`);
      if (entry.endsWith(".json")) files.push(full);
    }
  };

  walk(root);
  return files;
}

export function readGovernanceFileUtf8(path: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`governance scan file must be regular: ${path}`);
    if (stat.nlink !== 1) throw new Error(`governance scan hardlink forbidden: ${path}`);
    return readFileSync(fd, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error(`governance scan symlink forbidden: ${path}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
