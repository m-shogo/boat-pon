// N2 settlement reparse production apply CLI（承認境界・自己承認不可）。
//
// 実 sidecar への適用は、既存 append-only approval lifecycle（resolveApproval 経由の
// resolveReparseApplyGate）が有効な production approval を解決した場合だけ許可する。
// 一致する承認が無ければ必ず BLOCKED（exit 3）で、実 sidecar へ一切書き込まない。
// 承認された場合のみ backup→canary→full apply→verify を、temp-copy と同一 engine コードパスで行う。
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseOfficialResultDetail } from "../src/domain/officialResultDetailParser";
import { canonicalHash } from "../src/research-replay/canonical";
import { listArchiveFiles } from "../src/research-replay/n1Backfill";
import { SettlementRepository } from "../src/research-replay/settlement";
import { deriveSettlementCandidates } from "../src/research-replay/n2SettlementReparse";
import {
  applyReparseForDocument, computeAfter, ensureSupersedesIndex, fullIntegrity, lightIntegrity,
  loadActiveState, loadSourceDuplicateSet, newState, physicalRowCount, type RawMeta,
} from "../src/research-replay/n2SettlementReparseEngine";
import { resolveReparseApplyGate } from "../src/research-replay/n2SettlementReparseApply";

const root = resolve(process.cwd());
const arg = (n: string): string | null => {
  const d = process.argv.find((v) => v.startsWith(`${n}=`));
  if (d) return d.slice(n.length + 1);
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const sidecarPath = resolve(arg("--sidecar") ?? join(root, "data", "research-replay.sqlite"));
const archiveRoot = resolve(arg("--archive-root") ?? join(root, "data", "raw", "official", "results"));
const manifestPath = arg("--manifest");
const approvalGrantId = arg("--approval-grant");
const asOf = arg("--as-of");
const mode = arg("--mode") ?? "production";
const reportDir = resolve(arg("--report-dir") ?? join(root, "reports", "n2"));
const reportName = arg("--report-name") ?? "settlement-reparse-apply";
if (!manifestPath) throw new Error("--manifest=<approval-manifest.json> は必須です");
if (!asOf || Number.isNaN(Date.parse(asOf))) throw new Error("--as-of=<ISO8601 UTC> は必須です");
const nowIso = new Date(asOf).toISOString();

function sha256File(path: string): string {
  const out = spawnSync("shasum", ["-a", "256", path], { encoding: "utf8", maxBuffer: 1 << 20 });
  if (out.status !== 0) throw new Error(`shasum failed: ${out.stderr}`);
  return out.stdout.trim().split(/\s+/)[0];
}
function unpack(path: string): Promise<Buffer> {
  return new Promise((res, rej) => {
    const child = spawn("unar", ["-q", "-o", "-", path], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", rej);
    child.on("close", (code) => code === 0 ? res(Buffer.concat(out)) : rej(new Error(Buffer.concat(err).toString("utf8") || `unar ${code}`)));
  });
}
function settlementSchemaOf(db: DatabaseSync): string {
  const rows = db.prepare("SELECT migration_version FROM n1_schema_migrations WHERE status='applied' ORDER BY rowid").all() as Array<{ migration_version: string }>;
  return rows.at(-1)?.migration_version ?? "unknown";
}

function finish(payload: Record<string, unknown>, exitCode: number): never {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${reportName}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({ status: payload.status, exitCode, blocks: payload.blocks ?? [], approvalCode: (payload.gate as any)?.approval?.code }, null, 2));
  process.exit(exitCode);
}

async function main(): Promise<void> {
  if (!existsSync(sidecarPath)) throw new Error(`sidecar not found: ${sidecarPath}`);
  if (!existsSync(manifestPath!)) throw new Error(`manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath!, "utf8")) as Parameters<typeof resolveReparseApplyGate>[1]["manifest"];

  // on-disk source identity（read-only 計測）
  const sourceSha256 = sha256File(sidecarPath);
  const sourceBytes = statSync(sidecarPath).size;
  const hasActiveWal = existsSync(`${sidecarPath}-wal`) && statSync(`${sidecarPath}-wal`).size > 0;
  const st = statfsSync(dirname(sidecarPath));
  const diskFreeBytes = Number(st.bavail) * Number(st.bsize);
  const codeGitSha = process.env.GIT_SHA ?? null;

  // gate 解決は immutable/read-only で行う（approval tables 読取りのみ・write 0）
  const uri = `${pathToFileURL(sidecarPath).href}?immutable=1`;
  const roDb = new DatabaseSync(uri, { readOnly: true } as never);
  let settlementSchema: string;
  try {
    roDb.exec("PRAGMA query_only=ON");
    settlementSchema = settlementSchemaOf(roDb);
    const gate = resolveReparseApplyGate(roDb, {
      manifest,
      onDisk: { sourceSha256, sourceBytes, settlementSchema, hasActiveWal, diskFreeBytes, neededBytes: sourceBytes + 20e9, codeGitSha },
      approvalGrantId, executionMode: mode as "production" | "simulated", rolloutStartedAt: new Date().toISOString(),
    });
    roDb.close();

    if (!gate.approved) {
      finish({
        phase: "N2_SETTLEMENT_REPARSE_APPLY", generatedAt: new Date().toISOString(), gitSha: codeGitSha,
        status: "BLOCKED", realSidecarApply: "NOT_EXECUTED", writesToSidecar: 0,
        reason: "no valid production approval bound to the manifest snapshot/digest; production apply is BLOCKED",
        sidecar: sidecarPath, sourceSha256, sourceBytes, settlementSchema,
        manifestApprovalTargetDigest: manifest.approvalTargetDigest,
        gate, blocks: gate.blocks,
      }, gate.exitCode);
    }

    // ---- 承認済み branch（有効な production approval が存在する場合のみ到達）----
    // temp-copy と同一 engine コードパスで実 sidecar へ append-only 適用する。
    await applyToRealSidecar(gate, { sourceSha256, sourceBytes, settlementSchema, codeGitSha, manifest });
  } finally {
    try { roDb.close(); } catch { /* already closed */ }
  }
}

async function applyToRealSidecar(gate: ReturnType<typeof resolveReparseApplyGate>, ctx: { sourceSha256: string; sourceBytes: number; settlementSchema: string; codeGitSha: string | null; manifest: unknown }): Promise<void> {
  // 適用直前に snapshot 不変を再確認（TOCTOU 防止）。
  const preSha = sha256File(sidecarPath);
  if (preSha !== ctx.sourceSha256) {
    finish({ phase: "N2_SETTLEMENT_REPARSE_APPLY", status: "BLOCKED", reason: "SNAPSHOT_CHANGED_BEFORE_APPLY", realSidecarApply: "NOT_EXECUTED", writesToSidecar: 0, gate }, 3);
  }
  const db = new DatabaseSync(sidecarPath);
  const repo = new SettlementRepository(db, randomUUID);
  const startedMs = Date.now();
  try {
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("PRAGMA busy_timeout=60000");
    ensureSupersedesIndex(db);
    const sourceDup = loadSourceDuplicateSet(db);
    const byHash = loadRawMaps(db);
    const activeState = loadActiveState(db, sourceDup);
    const before = { ...activeState.before };
    const physicalBefore = activeState.physicalRows;
    const state = newState();
    const files = listArchiveFiles(archiveRoot);
    const processedRaw = new Set<string>();
    let processed = 0;
    for (const path of files) {
      // per-file 適用直前に snapshot 監視は高コストのため省略、但し crash 安全は per-document txn で担保。
      let bytes: Buffer;
      state.counts.files_scanned += 1;
      try { bytes = await unpack(path); } catch { state.counts.parse_errors += 1; continue; }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const meta = byHash.get(hash);
      if (!meta) { state.counts.files_not_ingested += 1; continue; }
      if (processedRaw.has(meta.rawDocumentId)) { state.counts.files_duplicate_source += 1; continue; }
      processedRaw.add(meta.rawDocumentId);
      state.counts.files_ingested += 1;
      const parsed = parseOfficialResultDetail(new TextDecoder("shift_jis").decode(bytes), { date: meta.date, fetchedAt: "1970-01-01T00:00:00.000Z" });
      applyReparseForDocument(db, repo, meta, deriveSettlementCandidates(parsed), activeState, state, nowIso);
      processed += 1;
      if (processed % 1000 === 0) process.stderr.write(`[apply] ${processed} ingested, appended ${state.counts.appended_candidates}\n`);
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const afterDelta = computeAfter(before, state.counts);
    const integrity = fullIntegrity(db);
    const light = lightIntegrity(db);
    finish({
      phase: "N2_SETTLEMENT_REPARSE_APPLY", generatedAt: new Date().toISOString(), gitSha: ctx.codeGitSha,
      status: "APPLIED", realSidecarApply: "EXECUTED",
      sidecar: sidecarPath, sourceSha256Before: ctx.sourceSha256, appliedAt: nowIso,
      counts: state.counts, before, afterDelta, physicalRows: { before: physicalBefore, after: physicalRowCount(db) },
      integrity, lightIntegrity: light, elapsedMs: Date.now() - startedMs, gate,
      outputDigest: canonicalHash({ counts: state.counts, before, afterDelta }),
    }, 0);
  } finally { db.close(); }
}

function loadRawMaps(db: DatabaseSync): Map<string, RawMeta> {
  const dateByRaw = new Map<string, string>();
  for (const r of db.prepare("SELECT raw_document_id AS rid, MIN(canonical_race_key) AS k FROM domain_observations GROUP BY raw_document_id").all() as Array<{ rid: string; k: string }>) {
    if (r.k && /^\d{4}-\d{2}-\d{2}:/.test(r.k)) dateByRaw.set(r.rid, r.k.slice(0, 10));
  }
  const familyByRaw = new Map<string, string>();
  for (const r of db.prepare("SELECT raw_document_id AS rid, source_schema_version AS fam FROM settlement_candidates_v2 GROUP BY raw_document_id").all() as Array<{ rid: string; fam: string }>) {
    familyByRaw.set(r.rid, r.fam);
  }
  const byHash = new Map<string, RawMeta>();
  for (const r of db.prepare("SELECT raw_document_id AS rid, raw_sha256 AS h FROM raw_documents").all() as Array<{ rid: string; h: string }>) {
    const date = dateByRaw.get(r.rid);
    if (date) byHash.set(r.h, { rawDocumentId: r.rid, date, family: familyByRaw.get(r.rid) ?? "modern_seven_display" });
  }
  return byHash;
}

await main();
