/**
 * run-roi-mechanism-skip-filters-safe.ts — research-only compatibility runner.
 * Delegate to the canonical fail-closed entrypoint so the official-settlement
 * preflight cannot diverge from the supported analyzer path.
 */

await import("./analyze-roi-mechanism-skip-filters");
