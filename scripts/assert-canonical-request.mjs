// runner 側で canonical request artifact を再検証する（guard を信頼しすぎない）。
// 固定 filename・JSON・必須 field・requestSchemaVersion のみ確認。詳細検証は automation:intent-task 内。
import { readFileSync } from "node:fs";

const p = process.argv[2];
if (p !== "canonical-request.json") { console.error(`::error::unexpected request path: ${p}`); process.exit(1); }
let req;
try { req = JSON.parse(readFileSync(p, "utf8")); } catch { console.error("::error::canonical request is not valid JSON"); process.exit(1); }
if (req.requestSchemaVersion !== "research-task-request-v1") { console.error("::error::bad requestSchemaVersion"); process.exit(1); }
for (const k of ["requestId", "taskId", "safetyLevel", "authoritySha", "queueDigest", "requestDigest"]) {
  if (!(k in req)) { console.error(`::error::missing ${k}`); process.exit(1); }
}
if (req.safetyLevel === "L4") { console.error("::error::L4 is never executed"); process.exit(1); }
console.error(`canonical request ok: ${req.requestId} task=${req.taskId} safety=${req.safetyLevel}`);
