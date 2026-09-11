/**
 * run-roi-skip-policy-simulation-safe.ts — research-only compatibility runner.
 * Delegate to the canonical fail-closed entrypoint so settlement preflight,
 * isolated DB handoff, output identity checks, and atomic publication cannot
 * diverge from the supported analyzer path.
 */

export {};
await import("./analyze-roi-skip-policy-simulation");
