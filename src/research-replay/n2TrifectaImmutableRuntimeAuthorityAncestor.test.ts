import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  recordN2TrifectaImmutableRuntimeBlock,
  type N2TrifectaImmutableRuntimeAuthorityAudit,
  type N2TrifectaObservedRuntimeAuthority,
} from "./n2TrifectaImmutableRuntimeAuthority.js";

const audit: N2TrifectaImmutableRuntimeAuthorityAudit = {
  status: "BLOCKED",
  blockers: ["RUNTIME_HEAD_NOT_DETACHED"],
  authorizationMatched: true,
  authorityMatched: true,
  runtimeRootMatched: true,
  detachedHead: false,
  trackedWorktreeClean: true,
};

const observed: N2TrifectaObservedRuntimeAuthority = {
  actualAuthoritySha: "0123456789abcdef0123456789abcdef01234567",
  actualRuntimeRoot: "/tmp/boat-pon-runtime",
  detachedHead: false,
  trackedWorktreeClean: true,
};

test("runtime block evidence rejects a redirected private ancestor before writing", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-runtime-block-parent-"));
  const external = mkdtempSync(join(tmpdir(), "boat-pon-runtime-block-external-"));
  try {
    mkdirSync(join(root, "data/private"), { recursive: true, mode: 0o700 });
    symlinkSync(external, join(root, "data/private/trifecta-capture"), "dir");

    assert.throws(
      () => recordN2TrifectaImmutableRuntimeBlock({
        dataRoot: root,
        now: "2026-08-06T00:35:00.000Z",
        audit,
        binding: null,
        observed,
      }),
      /RUNTIME_BLOCK_PARENT_INVALID/,
    );

    assert.equal(existsSync(join(external, "status/runtime-authority-latest.json")), false);
    assert.equal(existsSync(join(external, "reports/runtime-authority")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
