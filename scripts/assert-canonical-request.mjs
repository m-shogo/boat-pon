// runner 側で canonical request artifact を再検証する（guard を信頼しすぎない）。
// 固定 filename・JSON・必須 field・requestSchemaVersion のみ確認。詳細検証は automation:intent-task 内。
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { TextDecoder } from "node:util";

const p = process.argv[2];
if (p !== "canonical-request.json") { console.error(`::error::unexpected request path: ${p}`); process.exit(1); }

function readCanonicalRequest(path) {
  let fd = null;
  try {
    const pathStat = lstatSync(path);
    if (pathStat.isSymbolicLink()) throw new Error("canonical request symlink forbidden");
    if (!pathStat.isFile()) throw new Error("canonical request must be a regular file");
    if (pathStat.nlink !== 1) throw new Error("canonical request hardlink forbidden");

    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("canonical request must be a regular file");
    if (stat.nlink !== 1) throw new Error("canonical request hardlink forbidden");
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino || stat.size !== pathStat.size) {
      throw new Error("canonical request changed before read");
    }
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error("canonical request size invalid");

    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, stat.size - totalBytes + 1));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > stat.size) throw new Error("canonical request changed during read");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const postReadStat = fstatSync(fd);
    if (postReadStat.dev !== stat.dev || postReadStat.ino !== stat.ino || postReadStat.size !== stat.size || totalBytes !== stat.size) {
      throw new Error("canonical request changed during read");
    }

    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, totalBytes));
    } catch {
      throw new Error("canonical request is not valid UTF-8");
    }
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

let req;
try { req = JSON.parse(readCanonicalRequest(p)); } catch (error) { console.error(`::error::${error instanceof Error ? error.message : "canonical request is not valid JSON"}`); process.exit(1); }
if (req.requestSchemaVersion !== "research-task-request-v1") { console.error("::error::bad requestSchemaVersion"); process.exit(1); }
for (const k of ["requestId", "taskId", "safetyLevel", "authoritySha", "queueDigest", "requestDigest"]) {
  if (!(k in req)) { console.error(`::error::missing ${k}`); process.exit(1); }
}
if (req.safetyLevel === "L4") { console.error("::error::L4 is never executed"); process.exit(1); }
console.error(`canonical request ok: ${req.requestId} task=${req.taskId} safety=${req.safetyLevel}`);