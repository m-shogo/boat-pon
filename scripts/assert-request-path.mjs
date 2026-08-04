// runner 側でも request path を再検証する（guard 出力を無条件に信頼しない）。
import { existsSync, lstatSync } from "node:fs";
const p = process.argv[2] ?? "";
const ok = /^automation\/requests\/pending\/REQ-[0-9A-Za-z._-]{4,64}\.json$/.test(p)
  && !p.includes("..") && !p.startsWith("/") && existsSync(p) && !lstatSync(p).isSymbolicLink();
if (!ok) { console.error(`::error::unsafe or missing request path: ${p}`); process.exit(1); }
console.error(`request path ok: ${p}`);
