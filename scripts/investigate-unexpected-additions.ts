// N2 unexpected_addition / ambiguous_non_defect 完全調査（read-only, immutable source）。
//
// full reparse で保留された unexpected_addition（v2 が非特払い settled candidate を導出したが
// 対応する active v1 candidate が無い）と ambiguous_non_defect を、実 sidecar を immutable/read-only で
// 走査して具体的に特定・分類する。DB/archive/sidecar へ一切書き込まない。
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseOfficialResultDetail } from "../src/domain/officialResultDetailParser";
import { listArchiveFiles } from "../src/research-replay/n1Backfill";
import { classifyUnexpectedAddition, deriveSettlementCandidates, decideReparseAction, candidateKey } from "../src/research-replay/n2SettlementReparse";
import type { ResultKind, SettlementBetType, SettlementStatus } from "../src/research-replay/settlement";
import { loadActiveState, loadSourceDuplicateSet, type RawMeta } from "../src/research-replay/n2SettlementReparseEngine";

const root = resolve(process.cwd());
const arg = (n: string): string | null => {
  const d = process.argv.find((v) => v.startsWith(`${n}=`));
  if (d) return d.slice(n.length + 1);
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const sourcePath = resolve(arg("--source-sidecar") ?? join(root, "data", "research-replay.sqlite"));
const archiveRoot = resolve(arg("--archive-root") ?? join(root, "data", "raw", "official", "results"));
const reportDir = resolve(arg("--report-dir") ?? join(root, "reports", "n2"));
const reportName = arg("--report-name") ?? "unexpected-additions-audit";
const limit = arg("--limit") ? Number(arg("--limit")) : null;

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
function loadRawMaps(db: DatabaseSync): { byHash: Map<string, RawMeta>; sourceDup: Set<string> } {
  const sourceDup = loadSourceDuplicateSet(db);
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
  return { byHash, sourceDup };
}

type Finding = {
  action: "unexpected_addition" | "ambiguous_non_defect";
  raceKey: string; date: string; venueCode: string; raceNo: string; betType: string;
  v2Status: string; v2ResultKind: string; v2PayoutLines: number; v2RefundLines: number; v2Selections: string[];
  rawDocumentId: string; rawSha256: string; archiveFile: string;
  allCandidatesForRaceBet: Array<{ candidateId: string; status: string; resultKind: string; revisionKind: string; parseRunId: string; parserVersion: string; observationId: string; isSourceDup: boolean; isSuperseded: boolean }>;
  classification: string; classificationReason: string; autoApplyEligible: boolean;
};

async function main(): Promise<void> {
  if (!existsSync(sourcePath)) throw new Error(`source not found: ${sourcePath}`);
  const uri = `${pathToFileURL(sourcePath).href}?immutable=1`;
  const db = new DatabaseSync(uri, { readOnly: true } as never);
  db.exec("PRAGMA query_only=ON");
  const startedAt = new Date().toISOString();
  try {
    const { byHash, sourceDup } = loadRawMaps(db);
    process.stderr.write("[investigate] loading active state (read-only scan) ...\n");
    const active = loadActiveState(db, sourceDup);
    process.stderr.write(`[investigate] active=${active.active.size} ambiguousKeys=${active.ambiguousKeys.size}\n`);

    const superseded = new Set<string>();
    for (const r of db.prepare("SELECT supersedes_candidate_id AS id FROM settlement_candidates_v2 WHERE supersedes_candidate_id IS NOT NULL").all() as Array<{ id: string }>) superseded.add(r.id);

    const allFiles = listArchiveFiles(archiveRoot);
    const files = limit ? allFiles.slice(0, limit) : allFiles;
    const findings: Finding[] = [];
    let ingested = 0; const processedRaw = new Set<string>();
    let unexpectedCount = 0; let ambiguousCount = 0;

    const candForRaceBetStmt = db.prepare(
      "SELECT candidate_id AS c, settlement_status AS s, result_kind AS r, revision_kind AS rev, parse_run_id AS pr, observation_id AS o FROM settlement_candidates_v2 WHERE canonical_race_key=? AND bet_type=?",
    );
    const parserVersionStmt = db.prepare("SELECT parser_version AS v FROM parse_runs WHERE parse_run_id=?");

    let processed = 0;
    for (const path of files) {
      processed += 1;
      if (processed % 1000 === 0) process.stderr.write(`[investigate] ${processed}/${files.length} files\n`);
      let bytes: Buffer;
      try { bytes = await unpack(path); } catch { continue; }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const meta = byHash.get(hash);
      if (!meta || processedRaw.has(meta.rawDocumentId)) continue;
      processedRaw.add(meta.rawDocumentId);
      ingested += 1;
      const parsed = parseOfficialResultDetail(new TextDecoder("shift_jis").decode(bytes), { date: meta.date, fetchedAt: "1970-01-01T00:00:00.000Z" });
      for (const cand of deriveSettlementCandidates(parsed)) {
        const key = candidateKey(cand.raceKey, cand.betType);
        if (active.ambiguousKeys.has(key)) continue;
        const existing = active.active.get(key) ?? null;
        const action = decideReparseAction(existing ? { candidateId: existing.candidateId, status: existing.status, resultKind: existing.resultKind, rawDocumentId: meta.rawDocumentId, sourceSchemaVersion: meta.family } : null, cand);
        if (action !== "unexpected_addition" && action !== "ambiguous_non_defect") continue;
        if (action === "unexpected_addition") unexpectedCount += 1; else ambiguousCount += 1;
        // ambiguous は件数だけ集計（0 想定）。unexpected は全件詳細を取る。
        if (action === "ambiguous_non_defect") continue;
        const parts = cand.raceKey.split(":");
        const allCands = (candForRaceBetStmt.all(cand.raceKey, cand.betType) as Array<{ c: string; s: string; r: string; rev: string; pr: string; o: string }>).map((row) => ({
          candidateId: row.c, status: row.s, resultKind: row.r, revisionKind: row.rev, parseRunId: row.pr,
          parserVersion: (parserVersionStmt.get(row.pr) as { v: string } | undefined)?.v ?? "unknown",
          observationId: row.o, isSourceDup: sourceDup.has(row.o), isSuperseded: superseded.has(row.c),
        }));
        const { classification, classificationReason, autoApplyEligible } = classify(cand, allCands);
        findings.push({
          action, raceKey: cand.raceKey, date: parts[0] ?? "", venueCode: parts[1] ?? "", raceNo: parts[2] ?? "", betType: cand.betType,
          v2Status: cand.status, v2ResultKind: cand.resultKind, v2PayoutLines: cand.payouts.length, v2RefundLines: cand.refunds.length,
          v2Selections: cand.payouts.map((p) => p.selection).slice(0, 12),
          rawDocumentId: meta.rawDocumentId, rawSha256: hash, archiveFile: basename(path),
          allCandidatesForRaceBet: allCands, classification, classificationReason, autoApplyEligible,
        });
      }
    }

    const payload = {
      phase: "N2_UNEXPECTED_ADDITION_AUDIT", generatedAt: new Date().toISOString(), startedAt,
      gitSha: process.env.GIT_SHA ?? null, scope: "read-only immutable-source scan; no DB/archive/sidecar write",
      sourceSidecar: sourcePath, archiveFilesScanned: files.length, ingested,
      unexpectedAdditionCount: unexpectedCount, ambiguousNonDefectCount: ambiguousCount,
      classificationContractVersion: "n2-reparse-addition-classification-v1",
      findings,
      autoApplyEligibleCount: findings.filter((f) => f.autoApplyEligible).length,
    };
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, `${reportName}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(join(reportDir, `${reportName}.md`), renderMd(payload));
    console.log(JSON.stringify({ ingested, unexpectedAdditionCount: unexpectedCount, ambiguousNonDefectCount: ambiguousCount, findings: findings.map((f) => ({ raceKey: f.raceKey, betType: f.betType, classification: f.classification, autoApplyEligible: f.autoApplyEligible })) }, null, 2));
  } finally { db.close(); }
}

// versioned classification（contract の classifyUnexpectedAddition を再利用）。
type Cls = { classification: string; classificationReason: string; autoApplyEligible: boolean };
function classify(cand: { betType: string; status: string; resultKind: string }, allCands: Finding["allCandidatesForRaceBet"]): Cls {
  const decision = classifyUnexpectedAddition({
    betType: cand.betType as SettlementBetType,
    v2Status: cand.status as SettlementStatus,
    v2ResultKind: cand.resultKind as ResultKind,
    anyCandidateForRaceBet: allCands.length > 0,
    anyActiveForRaceBet: allCands.some((c) => !c.isSourceDup && !c.isSuperseded),
  });
  return { classification: decision.classification, classificationReason: decision.reason, autoApplyEligible: decision.autoApplyEligible };
}

function renderMd(p: Record<string, any>): string {
  const rows = p.findings.map((f: Finding, i: number) => `### 保留 ${i + 1}: ${f.raceKey} / ${f.betType}

- classification: **${f.classification}** / auto-apply eligible: ${f.autoApplyEligible}
- reason: ${f.classificationReason}
- date/venue/race: ${f.date} / venue ${f.venueCode} / ${f.raceNo}
- v2: status=${f.v2Status}, result_kind=${f.v2ResultKind}, payout_lines=${f.v2PayoutLines}, refund_lines=${f.v2RefundLines}, selections=${JSON.stringify(f.v2Selections)}
- raw: doc ${f.rawDocumentId}, sha256 ${f.rawSha256.slice(0, 16)}…, archive ${f.archiveFile}
- sidecar candidates for race+bet: ${JSON.stringify(f.allCandidatesForRaceBet)}
`).join("\n");
  return `# Unexpected settlement additions audit（read-only）

- generated: ${p.generatedAt}
- scope: ${p.scope}
- source: ${p.sourceSidecar}
- archive files scanned: ${p.archiveFilesScanned} / ingested: ${p.ingested}
- unexpected_addition: **${p.unexpectedAdditionCount}** / ambiguous_non_defect: ${p.ambiguousNonDefectCount}
- classification contract: ${p.classificationContractVersion}
- auto-apply eligible: ${p.autoApplyEligibleCount}

${rows || "（該当なし）"}

> 期待値合わせで保留2件を強制訂正しない。auto-apply は raw provenance 完全・identity 一意・v2 semantics 正本一致・
> source duplicate でない・append-only lineage 構築可能・317,747件と同等の証拠強度、をすべて満たす場合のみ。
`;
}
await main();
