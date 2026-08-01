import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureOfficialProgramObservation } from "./n2OfficialProgramObservation";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";

function context() {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-collector-"));
  const db = openSidecarDatabase(join(dir, "sidecar.sqlite"));
  initializeSidecarSchema(db, "2004-01-01T01:05:00Z");
  const rawRoot = join(dir, "raw");
  const repository = new ResearchReplayRepository(db, new RawStore(rawRoot), undefined, () => "2004-01-01T01:05:00Z");
  return { dir, db, rawRoot, repository };
}

function programRaw(): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: index === 0 ? "A1" : "B1",
      nationalWinRate: 6 + index / 10,
      nationalTop2Rate: 40 + index,
      localWinRate: 5 + index / 10,
      localTop2Rate: 35 + index,
      motorTop2Rate: 30 + index,
      boatTop2Rate: 28 + index,
    })),
  });
}

function captureInput(repository: ResearchReplayRepository, rawJson = programRaw()) {
  return {
    repository,
    logicalRequestGroupId: "program-20040101-01-01",
    canonicalRaceKey: "2004-01-01:01:R1",
    sourceUrl: "https://example.invalid/program?race=1&token=secret",
    requestStartedAt: "2004-01-01T01:01:58Z",
    responseHeadersReceivedAt: "2004-01-01T01:01:59Z",
    bodyCompletedAt: "2004-01-01T01:02:00Z",
    sourcePublishedAt: "2004-01-01T01:00:00Z",
    sourceObservedAt: "2004-01-01T01:02:00Z",
    firstSeenAt: "2004-01-01T01:03:00Z",
    rawJson,
    httpStatus: 200,
    responseHeaders: { "content-type": "application/json", authorization: "secret" },
  };
}

test("collector adapter closes capture through typed observation with byte-exact evidence", () => {
  const ctx = context();
  try {
    const result = captureOfficialProgramObservation({
      ...captureInput(ctx.repository),
      captureAttemptId: "capture-program",
      captureStartedEventId: "event-started",
      responseHeadersEventId: "event-headers",
      bodyCompletedEventId: "event-body",
      rawDocumentId: "raw-program",
      parseRunId: "parse-program",
      observationId: "obs-program",
    });
    assert.equal(ctx.repository.captureState(result.captureAttemptId), "succeeded");
    assert.equal(result.parse.status, "success");
    assert.equal(readFileSync(join(ctx.rawRoot, result.relativePath), "utf8"), programRaw());
    const attempt = ctx.db.prepare(`
      SELECT source_url_redacted FROM capture_attempts WHERE capture_attempt_id = ?
    `).get(result.captureAttemptId) as { source_url_redacted: string };
    assert.equal(attempt.source_url_redacted.includes("secret"), false);
    const headers = ctx.db.prepare(`
      SELECT response_header_metadata FROM capture_attempt_events WHERE event_id = 'event-headers'
    `).get() as { response_header_metadata: string };
    assert.deepEqual(JSON.parse(headers.response_header_metadata), { "content-type": "application/json" });
    const link = ctx.db.prepare(`
      SELECT raw_document_id, body_completed_event_id FROM capture_raw_links WHERE capture_attempt_id = ?
    `).get(result.captureAttemptId) as { raw_document_id: string; body_completed_event_id: string };
    assert.equal(link.raw_document_id, result.rawDocumentId);
    assert.equal(link.body_completed_event_id, result.bodyCompletedEventId);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM domain_observations").get() as { n: number }).n, 1);
  } finally {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test("parse failure remains a successful capture with an error parse run", () => {
  const ctx = context();
  try {
    const result = captureOfficialProgramObservation(captureInput(ctx.repository, "{invalid-json"));
    assert.equal(ctx.repository.captureState(result.captureAttemptId), "succeeded");
    assert.equal(result.parse.status, "error");
    assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM capture_raw_links").get() as { n: number }).n, 1);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM domain_observations").get() as { n: number }).n, 0);
  } finally {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});

test("capture and raw-link time/byte inconsistencies fail closed", () => {
  const ctx = context();
  try {
    assert.throws(() => captureOfficialProgramObservation({
      ...captureInput(ctx.repository),
      sourceObservedAt: "2004-01-01T01:01:59Z",
    }), /observation must equal completed body time/);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM capture_attempts").get() as { n: number }).n, 0);

    const attempt = ctx.repository.createCaptureAttempt({
      logicalRequestGroupId: "mismatch",
      sourceUrl: "https://example.invalid/program",
      method: "GET",
      requestStartedAt: "2004-01-01T01:00:00Z",
      sourceType: "official_program",
    });
    assert.throws(() => ctx.repository.addCaptureEvent({
      captureAttemptId: attempt,
      eventKind: "capture_started",
      occurredAt: "2003-12-31T23:59:59Z",
    }), /precedes request start/);
    assert.throws(() => ctx.repository.addCaptureEvent({
      captureAttemptId: attempt,
      eventKind: "body_completed",
      occurredAt: "2004-01-01T01:00:01Z",
    }), /byte count required/);
    const bodyEvent = ctx.repository.addCaptureEvent({
      captureAttemptId: attempt,
      eventKind: "body_completed",
      occurredAt: "2004-01-01T01:00:01Z",
      byteCount: 1,
    });
    const raw = ctx.repository.recordRawDocument({
      bytes: Buffer.from("abc"),
      contentType: "text/plain",
      charset: "utf-8",
    });
    assert.throws(() => ctx.repository.linkCaptureToRaw({
      captureAttemptId: attempt,
      rawDocumentId: raw.rawDocumentId,
      bodyCompletedEventId: bodyEvent,
      linkedAt: "2004-01-01T01:00:01Z",
    }), /byte count does not match/);
  } finally {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  }
});
