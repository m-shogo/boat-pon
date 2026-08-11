import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicDeployCliArgs } from "./publicDeployCliArgs";

test("parsePublicDeployCliArgs accepts the canonical deploy flags", () => {
  assert.deepEqual(
    parsePublicDeployCliArgs([
      "--dist=dist-public-dashboard",
      "--static=public-site",
      "--output=dist-public-deploy",
      "--snapshot=public-snapshots",
    ]),
    {
      dist: "dist-public-dashboard",
      static: "public-site",
      output: "dist-public-deploy",
      snapshot: "public-snapshots",
    },
  );
});

test("parsePublicDeployCliArgs rejects duplicate destructive output flags", () => {
  assert.throws(
    () => parsePublicDeployCliArgs([
      "--dist=dist-public-dashboard",
      "--static=public-site",
      "--output=dist-public-deploy",
      "--output=dist-public-dashboard",
    ]),
    /duplicate argument: --output/,
  );
});

test("parsePublicDeployCliArgs rejects unknown flags instead of silently ignoring typos", () => {
  assert.throws(
    () => parsePublicDeployCliArgs([
      "--dist=dist-public-dashboard",
      "--static=public-site",
      "--output=dist-public-deploy",
      "--snapshop=public-snapshots",
    ]),
    /unknown argument: --snapshop/,
  );
});
