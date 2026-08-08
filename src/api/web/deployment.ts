/**
 * M17.1 — "which build am I actually looking at?"
 *
 * Deployment facts read from the process environment, never invented: when a
 * value is not reported by the host, it stays null and the UI says so rather
 * than guessing. This is deliberately NOT on /health — a public probe should
 * not advertise the running commit — so it renders only on the owner-
 * authenticated Pilot readiness surface.
 *
 * Pure: the environment and the clock are arguments, so it is fully testable.
 */

export type DeploymentInfo = {
  /** Short commit of the running build, or null when the host does not report it. */
  readonly commit: string | null;
  readonly branch: string | null;
  /** Which deployment target this process believes it is. */
  readonly environment: string;
  /** Messaging provider mode — 'disabled' until the channel is switched on. */
  readonly provider: string;
  /** When THIS process started (uptime is the only honest "deployed at" we have). */
  readonly startedAt: Date;
  readonly nodeVersion: string;
  /**
   * M27 — is the owner's login code stable across deploys?
   *
   * `OWNER_ACCESS_CODE` unset means main.ts generates a random one at every
   * boot and logs it once. The owner is then locked out of her own product the
   * next time anything deploys, and the only way back in is reading a log line.
   * This cost a real release: an authenticated verification failed with "no
   * session cookie" and the cause was invisible from every surface.
   *
   * It is on the OPERATOR's panel, never the owner's — she cannot fix it, and
   * the value itself is never rendered anywhere.
   */
  readonly ownerCodeStable: boolean;
  /**
   * Is the credential encryption key stable across deploys?
   *
   * `CREDENTIAL_KEY` unset means main.ts generates one at boot and writes it to
   * .env, which does not survive a deploy. The next boot generates a different
   * key, and at that moment every stored WhatsApp credential becomes
   * permanently undecryptable and every owner session is invalidated — the
   * channel goes dark and the owner is logged out of the product at once.
   *
   * Strictly worse than `ownerCodeStable` above: a lost access code is
   * recoverable from a log line, a lost credential key is not recoverable at
   * all. In production the boot guard refuses to serve, so a running production
   * process should always report this true; it is surfaced anyway because a
   * false here on any other environment is the warning that the same
   * installation will lose its credentials the moment it is promoted.
   *
   * Operator panel only, and presence only — the key is never rendered.
   */
  readonly credentialKeyStable: boolean;
};

/** Railway's variables first, then generic CI names — first non-empty wins. */
const pick = (env: NodeJS.ProcessEnv, ...names: readonly string[]): string | null => {
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) return v;
  }
  return null;
};

export function readDeployment(
  env: NodeJS.ProcessEnv, now: Date, uptimeSeconds: number,
): DeploymentInfo {
  const sha = pick(env, 'RAILWAY_GIT_COMMIT_SHA', 'GIT_COMMIT_SHA', 'SOURCE_VERSION', 'COMMIT_SHA');
  return {
    commit: sha ? sha.slice(0, 7) : null,
    branch: pick(env, 'RAILWAY_GIT_BRANCH', 'GIT_BRANCH'),
    environment: pick(env, 'RAILWAY_ENVIRONMENT_NAME', 'NODE_ENV') ?? 'local',
    provider: env['WHATSAPP_PROVIDER']?.trim() || 'disabled',
    startedAt: new Date(now.getTime() - Math.max(0, uptimeSeconds) * 1000),
    nodeVersion: process.versions.node,
    // Presence only — neither value is read here and neither is ever rendered.
    ownerCodeStable: (env['OWNER_ACCESS_CODE'] ?? '').trim() !== '',
    credentialKeyStable: (env['CREDENTIAL_KEY'] ?? '').trim() !== '',
  };
}
