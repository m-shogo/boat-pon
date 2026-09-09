import { execFileSync } from "node:child_process";

execFileSync("pnpm", ["tsx", "scripts/analyze-all-bet-types-roi.ts"], {
  stdio: "inherit",
  env: { ...process.env },
});
