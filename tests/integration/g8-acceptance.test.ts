import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * G8 — the launch acceptance test, checked from what the product wrote: a
 * workspace that walked every step passes; take one step away and it does not.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

d('G8 · the acceptance check (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let BIZ = '';
  let OUT = '';
  const check = () => spawnSync(process.execPath, ['tools/acceptance-check.mjs', '--business', BIZ], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '' },
  });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    db = createDb(DATABASE_URL!);
    const made = await provisionAccount(db, {
      factory: `G8 Candles ${RUN}`, language: 'en', ownerName: 'Lea', email: `g8-${RUN}@candles.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'brand', sells: 'candles', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    BIZ = made.businessId;
    const q = (text: string, args: unknown[]) => admin.query(text, args);
    await q(`insert into catalog_imports (business_id, kind, currency, state, confirmed_at) values ($1, 'paste', 'AED', 'confirmed', now())`, [BIZ]);
    await q(`insert into onboarding_state (business_id, assistant_named_at) values ($1, now()) on conflict (business_id) do update set assistant_named_at = now()`, [BIZ]);
    for (const item of ['price_handed', 'offer_answered', 'handed_over', 'bot_answered', 'person_handoff', 'stop_handoff']) {
      await q(`insert into practice_checks (business_id, item) values ($1, $2)`, [BIZ, item]);
    }
    const page = `8${RUN.replace(/[^0-9]/g, '2').padEnd(8, '2')}08`;
    await q(`insert into meta_accounts (business_id, page_id, page_name, ig_account_id, token_ciphertext, fingerprint, scopes, connected_by)
             values ($1, $2, 'Juniper Page', $3, 'v1.1.aaaa.bbbb.cccc', 'abcdef012345', 'instagram_manage_messages', 'test')`, [BIZ, page, `${page}9`]);
    const client = (await q(`insert into clients (business_id, display_name) values ($1, 'Sara') returning id`, [BIZ])).rows[0].id;
    const conv = (await q(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'instagram') returning id`, [BIZ, client])).rows[0].id;
    await q(`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values ($1, $2, 'inbound', 'text', 'hi', now())`, [conv, `g8-${RUN}`]);
    await q(`insert into drafts (business_id, conversation_id, capability, draft_text, status, decided_at) values ($1, $2, 'qualify', 'Hello', 'approved', now())`, [BIZ, conv]);
    OUT = (await q(`insert into outbound_messages (business_id, conversation_id, seq, body, status, sent_at, origin, channel)
                     values ($1, $2, 1, 'Hello', 'delivered', now(), 'employee', 'instagram') returning id`, [BIZ, conv])).rows[0].id;
  }, 60_000);
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('every step on record: each one ✓, and exit 0', () => {
    const r = check();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout.match(/^ {2}✓ /gm)).toHaveLength(9);
    expect(r.stdout).toContain('✓ Every step is on record.');
    expect(r.stdout).not.toContain('Sara');
  }, 120_000);

  it('a reply Instagram never confirmed: that step is ○, and exit 1', async () => {
    await admin.query(`update outbound_messages set status = 'sent' where id = $1`, [OUT]);
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('○ …and Instagram says it arrived');
  }, 120_000);
});
