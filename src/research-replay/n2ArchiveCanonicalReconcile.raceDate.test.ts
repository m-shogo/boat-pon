import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedResultDetail, RaceCondition, RacePayout } from "../domain/officialResultDetailParser";
import { deriveArchiveCandidates } from "./n2ArchiveCanonicalReconcile";

function parsed(date: string): ParsedResultDetail {
  const raceId = `${date}-住之江-01`;
  const condition: RaceCondition = {
    raceId,
    date,
    venue: "住之江",
    raceNo: 1,
    raceType: null,
    distanceM: null,
    weather: null,
    windDir: null,
    windMps: null,
    waveCm: null,
    kimarite: null,
    returned: false,
    source: "test",
    fetchedAt: "1970-01-01T00:00:00.000Z",
  };
  const payout: RacePayout = {
    raceId,
    date,
    venue: "住之江",
    raceNo: 1,
    betType: "trifecta",
    combination: "1-2-3",
    payoutYen: 1000,
    popularity: 1,
    returned: false,
    source: "test",
    fetchedAt: "1970-01-01T00:00:00.000Z",
  };
  return { conditions: [condition], entries: [], payouts: [payout] } as ParsedResultDetail;
}

test("archive reconciliation rejects impossible Gregorian race dates", () => {
  assert.deepEqual(deriveArchiveCandidates(parsed("2026-02-30")), []);
});

test("archive reconciliation preserves valid leap-day race identity", () => {
  const candidates = deriveArchiveCandidates(parsed("2028-02-29"));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].raceKey, "2028-02-29:12:R1");
});
