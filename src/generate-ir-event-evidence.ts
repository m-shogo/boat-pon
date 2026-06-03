import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { load } from "js-yaml";
import { todayJst } from "./date.js";
import type { IrEventEvidence } from "./pro-types.js";

type RawEvent = {
  type?: string;
  eventType?: string;
  label?: string;
  title?: string;
  date?: string | null;
  eventDate?: string | null;
  publishedAt?: string | null;
  sourceUrl?: string | null;
  sourceStatus?: string | null;
  impact?: string | null;
  notes?: string[];
};

type RawCompany = { name?: string; events?: RawEvent[] };
type RawIrEvents = { companies?: Record<string, RawCompany> };

function readYaml<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return load(readFileSync(path, "utf-8")) as T;
}

function normalizeEventType(type: string | undefined): IrEventEvidence["eventType"] {
  const t = (type ?? "").toLowerCase();
  if (/earning|決算/.test(t)) return "earnings";
  if (/revision|修正|guidance/.test(t)) return "guidance_revision";
  if (/buyback|自社株/.test(t)) return "buyback";
  if (/dividend|配当/.test(t)) return "dividend";
  if (/capital|資本政策/.test(t)) return "capital_policy";
  if (/meeting|総会/.test(t)) return "shareholder_meeting";
  if (/medium|中計/.test(t)) return "medium_term_plan";
  if (/offering|増資|希薄化/.test(t)) return "offering";
  if (/tob|買収/.test(t)) return "tob";
  if (/risk|注意|監査|不正|延期/.test(t)) return "risk_disclosure";
  return "unknown";
}

function normalizeSourceStatus(event: RawEvent): IrEventEvidence["sourceStatus"] {
  const status = String(event.sourceStatus ?? "").toLowerCase();
  if (event.sourceUrl && !/required|missing|unknown|要確認/.test(status)) return "confirmed";
  if (/required|要確認|check/.test(status)) return "official_check_required";
  return event.sourceUrl ? "official_check_required" : "missing";
}

function normalizeImpact(value: string | null | undefined): IrEventEvidence["impact"] {
  const v = String(value ?? "").toLowerCase();
  if (/positive|good|好|上方|増配|自社株/.test(v)) return "positive";
  if (/negative|bad|悪|下方|減配|増資|希薄/.test(v)) return "negative";
  if (/neutral|中立/.test(v)) return "neutral";
  return "unknown";
}

function toEvidence(code: string, rawCompany: RawCompany, event: RawEvent): IrEventEvidence {
  const sourceStatus = normalizeSourceStatus(event);
  const eventType = normalizeEventType(event.eventType ?? event.type ?? event.label ?? event.title);
  return {
    code,
    name: rawCompany.name ?? code,
    eventType,
    title: event.title ?? event.label ?? event.type ?? "IRイベント未分類",
    publishedAt: event.publishedAt ?? null,
    eventDate: event.eventDate ?? event.date ?? null,
    sourceUrl: event.sourceUrl ?? null,
    sourceStatus,
    impact: normalizeImpact(event.impact),
    confidence: sourceStatus === "confirmed" ? 0.8 : sourceStatus === "official_check_required" ? 0.35 : 0.15,
    notes: [
      ...(event.notes ?? []),
      ...(sourceStatus === "confirmed" ? [] : ["公式URLまたは本文確認が未完了"]),
    ],
  };
}

function main() {
  const raw = readYaml<RawIrEvents>("config/company-ir-events.yml", {});
  const events: IrEventEvidence[] = [];
  for (const [code, company] of Object.entries(raw.companies ?? {})) {
    for (const event of company.events ?? []) events.push(toEvidence(code, company, event));
  }
  mkdirSync("data", { recursive: true });
  writeFileSync("data/ir_event_evidence_latest.json", JSON.stringify({ generatedAt: todayJst(), events }, null, 2), "utf-8");
  console.log(`IR event evidence generated: ${events.length}`);
}

main();
