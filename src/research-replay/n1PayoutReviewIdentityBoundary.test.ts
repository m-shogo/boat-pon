import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/verify-n1-payout-review.mjs", "utf8");

test("N1 payout review verifies canonical artifact identity before reading", () => {
  const reportIdentity = source.indexOf("N1_PAYOUT_REVIEW_REPORT_IDENTITY_INVALID");
  const reportRead = source.indexOf('readFileSync(reportReadPath, "utf8")');
  const docIdentity = source.indexOf("N1_PAYOUT_REVIEW_DOC_IDENTITY_INVALID");
  const docRead = source.indexOf('readFileSync(docReadPath, "utf8")');

  assert.ok(reportIdentity >= 0, "readiness report must have an opaque identity failure code");
  assert.ok(reportRead > reportIdentity, "readiness report must be identity-verified before read/parse");
  assert.ok(docIdentity >= 0, "review document must have an opaque identity failure code");
  assert.ok(docRead > docIdentity, "review document must be identity-verified before read");
  assert.match(source, /leaf\.isFile\(\)/u);
  assert.match(source, /leaf\.nlink !== 1/u);
  assert.match(source, /realPath !== lexicalPath/u);
  assert.doesNotMatch(source, /JSON\.parse\(readFileSync\(reportPath/u);
  assert.doesNotMatch(source, /readFileSync\(docPath,\s*"utf8"\)/u);
});
