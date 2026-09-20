import { DEMO_NAMESPACE, demoPhone } from '../../src/demo/factory.js';
import { FLASH_COOKIE, readFlash } from '../../src/api/web/flash.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';

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

/**
 * Digits unique to a run, for the identities Postgres holds unique across ALL
 * tenants — `client_channels (channel, channel_user_id)` and
 * `channel_credentials (channel, external_ref)`, both `on conflict do nothing`
 * at their one writer. Taken from the run id's hex VALUE, not from whichever
 * of its characters happen to be digits: a run whose id held two digits used
 * to produce the same padded number as every other such run, the row then
 * belonged to an earlier tenant, and the insert quietly did nothing — which
 * read as "the conversation never appeared" thirty seconds later.
 */
export const runDigits = (run: string, length: number): string =>
  BigInt(`0x${run}`).toString().padStart(length, '7').slice(-length);

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
    // G21 — attribution again, for the one collision this scheme still has.
    // `client_channels` is unique on the number across every tenant, so a run
    // whose phone block matches one already seeded loses those rows silently
    // and its buyers become unreachable. That reads downstream as a broken
    // send path rather than as a clash of test data, so it is named here.
    const orphans = (await client.query(
      `select cl.display_name as name
         from clients cl
         left join client_channels cc on cc.client_id = cl.id and cc.channel = 'whatsapp'
        where cl.business_id = $1 and cc.client_id is null`, [RUN_BIZ])).rows;
    if (orphans.length) {
      throw new Error(
        `this run's phone block is already taken: ${orphans.map((r: { name: string }) => r.name).join(', ')} `
        + `have no client_channels row. Another tenant holds those numbers — re-run, which picks a new namespace.`,
      );
    }
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}

/**
 * A1 — what the app just told her, read the way a browser would.
 *
 * The notice used to be in the redirect's query string, so every file wrote
 * `new URL(location).searchParams.get('flash')` and read the finished sentence.
 * It rides a signed, one-shot cookie now (`src/api/web/flash.ts`), which is the
 * point: a URL is written to the access log, and anyone can compose one.
 *
 * These tests do not hold the session secret's twin, so this verifies the token
 * with the SAME secret the app under test was built with — the caller passes
 * it, exactly as it passes it to `registerWebApp`.
 */
export function flashSaid(
  res: { headers: Record<string, unknown> }, sessionSecret: string, locale: Locale = 'en',
): string {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
  const cookie = all.find((c) => c.startsWith(`${FLASH_COOKIE}=`));
  if (!cookie) return '';
  const token = cookie.slice(FLASH_COOKIE.length + 1).split(';')[0] ?? '';
  return readFlash(sessionSecret, token, locale, Date.now())?.text ?? '';
}

/** The same notice's tone — D5's half: did what she asked actually happen? */
export function flashWasRefusal(
  res: { headers: Record<string, unknown> }, sessionSecret: string,
): boolean {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
  const cookie = all.find((c) => c.startsWith(`${FLASH_COOKIE}=`));
  if (!cookie) return false;
  const token = cookie.slice(FLASH_COOKIE.length + 1).split(';')[0] ?? '';
  return readFlash(sessionSecret, token, 'en', Date.now())?.bad ?? false;
}
