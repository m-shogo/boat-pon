import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256Bytes } from "./canonical";

export const RAW_SECURITY_LIMITS = {
  maxEntityBodyBytes: 2 * 1024 * 1024,
  maxDecompressedBytes: 4 * 1024 * 1024,
  maxDecompressionRatio: 50,
  allowedContentTypes: ["application/json", "text/html", "text/plain"],
  allowedCharsets: ["utf-8", "shift_jis"],
} as const;

export const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-encoding",
  "date",
  "etag",
  "last-modified",
]);

export function redactSourceUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|key|secret|auth|signature|session/i.test(key)) url.searchParams.set(key, "[REDACTED]");
  }
  url.username = "";
  url.password = "";
  return url.toString();
}

export function allowlistedHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (SAFE_RESPONSE_HEADERS.has(normalized) && normalized !== "set-cookie") safe[normalized] = value;
  }
  return safe;
}

export type RawWriteInput = {
  bytes: Uint8Array;
  contentType: string;
  charset?: string | null;
  compressedByteLength?: number | null;
  decompressedByteLength?: number | null;
};

export type RawWriteResult = {
  rawSha256: string;
  byteLength: number;
  relativePath: string;
  absolutePath: string;
  deduplicated: boolean;
  decompressionRatio: number | null;
};

function ensureWithinRoot(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(resolvedRoot, rel) !== resolvedCandidate) {
    throw new Error("raw path traversal rejected");
  }
}

function rejectSymlinkPath(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  let cursor = dirname(target);
  while (cursor.startsWith(resolvedRoot) && cursor !== resolvedRoot) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("raw symlink path rejected");
    cursor = dirname(cursor);
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error("raw symlink target rejected");
}

function readRawFileNoFollow(path: string): Buffer {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("raw file type rejected");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function contentAddressedRelativePath(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("invalid raw hash path");
  return join("sha256", hash.slice(0, 2), hash.slice(2, 4), hash);
}

export class RawStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const rootStat = lstatSync(this.root);
    if (rootStat.isSymbolicLink()) throw new Error("raw root must not be a symlink");
    if (!rootStat.isDirectory()) throw new Error("raw root must be a directory");
    chmodSync(this.root, 0o700);
  }

  write(input: RawWriteInput): RawWriteResult {
    const normalizedContentType = input.contentType.split(";")[0].trim().toLowerCase();
    if (!RAW_SECURITY_LIMITS.allowedContentTypes.includes(normalizedContentType as never)) {
      throw new Error("unsupported_content_type");
    }
    const charset = input.charset?.toLowerCase() ?? null;
    if (charset && !RAW_SECURITY_LIMITS.allowedCharsets.includes(charset as never)) throw new Error("unknown_charset");
    if (input.bytes.byteLength > RAW_SECURITY_LIMITS.maxEntityBodyBytes) throw new Error("body_too_large");
    const decompressedBytes = input.decompressedByteLength ?? input.bytes.byteLength;
    if (decompressedBytes > RAW_SECURITY_LIMITS.maxDecompressedBytes) throw new Error("decompression_limit");
    const ratio = input.compressedByteLength && input.compressedByteLength > 0
      ? decompressedBytes / input.compressedByteLength
      : null;
    if (ratio !== null && ratio > RAW_SECURITY_LIMITS.maxDecompressionRatio) throw new Error("decompression_limit");

    const rawSha256 = sha256Bytes(input.bytes);
    const relativePath = contentAddressedRelativePath(rawSha256);
    const absolutePath = join(this.root, relativePath);
    ensureWithinRoot(this.root, absolutePath);
    rejectSymlinkPath(this.root, absolutePath);
    mkdirSync(dirname(absolutePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(absolutePath), 0o700);

    if (existsSync(absolutePath)) {
      const existing = readRawFileNoFollow(absolutePath);
      if (sha256Bytes(existing) !== rawSha256) throw new Error("hash_mismatch");
      return {
        rawSha256,
        byteLength: input.bytes.byteLength,
        relativePath,
        absolutePath,
        deduplicated: true,
        decompressionRatio: ratio,
      };
    }

    const tempPath = `${absolutePath}.tmp-${randomUUID()}`;
    ensureWithinRoot(this.root, tempPath);
    const fd = openSync(tempPath, "wx", 0o600);
    try {
      writeSync(fd, input.bytes);
      fsyncSync(fd);
      if (fstatSync(fd).size !== input.bytes.byteLength) throw new Error("partial_body");
    } catch (error) {
      closeSync(fd);
      if (existsSync(tempPath)) unlinkSync(tempPath);
      throw error;
    }
    closeSync(fd);
    try {
      linkSync(tempPath, absolutePath);
    } catch (error) {
      unlinkSync(tempPath);
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        const existing = readRawFileNoFollow(absolutePath);
        if (sha256Bytes(existing) !== rawSha256) throw new Error("hash_mismatch");
        return {
          rawSha256,
          byteLength: input.bytes.byteLength,
          relativePath,
          absolutePath,
          deduplicated: true,
          decompressionRatio: ratio,
        };
      }
      throw error;
    }
    unlinkSync(tempPath);
    const dirFd = openSync(dirname(absolutePath), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    return {
      rawSha256,
      byteLength: input.bytes.byteLength,
      relativePath,
      absolutePath,
      deduplicated: false,
      decompressionRatio: ratio,
    };
  }

  read(relativePath: string, expectedHash: string): Buffer {
    if (relativePath !== contentAddressedRelativePath(expectedHash)) throw new Error("raw storage path/hash mismatch");
    const absolutePath = join(this.root, relativePath);
    ensureWithinRoot(this.root, absolutePath);
    rejectSymlinkPath(this.root, absolutePath);
    const bytes = readRawFileNoFollow(absolutePath);
    if (sha256Bytes(bytes) !== expectedHash) throw new Error("hash_mismatch");
    return bytes;
  }

  integrity(relativePath: string, expectedHash: string, expectedBytes: number): boolean {
    try {
      const absolutePath = join(this.root, relativePath);
      const metadata = statSync(absolutePath);
      return metadata.isFile()
        && metadata.size === expectedBytes
        && sha256Bytes(this.read(relativePath, expectedHash)) === expectedHash;
    } catch {
      return false;
    }
  }

  absolutePathForHash(hash: string): string {
    const target = join(this.root, contentAddressedRelativePath(hash));
    ensureWithinRoot(this.root, target);
    return target;
  }

  removeVerified(relativePath: string, expectedHash: string): boolean {
    if (relativePath !== contentAddressedRelativePath(expectedHash)) throw new Error("raw storage path/hash mismatch");
    const absolutePath = join(this.root, relativePath);
    ensureWithinRoot(this.root, absolutePath);
    rejectSymlinkPath(this.root, absolutePath);
    if (!existsSync(absolutePath)) return false;
    const bytes = readRawFileNoFollow(absolutePath);
    if (sha256Bytes(bytes) !== expectedHash) throw new Error("hash_mismatch");
    unlinkSync(absolutePath);
    const dirFd = openSync(dirname(absolutePath), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    return true;
  }
}
