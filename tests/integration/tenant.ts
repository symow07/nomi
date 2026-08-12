import { DEMO_NAMESPACE, demoPhone } from '../../src/demo/factory.js';

/**
 * M34.8 — one tenant per RUN, for every integration file.
 *
 * THE PROBLEM THIS SOLVES IS ATTRIBUTION, NOT FLAKINESS. These suites gate RLS
 * tenant isolation, the activation and rollback drills, and refusal visibility.
 * Run twice against the same database they failed the second time, because they
 * approve drafts, add allowlist entries and activate channels on the SHARED demo
 * tenant and then assert on a pristine one. Once that is normal, a real
 * tenant-isolation regression looks exactly like the noise and gets waved
 * through as "that again".
 *
 * M22 already built the mechanism — `demoSeedSql(namespace)` re-issues the whole
 * factory under a different id block — and boot.test.ts already used it. What
 * was missing is that the other files did not, and that the fallback to the
 * shared tenant was silent. Both are fixed here.
 *
 * Seeding needs the MIGRATE role: RLS correctly refuses the app role a new
 * `businesses` row. Without MIGRATE_DATABASE_URL there is nothing to be done
 * except say so, loudly, once — a run that quietly degrades to the fragile path
 * is how this went unnoticed.
 */

const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];

/** True when this run owns its tenant and can be repeated safely. */
export const ISOLATED = MIGRATE_URL !== undefined;

/**
 * Eight hex characters, unique per run. Every demo id derives from
 * DEMO_NAMESPACE, so re-namespacing is a single substitution (factory.ts).
 */
export const RUN_NS = ISOLATED
  ? `f${Date.now().toString(16).slice(-7)}`
  : DEMO_NAMESPACE;

/** An id in this run's own block. `nsId('0000000000b1')` is its business. */
export const nsId = (suffix: string): string => `${RUN_NS}-0000-4000-8000-${suffix}`;

/** This run's business id — the demo factory's `…b1`, re-namespaced. */
export const RUN_BIZ = nsId('0000000000b1');

/**
 * A buyer phone in this run's block. `client_channels` is UNIQUE on
 * (channel, channel_user_id) GLOBALLY, so a shared number collides across runs.
 */
export const runPhone = (phone: string): string => demoPhone(phone, RUN_NS);

let warned = false;
let seeded = false;

/**
 * Seed this run's tenant. Idempotent per process, and a no-op when the run is
 * not isolated — in which case it warns once, so a confusing second-run failure
 * is attributable at a glance instead of being mistaken for a regression.
 */
export async function seedRunTenant(): Promise<void> {
  if (!ISOLATED) {
    if (!warned) {
      warned = true;
      console.warn(
        '\n  ⚠ MIGRATE_DATABASE_URL is not set, so these tests share the demo tenant.\n' +
        '    They mutate it, so a SECOND run against the same database will fail in\n' +
        '    ways that look like regressions and are not. Set MIGRATE_DATABASE_URL\n' +
        '    to give each run a tenant of its own.\n',
      );
    }
    return;
  }
  if (seeded) return;
  seeded = true;

  const { demoSeedSql } = await import('../../src/demo/factory.js');
  const { demoTrustSeedSql } = await import('../../src/demo/trust.js');
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: MIGRATE_URL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(demoSeedSql(RUN_NS));
    await client.query(demoTrustSeedSql(RUN_NS));
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}
