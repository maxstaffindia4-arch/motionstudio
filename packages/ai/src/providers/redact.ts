/**
 * Replace every occurrence of a secret with a placeholder. Used to scrub
 * API keys out of error messages before they can reach logs/traces/tests.
 */
export function redactSecrets(text: string, secrets: Array<string | undefined | null>): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 4) continue;
    out = out.split(s).join('[redacted]');
  }
  return out;
}
