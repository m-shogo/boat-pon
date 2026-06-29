import { existsSync, readFileSync } from "node:fs";

export type EnvLoadResult = {
  file: string;
  loaded: string[];
  skipped: string[];
};

export function parseEnvFileContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eqIndex = normalized.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = normalized.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = normalized.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      if (normalized.slice(eqIndex + 1).trim().startsWith('"')) {
        value = value
          .replaceAll("\\n", "\n")
          .replaceAll("\\r", "\r")
          .replaceAll("\\t", "\t")
          .replaceAll('\\"', '"')
          .replaceAll("\\\\", "\\");
      }
    } else {
      const commentIndex = value.search(/\s#/);
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trimEnd();
    }

    values[key] = value;
  }

  return values;
}

export function loadEnvFiles(files = [".env"]): EnvLoadResult[] {
  const results: EnvLoadResult[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const parsed = parseEnvFileContent(readFileSync(file, "utf8"));
    const loaded: string[] = [];
    const skipped: string[] = [];

    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] != null) {
        skipped.push(key);
        continue;
      }
      process.env[key] = value;
      loaded.push(key);
    }

    results.push({ file, loaded, skipped });
  }
  return results;
}
