import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * A production composition that passes no `metaFetch` reaches no Meta (tests/integration/no-meta.setup.ts).
 *
 * The case that found it (2026-11-10): the warmth run (`QUEUES.faces`, src/main.ts) fired during telegram.test.ts,
 * whose composition passes no `metaFetch`, and looked up the profile photo of a customer an earlier file's Meta
 * workspace had left behind — a connect to graph.facebook.com. Here the job is forced rather than waited for: a
 * workspace with a live Meta account and an Instagram customer due a look, a composition with no `metaFetch`, one
 * faces job. The look must reach the setup's fake (and so no network), and the job still runs to its end.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `fa1e0000-0000-4000-8000-${RUN}0001`;
const CREDENTIAL_KEY = 'c'.repeat(64);
const CUSTOMER = `ig-nometa-${RUN}`;
const PAGE = `77${RUN.replace(/[^0-9]/g, '3')}0001`.slice(0, 14);

d('no Meta by default: a composition with no metaFetch (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let prod: Awaited<ReturnType<typeof import('../../src/main.js')['buildProduction']>> | undefined;
  let admin: pg.Client;
  let client = '';

  beforeAll(async () => {
    const { deriveKey, encryptSecret } = await import('../../src/security/credentials.js');
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, 'No Meta Co')`, [BIZ]);
    // A Page that answers, its token sealed with this composition's key: the warmth run may look.
    await admin.query(
      `insert into meta_accounts (business_id, page_id, page_name, token_ciphertext, fingerprint, scopes, connected_by)
       values ($1, $2, 'No Meta Page', $3, 'abcdefabcdef', 'pages_messaging', 'test')`,
      [BIZ, PAGE, encryptSecret(`page-token-${RUN}`, deriveKey(CREDENTIAL_KEY))]);
    // Seen in the future, so it is among the first the run looks at whatever else the database holds.
    client = (await admin.query(`insert into clients (business_id, display_name, last_seen_at) values ($1, 'Nadia', now() + interval '2 days') returning id::text as id`,
      [BIZ])).rows[0].id as string;
    await admin.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, 'instagram', $2)`, [client, CUSTOMER]);

    const { buildProduction } = await import('../../src/main.js');
    const { offlineModels } = await import('../pipeline/fakes.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const sim = whatsappSimulator([], { tag: `nm${RUN}` });
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real', META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'no-meta-verify-token', CREDENTIAL_KEY, PORT: 0,
    }, { adapter: sim.adapter, logger: false, models: offlineModels() });
  }, 60_000);

  afterAll(async () => {
    await prod?.close();
    // Nothing left for the next file's warmth run.
    await admin?.query(`update meta_accounts set archived_at = now(), archived_by = 'test' where business_id = $1 and archived_at is null`, [BIZ]);
    await admin?.end();
  }, 60_000);

  it('the warmth run, forced, asks the fake for the customer\'s photo and the look is recorded as failed', async () => {
    const { QUEUES } = await import('../../src/queue/boss.js');
    const before = (globalThis.__noMetaCalls ?? []).length;
    await prod!.boss.send(QUEUES.faces, {});
    const end = Date.now() + 60_000;
    let state: string | undefined;
    while (Date.now() < end) {
      state = (await admin.query(`select state from client_faces where client_id = $1`, [client])).rows[0]?.state as string | undefined;
      if (state) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(state).toBe('failed');
    const asked = (globalThis.__noMetaCalls ?? []).slice(before).map((c) => c.url);
    expect(asked).toContain(`https://graph.facebook.com/v23.0/${CUSTOMER}?fields=profile_pic`);
  });

});
