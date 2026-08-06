import {
  closeSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { readN2TrifectaPrivateCapturePlan } from "../src/research-replay/n2TrifectaPrivateCapturePlanReader";

const primaryDbPath = resolve(requiredArgument("db"));
const date = requiredArgument("date");
const venueCode = requiredArgument("venue");
const outputArgument = argument("output");
const outputPath = outputArgument ? resolve(outputArgument) : null;

function argument(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function writeExclusive(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
  } finally {
    closeSync(fd);
  }
}

const result = readN2TrifectaPrivateCapturePlan({
  primaryDbPath,
  date,
  venueCode,
});
const output = `${JSON.stringify(result, null, 2)}\n`;
console.log(output.trimEnd());

if (outputPath) writeExclusive(outputPath, output);
if (result.status !== "PASS") process.exitCode = 3;
