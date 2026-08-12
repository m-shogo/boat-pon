import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const BOUNDED_READ_CHUNK_BYTES = 64 * 1024;

export function assertGovernanceDirectorySafe(path: string): void {
  assertGovernanceReadParentsSafe(path);
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

function assertGovernanceReadParentsSafe(path: string, trustedRoot?: string): void {
  const anchor = resolve(trustedRoot ?? process.cwd());
  const absolutePath = resolve(path);
  const relativePath = relative(anchor, absolutePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    if (trustedRoot !== undefined && absolutePath !== anchor) {
      throw new Error(`governance scan path outside trusted root: ${path}`);
    }
    return;
  }

  const parentParts = relativePath.split(sep).slice(0, -1);
  let current = anchor;
  for (const part of parentParts) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`governance scan parent symlink forbidden: ${current}`);
    if (!stat.isDirectory()) throw new Error(`governance scan parent must be directory: ${current}`);
  }
}

function readDescriptorBounded(fd: number, path: string, maxBytes: number): Buffer {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const remainingWithSentinel = maxBytes - totalBytes + 1;
    const chunkSize = Math.min(BOUNDED_READ_CHUNK_BYTES, remainingWithSentinel);
    const chunk = Buffer.allocUnsafe(chunkSize);
    const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;

    totalBytes += bytesRead;
    if (totalBytes > maxBytes) {
      throw new Error(`governance scan file exceeds byte limit: ${path}`);
    }
    chunks.push(chunk.subarray(0, bytesRead));
  }

  return Buffer.concat(chunks, totalBytes);
}

function readGovernanceFileDescriptor(
  path: string,
  maxBytes?: number,
  trustedRoot?: string,
): { text: string; bytes: number } {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
    throw new Error(`governance scan byte limit invalid: ${path}`);
  }
  assertGovernanceReadParentsSafe(path, trustedRoot);
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`governance scan file must be regular: ${path}`);
    if (stat.nlink !== 1) throw new Error(`governance scan hardlink forbidden: ${path}`);
    if (maxBytes !== undefined && stat.size > maxBytes) {
      throw new Error(`governance scan file exceeds byte limit: ${path}`);
    }
    const readLimit = maxBytes === undefined ? stat.size : Math.min(maxBytes, stat.size);
    const content = readDescriptorBounded(fd, path, readLimit);
    const bytes = content.byteLength;
    const postReadStat = fstatSync(fd);
    if (postReadStat.size !== stat.size || bytes !== stat.size) {
      throw new Error(`governance scan file changed during read: ${path}`);
    }
    let text: string;
    try {
      text = STRICT_UTF8_DECODER.decode(content);
    } catch {
      throw new Error(`governance scan invalid utf8: ${path}`);
    }
    return { text, bytes };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error(`governance scan symlink forbidden: ${path}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function readGovernanceFileUtf8(path: string, trustedRoot?: string): string {
  return readGovernanceFileDescriptor(path, undefined, trustedRoot).text;
}

export function readGovernanceFileUtf8Bounded(
  path: string,
  maxBytes: number,
  trustedRoot?: string,
): { text: string; bytes: number } {
  return readGovernanceFileDescriptor(path, maxBytes, trustedRoot);
}
