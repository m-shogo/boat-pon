/** Research-only Forward Vault compatibility wrapper for Node child fixtures.
 * Reuse the shared research-governance child environment guardrail.
 * Neither this wrapper nor its delegate isolates the parent runner,
 * sanitizes all environment variables, or authenticates evidence.
 */
import { isolatedResearchNodeChildEnv } from "./researchNodeChildEnv.js";

export function isolatedForwardVaultNodeChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return isolatedResearchNodeChildEnv(source);
}

