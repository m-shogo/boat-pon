import { join, resolve } from "node:path";
import {
  recordApprovalGrant,
  recordApprovalLifecycle,
} from "../src/research-replay/approval";
import {
  initializeRolloutSchema,
  openRolloutDatabase,
} from "../src/research-replay/schema";

function arg(name: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  const value = found?.slice(prefix.length) ?? "";
  if (value.trim() === "") throw new Error(`required CLI argument: ${prefix}<value>`);
  return value;
}

function optionalArg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const event = arg("event");
const root = resolve(optionalArg("root") ?? process.cwd());
const sidecarPath = resolve(optionalArg("sidecar") ?? join(root, "data", "research-replay.sqlite"));
const recordedAt = new Date().toISOString();
const db = openRolloutDatabase(sidecarPath);
try {
  initializeRolloutSchema(db, recordedAt);
  if (event === "grant") {
    const approvalMode = arg("approval-mode");
    if (approvalMode !== "production" && approvalMode !== "simulated") {
      throw new Error("approval-mode must be production or simulated");
    }
    const id = recordApprovalGrant(db, {
      approvalId: arg("approval-id"),
      approvalScope: arg("scope"),
      approvalSource: arg("source"),
      approvalReference: arg("reference"),
      targetStage: arg("target-stage"),
      targetSchemaVersion: arg("target-schema"),
      targetContractVersion: arg("target-contract"),
      approvedAt: arg("approved-at"),
      approvalMode,
    }, recordedAt);
    console.log(JSON.stringify({ event: "grant", approvalId: id, sidecarPath }, null, 2));
  } else if (event === "revoke" || event === "supersede" || event === "legacy-disqualify") {
    const kind = event === "revoke"
      ? "revoked"
      : event === "supersede"
        ? "superseded"
        : "legacy_disqualified";
    const id = recordApprovalLifecycle(db, {
      lifecycleEventId: arg("event-id"),
      eventKind: kind,
      subjectApprovalId: arg("subject-approval-id"),
      replacementApprovalId: kind === "superseded" ? arg("replacement-approval-id") : null,
      reason: arg("reason"),
      source: arg("source"),
      reference: arg("reference"),
      occurredAt: arg("occurred-at"),
    }, recordedAt);
    console.log(JSON.stringify({ event: kind, lifecycleEventId: id, sidecarPath }, null, 2));
  } else {
    throw new Error("event must be grant, revoke, supersede, or legacy-disqualify");
  }
} finally {
  db.close();
}
