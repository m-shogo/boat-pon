import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";

const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const BOUNDED_READ_CHUNK_BYTES = 64 * 1024;

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

function readGovernanceFileDescriptor(path: string, maxBytes?: number): { text: string; bytes: number } {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
    throw new Error(`governance scan byte limit invalid: ${path}`);
  }
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`governance scan file must be regular: ${path}`);
    if (stat.nlink !== 1) throw new Error(`governance scan hardlink forbidden: ${path}`);
    if (maxBytes !== undefined && stat.size > maxBytes) {
      throw new Error(`governance scan file exceeds byte limit: ${path}`);
    }
    const content = maxBytes === undefined ? readFileSync(fd) : readDescriptorBounded(fd, path, maxBytes);
    const bytes = content.byteLength;
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

export function readGovernanceFileUtf8(path: string): string {
  return readGovernanceFileDescriptor(path).text;
}

export function readGovernanceFileUtf8Bounded(path: string, maxBytes: number): { text: string; bytes: number } {
  return readGovernanceFileDescriptor(path, maxBytes);
}
