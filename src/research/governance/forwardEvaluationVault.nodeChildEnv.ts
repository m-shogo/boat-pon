/** Research-only Node child-process fixture environment.
 * Avoid inherited NODE_OPTIONS preloads/imports changing synthetic child
 * handshakes or filesystem behavior. This does not isolate the parent runner,
 * sanitize every environment variable, or authenticate any evidence.
 */
export function isolatedForwardVaultNodeChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.NODE_OPTIONS;
  return env;
}
