import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOfficialProgramObservationEnvelope,
  buildOfficialProgramPayload,
  N2_OFFICIAL_PROGRAM_PARSER_VERSION,
  N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
} from "./n2OfficialProgramObservation";

function rawJson(): string {
  return JSON.stringify({
    boats: [
      {
        course: "2",
        registrationNo: 4002,
        className: "A2",
        nationalWinRate: "6.2",
        nationalTop2Rate: "44.1",
        localWinRate: "",
        localTop2Rate: null,
        motorTop2Rate: "35.1",
        boatTop2Rate: 36,
      },
      {
        course: 1,
        registrationNo: "4001",
        className: "A1",
        nationalWinRate: 7.1,
        nationalTop2Rate: 55.2,
        localWinRate: 6.8,
        localTop2Rate: 50.1,
        motorTop2Rate: 40.2,
        boatTop2Rate: 38.4,
      },
    ],
  });
}

test("official program rawを決定順typed payloadへ正規化する", () => {
  const payload = buildOfficialProgramPayload({
    canonicalRaceKey: "2026-05-20:01:R1",
    observedAt: "2026-05-20T02:30:00Z",
    rawJson: rawJson(),
  });
  assert.deepEqual(payload.boats.map((boat) => boat.course), [1, 2]);
  assert.equal(payload.boats[1].registrationNo, "4002");
  assert.equal(payload.boats[1].nationalWinRate, 6.2);
  assert.equal(payload.boats[1].localWinRate, null);
  assert.equal(payload.boats[1].localTop2Rate, null);
});

test("official program capture envelopeにsource時刻とparser契約を固定する", () => {
  const envelope = buildOfficialProgramObservationEnvelope({
    canonicalRaceKey: "2026-05-20:01:R1",
    rawJson: rawJson(),
    sourcePublishedAt: "2026-05-20T02:29:00Z",
    sourceObservedAt: "2026-05-20T02:30:00Z",
    firstSeenAt: "2026-05-20T02:30:01Z",
  });
  assert.equal(envelope.sourceSchemaVersion, N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION);
  assert.equal(N2_OFFICIAL_PROGRAM_PARSER_VERSION, "n2-official-program-parser-v1");
  assert.equal(envelope.payloadType, "official_program");
  assert.equal(envelope.timingQuality, "source_exact");
  assert.equal(envelope.payload.observedAt, envelope.sourceObservedAt);
});

test("不正rate・重複course・未来のsource時刻をfail-closedにする", () => {
  const invalidRate = JSON.parse(rawJson()) as { boats: Array<Record<string, unknown>> };
  invalidRate.boats[0].nationalWinRate = "not-a-rate";
  assert.throws(() => buildOfficialProgramPayload({
    canonicalRaceKey: "2026-05-20:01:R1",
    observedAt: "2026-05-20T02:30:00Z",
    rawJson: JSON.stringify(invalidRate),
  }), /invalid official program nationalWinRate/);

  const duplicate = JSON.parse(rawJson()) as { boats: Array<Record<string, unknown>> };
  duplicate.boats[0].course = 1;
  assert.throws(() => buildOfficialProgramPayload({
    canonicalRaceKey: "2026-05-20:01:R1",
    observedAt: "2026-05-20T02:30:00Z",
    rawJson: JSON.stringify(duplicate),
  }), /duplicate official program course/);

  assert.throws(() => buildOfficialProgramObservationEnvelope({
    canonicalRaceKey: "2026-05-20:01:R1",
    rawJson: rawJson(),
    sourcePublishedAt: "2026-05-20T02:31:00Z",
    sourceObservedAt: "2026-05-20T02:30:00Z",
    firstSeenAt: "2026-05-20T02:30:01Z",
  }), /published after observation/);
});
