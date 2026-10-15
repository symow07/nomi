import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runDigits } from './tenant.js';
// @ts-expect-error — the operator tools, plain JS on purpose (tools/ is not type-checked).
import { attachNumber } from '../../tools/attach-number.mjs';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { releaseNumber, releasedRef } from '../../tools/release-number.mjs';

/**
 * The isolation sweep's item 11 (the owner, 2026-10-15: "if the operator tool attaches the spare SIM wrongly and I
 * disconnect to retry, am I locked out… If there isn't [a path to release it], build one — a release, not a
 * redesign."). Over Postgres, with the real attach tool and the app's own disconnect (only Meta faked):
 *
 *   · attached to the wrong workspace and disconnected there, the number could go nowhere else — the attach tool
 *     refuses it, naming that workspace;
 *   · the release refuses while the number is switched on, shows without writing, then frees it — the credential keeps
 *     its row, gives up the number, and the audit trail says who;
 *   · the number then attaches to the right workspace and routes there only; the workspace it left is not locked out
 *     of connecting another.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const WRONG = `ab110000-0000-4000-8000-${RUN}0001`;
const RIGHT = `ab110000-0000-4000-8000-${RUN}0002`;
const WABA = `1194${runDigits(RUN, 10)}`;
const SPARE = `1195${runDigits(RUN, 10)}`;
const ANOTHER = `1196${runDigits(RUN, 10)}`;
const INSTALLATION = `1198${runDigits(RUN, 10)}`;
const TOKEN = 'installation-token-not-real-0123456789';

const metaFetch = async (url: string) => {
  const u = new URL(url);
  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
  if (u.pathname.endsWith(`/${WABA}/phone_numbers`)) return json(200, { data: [{ id: SPARE }] });
  if (u.pathname.endsWith(`/${SPARE}`)) {
    return json(200, { id: SPARE, display_phone_number: '+1 555 010 0177', verified_name: 'Boss Bags', name_status: 'APPROVED',
      platform_type: 'CLOUD_API', status: 'CONNECTED' });
  }
  return json(404, { error: { code: 100 } });
};

d('item 11 · a number attached to the wrong workspace can be released (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 60_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;

  const attach = async (businessId: string, phoneNumberId: string) => {
    const { deriveKey, encryptSecret, credentialFingerprint } = await import('../../src/security/credentials.js');
    const { newPin } = await import('../../src/channels/whatsapp/embeddedSignup.js');
    const key = deriveKey('e'.repeat(64));
    return attachNumber({
      client: admin, fetchImpl: metaFetch, businessId, phoneNumberId, write: true, by: 'test',
      env: { META_WHATSAPP_ACCESS_TOKEN: TOKEN, META_WHATSAPP_BUSINESS_ACCOUNT_ID: WABA, META_WHATSAPP_PHONE_NUMBER_ID: INSTALLATION, META_GRAPH_API_VERSION: 'v23.0' },
      seal: (plain: string) => encryptSecret(plain, key), fingerprint: credentialFingerprint, newPin,
    });
  };
  /** The owner's Disconnect on My business, as the app does it (the credential off, the account archived). */
  const disconnect = async (businessId: string) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { unlinkWhatsAppCredentials, archiveWhatsAppAccount } = await import('../../src/db/whatsappAccounts.js');
    const b = parseBusinessId(businessId); if (!b.ok) throw new Error('fixture');
    await withTenantTx(db, b.value, async (tx) => {
      await unlinkWhatsAppCredentials(tx, b.value, 'owner');
      await archiveWhatsAppAccount(tx, b.value, 'owner');
    });
  };
  const release = (businessId: string, phoneNumberId: string, write: boolean) =>
    releaseNumber({ client: admin, businessId, phoneNumberId, write, by: 'test operator' });
  const routedTo = async (number: string) => (await admin.query(
    `select business_id::text as id from resolve_tenant('whatsapp', $1)`, [number])).rows.map((r) => r.id as string);
  const credentials = async () => (await admin.query(
    `select business_id::text as business_id, external_ref, is_active from channel_credentials
      where business_id = any($1::uuid[]) order by created_at, id`, [[WRONG, RIGHT]])).rows;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[WRONG, `Wrong ${RUN}`], [RIGHT, `Right ${RUN}`]]) {
      await admin.query(`insert into businesses (id, name, engine) values ($1, $2, 'service')`, [id, name]);
    }
  });
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('attached to the wrong workspace and disconnected there, the number goes nowhere else — until it is released', async () => {
    expect((await attach(WRONG, SPARE)).done).toBe(true);
    expect(await routedTo(SPARE)).toEqual([WRONG]);

    // Switched on: the release refuses, and says how to switch it off.
    await expect(release(WRONG, SPARE, true)).rejects.toThrow(/switched on in .*Disconnect it there first/);

    await disconnect(WRONG);
    await expect(attach(RIGHT, SPARE)).rejects.toThrow(/belongs to another workspace — Wrong .*switched off there/);

    // Shown, not written.
    const before = await credentials();
    const shown = await release(WRONG, SPARE, false);
    expect(shown).toMatchObject({ done: false, number: SPARE, business: { id: WRONG } });
    expect(await credentials()).toEqual(before);

    // Released: the row stays, the number goes, and the audit trail says who.
    const done = await release(WRONG, SPARE, true);
    expect(done).toMatchObject({ done: true, number: SPARE });
    expect(await credentials()).toEqual([{ business_id: WRONG, external_ref: releasedRef(done.credential, SPARE), is_active: false }]);
    const audit = (await admin.query(
      `select action, actor, detail from channel_audit where business_id = $1 order by id desc limit 1`, [WRONG])).rows[0];
    expect(audit).toMatchObject({ action: 'disconnect', actor: 'tools/release-number.mjs: test operator',
      detail: { channel: 'whatsapp', number: SPARE, via: 'operator', released: true } });
    expect(await routedTo(SPARE)).toEqual([]);

    // Nothing left to release.
    await expect(release(WRONG, SPARE, true)).rejects.toThrow(/No workspace holds .*free already/);
  });

  it('then it attaches where it belongs, routes there only, and the workspace it left can connect another', async () => {
    expect((await attach(RIGHT, SPARE)).done).toBe(true);
    expect(await routedTo(SPARE)).toEqual([RIGHT]);
    await expect(release(WRONG, SPARE, true)).rejects.toThrow(/holds no credential for .*Right .* does/);
    // The released row is not "a WhatsApp number" of the workspace it left: the attach tool's next refusal is Meta's.
    await expect(attach(WRONG, ANOTHER)).rejects.toThrow(/Meta does not list/);
    // And the app's own connect re-points that workspace's row to a new number.
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { linkWhatsAppCredentials } = await import('../../src/db/whatsappAccounts.js');
    const b = parseBusinessId(WRONG); if (!b.ok) throw new Error('fixture');
    const linked = await withTenantTx(db, b.value, (tx) => linkWhatsAppCredentials(tx, b.value,
      { accountId: randomUUID(), phoneNumberId: ANOTHER, display: null, actor: 'owner' }));
    expect(linked).toBe('linked');
    expect(await routedTo(ANOTHER)).toEqual([WRONG]);
    expect(await routedTo(SPARE)).toEqual([RIGHT]);
  });
});
