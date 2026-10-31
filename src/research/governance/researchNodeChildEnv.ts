/** Research-only Node subprocess fixture environment.
 * Node child_process inherits NODE_OPTIONS by default, including --require
 * and --import preloads that can run before the intended fixture command.
 * Copy the environment, remove that one ambient execution vector, and leave
 * the parent environment untouched. This is not a general sandbox or an
 * authentication boundary.
 */
export function isolatedResearchNodeChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.NODE_OPTIONS;
  return env;
}

