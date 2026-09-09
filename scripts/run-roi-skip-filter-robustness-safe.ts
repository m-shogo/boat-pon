/**
 * run-roi-skip-filter-robustness-safe.ts — research-only compatibility runner.
 * Delegate to the canonical fail-closed entrypoint so the official-settlement
 * preflight cannot diverge from the supported analyzer path.
 */

export {};
await import("./analyze-roi-skip-filter-robustness");
