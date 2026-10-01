import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * LG (0108) — THE FIRST FIVE REPLIES IN EACH LANGUAGE, OVER POSTGRES. In a
 * workspace that signed itself up, a language is proven once five drafts in it
 * were approved or edited; a rejected draft, a conversation the owner marked
 * "this is me testing" and another language count toward nothing; a draft from
 * before LG counts by the language it recorded; a workspace the operator made
 * or opened is always proven; a practice copy answers as its workspace. Read
 * through the tenant repository the turn uses.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('LG · the first five in a language (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let BIZ = '';
  const convs: string[] = [];
  const q = (text: string, args: unknown[]) => admin.query(text, args);
  const proven = async (business: string, language: string) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(business); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, (tx) => tenantRepos(tx, b.value).autonomy.languageProven(language));
  };
  /** A draft as commitTurn leaves it, decided as `status`; `gate` absent writes a pre-LG event. */
  const draft = async (conv: string, status: string, payload: { gate?: string; language?: string }) => {
    const id = (await q(`insert into drafts (business_id, conversation_id, capability, draft_text, status, sent_text, decided_at)
      values ($1, $2, 'qualify', 'Yes.', $3, 'Yes.', now()) returning id::text as id`, [BIZ, conv, status])).rows[0].id;
    await q(`insert into conversation_events (business_id, conversation_id, type, payload) values ($1, $2, 'draft_pending', $3)`,
      [BIZ, conv, JSON.stringify({ draftId: id, capability: 'qualify', ...payload })]);
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const m = await import('../../src/db/client.js');
    db = m.createDb(DATABASE_URL!);
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const made = await provisionAccount(db, {
      factory: `LG Lamps ${RUN}`, language: 'en', ownerName: 'Rania', email: `lg-${RUN}@lamps.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'online_shop', sells: 'lamps', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    BIZ = made.businessId;
    for (let i = 0; i < 2; i++) {
      const c = (await q(`insert into clients (business_id, display_name) values ($1, $2) returning id`, [BIZ, `Customer ${i}`])).rows[0].id;
      convs.push((await q(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'instagram') returning id::text as id`, [BIZ, c])).rows[0].id);
    }
    await q(`update conversations set owner_testing = true where id = $1`, [convs[1]]);
  }, 60_000);
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('NOTHING YET: no language is proven in a workspace that signed itself up', async () => {
    expect(await proven(BIZ, 'en')).toBe(false);
    expect(await proven(BIZ, 'zh')).toBe(false);
  });

  it('FOUR APPROVED, one rejected, one in a test conversation, one in another language: not yet', async () => {
    for (let k = 0; k < 3; k++) await draft(convs[0]!, 'approved', { gate: 'en', language: 'en' });
    await draft(convs[0]!, 'edited', { gate: 'en', language: 'en' });
    await draft(convs[0]!, 'rejected', { gate: 'en', language: 'en' });
    await draft(convs[1]!, 'approved', { gate: 'en', language: 'en' });
    await draft(convs[0]!, 'approved', { gate: 'zh', language: 'zh' });
    await draft(convs[0]!, 'pending', { gate: 'en', language: 'en' });
    expect(await proven(BIZ, 'en')).toBe(false);
  });

  it('THE FIFTH approved makes it proven — that language only', async () => {
    await draft(convs[0]!, 'approved', { gate: 'en', language: 'en' });
    expect(await proven(BIZ, 'en')).toBe(true);
    expect(await proven(BIZ, 'zh')).toBe(false);
  });

  it('the GATE\'s language counts, not the reply\'s: a reply written in English to an Arabic customer is Arabic\'s', async () => {
    for (let k = 0; k < 5; k++) await draft(convs[0]!, 'approved', { gate: 'ar', language: 'en' });
    expect(await proven(BIZ, 'ar')).toBe(true);
  });

  it('a draft from BEFORE LG counts by the language it recorded — retroactive, as the ramp is', async () => {
    for (let k = 0; k < 4; k++) await draft(convs[0]!, 'approved', { language: 'zh' });
    expect(await proven(BIZ, 'zh')).toBe(true);   // with the one above
  });

  it('A PILOT THE OPERATOR OPENED, a workspace the operator made, and a practice copy', async () => {
    await q(`update businesses set auto_earned_by = 'operator', auto_earned_at = now() where id = $1`, [BIZ]);
    expect(await proven(BIZ, 'fr')).toBe(true);
    await q(`update businesses set auto_earned_by = 'ramp' where id = $1`, [BIZ]);
    expect(await proven(BIZ, 'fr')).toBe(false);

    const OP = randomUUID();
    await q(`insert into businesses (id, name) values ($1, $2)`, [OP, `LG operator-made ${RUN}`]);
    expect(await proven(OP, 'fr')).toBe(true);

    const COPY = randomUUID();
    await q(`insert into businesses (id, name, practice_of) values ($1, $2, $3)`, [COPY, `LG practice ${RUN}`, BIZ]);
    expect(await proven(COPY, 'en')).toBe(true);
    expect(await proven(COPY, 'fr')).toBe(false);
  });
});
