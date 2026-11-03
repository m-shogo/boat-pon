import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// Static owner-review sentinel for a previously recorded conditional log sink.
// No workflow dispatch, private path, protected N2, or live runner access.
// This test deliberately pins the current exposure; an approved remediation
// must replace the sentinel with assertions for the new safe behavior.
const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

test("legacy manual free-form reference reaches full request log before validation", () => {
  const workflow = read(".github/workflows/boat-pon-local-research.yml");
  const builder = read("scripts/build-research-request.mjs");

  const buildStep = workflow.indexOf("- name: Build request from inputs (validated, no shell interpolation)");
  const echo = workflow.indexOf('cat data/tmp/automation/request.json', buildStep);
  const validation = workflow.indexOf("- name: Validate request (strict schema + digest)", buildStep);
  assert.ok(buildStep >= 0 && echo > buildStep && validation > echo,
    "legacy input/log/validation order changed; operations-owner review required");

  assert.ok(workflow.includes("REQUEST_REFERENCE: ${{ inputs.request_reference }}"));
  assert.ok(workflow.includes("node scripts/build-research-request.mjs > data/tmp/automation/request.json"));
  assert.ok(builder.includes('if (requestReference && !/^[0-9A-Za-z._:/# -]{1,200}$/.test(requestReference)) fail("request_reference");'));
  assert.ok(builder.includes("...(requestReference ? { requestReference } : {}),"));
  assert.ok(builder.includes("process.stdout.write("));

  // These are opaque, synthetic labels, never private or real filesystem paths.
  const admitted = /^[0-9A-Za-z._:/# -]{1,200}$/u;
  for (const label of ["opaque-id", "case:opaque/segment", "case#section"]) {
    assert.equal(admitted.test(label), true, label);
  }
  for (const label of ["", "opaque?query", "x".repeat(201)]) {
    assert.equal(admitted.test(label), false, label.slice(0, 32));
  }

  // This proves conditional source reachability, not an observed data leak,
  // workflow enabled state, runner availability, or a successful log write.
});
