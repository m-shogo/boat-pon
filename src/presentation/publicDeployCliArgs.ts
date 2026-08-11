export type PublicDeployCliArgs = {
  dist: string;
  static: string;
  output: string;
  snapshot?: string;
};

const ALLOWED_KEYS = new Set(["dist", "static", "output", "snapshot"]);

export function parsePublicDeployCliArgs(values: string[]): PublicDeployCliArgs {
  const parsed: Record<string, string> = {};

  for (const value of values) {
    if (!value.startsWith("--") || !value.includes("=")) {
      throw new Error(`invalid argument: ${value}`);
    }

    const [key, ...rest] = value.slice(2).split("=");
    const content = rest.join("=").trim();
    if (!key || !content) throw new Error(`invalid argument: ${value}`);
    if (!ALLOWED_KEYS.has(key)) throw new Error(`unknown argument: --${key}`);
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      throw new Error(`duplicate argument: --${key}`);
    }
    parsed[key] = content;
  }

  return {
    dist: required(parsed, "dist"),
    static: required(parsed, "static"),
    output: required(parsed, "output"),
    ...(parsed.snapshot ? { snapshot: parsed.snapshot } : {}),
  };
}

function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) throw new Error(`--${key}=<path> is required`);
  return value;
}
