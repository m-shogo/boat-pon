import { execFileSync } from "node:child_process";

execFileSync("pnpm", ["tsx", "scripts/analyze-skip6r-switch-historical-closing-odds.ts"], {
  stdio: "inherit",
  env: { ...process.env },
});
