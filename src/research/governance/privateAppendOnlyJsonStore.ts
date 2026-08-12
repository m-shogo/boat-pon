import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { TextDecoder } from "node:util";

const READ_CHUNK_BYTES = 64 * 1024;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function assertPrivateDirectory(directory: string): string {
  const absolute = resolve(directory);
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("private append-only store directory must be a real directory");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("private append-only store directory permissions are too broad");
  }
  return absolute;
}

function readExistingPrivateFile(path: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error("private append-only store existing target must be a single-link regular file");
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error("private append-only store existing target permissions are too broad");
    }
    if (!Number.isSafeInteger(stat.size) || stat.size <= 0) {
      throw new Error("private append-only store existing target size is invalid");
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithSentinel = stat.size - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remainingWithSentinel));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > stat.size) {
        throw new Error("private append-only store existing target changed during read");
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const postRead = fstatSync(fd);
    if (postRead.size !== stat.size || totalBytes !== stat.size) {
      throw new Error("private append-only store existing target changed during read");
    }
    try {
      return STRICT_UTF8_DECODER.decode(Buffer.concat(chunks, totalBytes));
    } catch {
      throw new Error("private append-only store existing target is not strict UTF-8");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error("private append-only store existing target symlink is forbidden");
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function appendPrivateJsonStore(input: {
  directory: string;
  filename: string;
  contents: string;
  expectedEvidenceDigest: string;
  validateExistingEvidence: (value: unknown) => boolean;
}): string {
  if (basename(input.filename) !== input.filename || !/^[0-9A-Za-z._-]+\.json$/u.test(input.filename)) {
    throw new Error("private append-only store filename is invalid");
  }
  if (!/^[0-9a-f]{64}$/u.test(input.expectedEvidenceDigest)) {
    throw new Error("private append-only store evidence digest is invalid");
  }
  const directory = assertPrivateDirectory(input.directory);
  const path = join(directory, input.filename);
  try {
    writeFileSync(path, input.contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    if (code !== "EEXIST") throw error;
    let existing: Record<string, unknown>;
    try {
      const parsed = JSON.parse(readExistingPrivateFile(path)) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not object");
      existing = parsed as Record<string, unknown>;
    } catch (existingError) {
      throw new Error(`append-only private store conflict: existing target is unsafe or invalid: ${
        existingError instanceof Error ? existingError.message : String(existingError)
      }`);
    }
    const evidence = existing.evidence;
    if (!input.validateExistingEvidence(evidence)) {
      throw new Error("append-only private store conflict: existing evidence is invalid");
    }
    const existingDigest = typeof evidence === "object" && evidence !== null && !Array.isArray(evidence)
      ? (evidence as Record<string, unknown>).contentDigest
      : null;
    if (existingDigest !== input.expectedEvidenceDigest) {
      throw new Error("append-only private store conflict: existing evidence differs");
    }
  }
  return path;
}
