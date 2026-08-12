import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

const READ_CHUNK_BYTES = 64 * 1024;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function assertParentsSafe(path, baseDir, label) {
  if (baseDir === null) return;
  const base = resolve(baseDir);
  const absolutePath = resolve(path);
  const relativePath = relative(base, absolutePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${label} outside base directory: ${path}`);
  }

  const baseStat = lstatSync(base);
  if (baseStat.isSymbolicLink()) throw new Error(`${label} base symlink forbidden: ${base}`);
  if (!baseStat.isDirectory()) throw new Error(`${label} base must be a directory: ${base}`);

  let current = base;
  for (const part of relativePath.split(sep).slice(0, -1)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} parent symlink forbidden: ${current}`);
    if (!stat.isDirectory()) throw new Error(`${label} parent must be a directory: ${current}`);
  }
}

export function readSafeUtf8(path, options = {}) {
  const label = options.label ?? "file";
  const maxBytes = options.maxBytes ?? null;
  const baseDir = options.baseDir ?? null;
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
    throw new Error(`${label} byte limit invalid: ${path}`);
  }
  assertParentsSafe(path, baseDir, label);

  let fd = null;
  try {
    const pathStat = lstatSync(path);
    if (pathStat.isSymbolicLink()) throw new Error(`${label} symlink forbidden: ${path}`);
    if (!pathStat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
    if (pathStat.nlink !== 1) throw new Error(`${label} hardlink forbidden: ${path}`);
    if (!Number.isSafeInteger(pathStat.size) || pathStat.size < 0) throw new Error(`${label} size invalid: ${path}`);
    if (maxBytes !== null && pathStat.size > maxBytes) throw new Error(`${label} too large: ${pathStat.size} bytes`);

    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
    if (stat.nlink !== 1) throw new Error(`${label} hardlink forbidden: ${path}`);
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error(`${label} size invalid: ${path}`);
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino || stat.size !== pathStat.size) {
      throw new Error(`${label} changed before read: ${path}`);
    }
    if (maxBytes !== null && stat.size > maxBytes) throw new Error(`${label} too large: ${stat.size} bytes`);

    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const remainingWithSentinel = stat.size - totalBytes + 1;
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remainingWithSentinel));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > stat.size || maxBytes !== null && totalBytes > maxBytes) {
        throw new Error(`${label} changed during read: ${path}`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }

    const postReadStat = fstatSync(fd);
    if (postReadStat.dev !== stat.dev || postReadStat.ino !== stat.ino || postReadStat.size !== stat.size || totalBytes !== stat.size) {
      throw new Error(`${label} changed during read: ${path}`);
    }

    try {
      return STRICT_UTF8_DECODER.decode(Buffer.concat(chunks, totalBytes));
    } catch {
      throw new Error(`${label} is not valid UTF-8: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ELOOP") {
      throw new Error(`${label} symlink forbidden: ${path}`);
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
