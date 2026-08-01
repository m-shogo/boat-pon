import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  observationCategory,
  semanticPayloadHash,
  validateTypedPayload,
  type OfficialProgramPayload,
} from "./domain";

function fixture(): OfficialProgramPayload {
  return JSON.parse(readFileSync(new URL("./fixtures/official-program.payload.json", import.meta.url), "utf8")) as OfficialProgramPayload;
}

test("official_program is a strict pre-race typed payload with deterministic hash", () => {
  const payload = fixture();
  assert.equal(observationCategory("official_program"), "pre_race");
  assert.deepEqual(validateTypedPayload("official_program", payload), payload);
  assert.equal(
    semanticPayloadHash("official_program", payload),
    "06be00c42eaaaa9f5845d29e7af30a49740bc02b6f3694bcfe3afac7558cdb82",
  );
});

test("official_program rejects duplicate courses, unknown fields, and impossible rates", () => {
  const payload = fixture();
  assert.throws(() => validateTypedPayload("official_program", {
    ...payload,
    boats: payload.boats.map((boat, index) => index === 1 ? { ...boat, course: 1 } : boat),
  }), /duplicate official program course/);
  assert.throws(() => validateTypedPayload("official_program", { ...payload, importedAt: payload.observedAt }));
  assert.throws(() => validateTypedPayload("official_program", {
    ...payload,
    boats: payload.boats.map((boat, index) => index === 0 ? { ...boat, nationalWinRate: 10.1 } : boat),
  }), /nationalWinRate out of range/);
});

test("official_program rejects non-canonical race identity and invalid timestamps", () => {
  const payload = fixture();
  assert.throws(() => validateTypedPayload("official_program", { ...payload, canonicalRaceKey: "2026-05-20:01:01" }));
  assert.throws(() => validateTypedPayload("official_program", { ...payload, observedAt: "not-a-time" }));
});
