import { execFileSync } from "node:child_process";

execFileSync("pnpm", ["tsx", "scripts/analyze-skipvenue-switch-historical-closing-odds.ts"], {
  stdio: "inherit",
  env: { ...process.env },
});
