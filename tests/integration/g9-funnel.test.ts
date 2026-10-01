import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * G9 — the funnel from real rows: a workspace that signed itself up walks the
 * steps, each written where the product writes it, and `loadFunnel` reads
 * them back; an operator's password link before its first reply is seen.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('G9 · the funnel (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let BIZ = '';
  const ts = (h: number) => new Date(Date.UTC(2026, 9, 1, 8 + h, 0, 0));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    db = createDb(DATABASE_URL!);
    const made = await provisionAccount(db, {
      factory: `G9 Studio ${RUN}`, language: 'en', ownerName: 'Ines', email: `g9-${RUN}@studio.example`,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'agency', sells: 'design', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (made.code !== 'created') throw new Error(made.code);
    BIZ = made.businessId;
    const q = (text: string, args: unknown[]) => admin.query(text, args);
    await q(`update businesses set signed_up_at = $2 where id = $1`, [BIZ, ts(0)]);
    await q(`insert into catalog_imports (business_id, kind, currency, created_at, confirmed_at) values ($1, 'paste', 'AED', $2, $3)`, [BIZ, ts(1), ts(2)]);
    // No priced product: the no-catalogue checklist, six items, the last seen at hour 3.
    for (const [item, h] of [['price_handed', 2], ['offer_answered', 2], ['handed_over', 2], ['bot_answered', 3], ['person_handoff', 3], ['stop_handoff', 3]] as const) {
      await q(`insert into practice_checks (business_id, item, seen_at) values ($1, $2, $3)`, [BIZ, item, ts(h)]);
    }
    await q(`insert into onboarding_state (business_id, assistant_named_at) values ($1, $2) on conflict (business_id) do update set assistant_named_at = $2`, [BIZ, ts(1)]);
    await q(`insert into channels (business_id, kind, status, connected_at) values ($1, 'whatsapp', 'connected', $2)`, [BIZ, ts(4)]);
    const client = (await q(`insert into clients (business_id, display_name) values ($1, 'Omar') returning id`, [BIZ])).rows[0].id;
    const conv = (await q(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id`, [BIZ, client])).rows[0].id;
    await q(`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values ($1, $2, 'inbound', 'text', 'hello', $3)`, [conv, `g9-${RUN}`, ts(5)]);
    await q(`insert into drafts (business_id, conversation_id, capability, draft_text, status, created_at, decided_at) values ($1, $2, 'qualify', 'Hi', 'approved', $3, $4)`, [BIZ, conv, ts(5), new Date(ts(5).getTime() + 10 * 60_000)]);
    await q(`insert into drafts (business_id, conversation_id, capability, draft_text, status, created_at, decided_at) values ($1, $2, 'qualify', 'Hi again', 'expired', $3, $4)`, [BIZ, conv, ts(6), ts(30)]);
    await q(`insert into outbound_messages (business_id, conversation_id, seq, body, status, sent_at, origin) values ($1, $2, 1, 'Hi', 'sent', $3, 'employee')`, [BIZ, conv, new Date(ts(5).getTime() + 11 * 60_000)]);
    // A password link the operator made before the first reply (rule 22).
    const login = (await q(`select id from logins where business_id = $1`, [BIZ])).rows[0].id;
    await q(`insert into login_setups (business_id, login_id, token_hash, created_at, expires_at, made_by) values ($1, $2, $3, $4, $5, 'operator')`,
      [BIZ, login, 'a'.repeat(64), ts(4), ts(76)]);
    await q(`insert into login_codes (email, purpose, code_hash, expires_at, consumed_at) values ($1, 'signup', $2, now() + interval '1 hour', now())`, [`g9-${RUN}@studio.example`, 'b'.repeat(64)]);
  }, 60_000);
  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  it('each step, read back from where the product wrote it', async () => {
    const { loadFunnel } = await import('../../src/pipeline/funnel.js');
    const r = (await loadFunnel(db)).find((x) => x.businessId === BIZ)!;
    expect(r).toMatchObject({
      signedUpAt: ts(0), firstImportAt: ts(1), firstImportConfirmedAt: ts(2),
      checksSeen: 6, checksTotal: 6, checklistCompleteAt: ts(3), namedAt: ts(1), connectedAt: ts(4),
      firstCustomerAt: ts(5), draftsDecided: 1, draftsExpired: 1, medianDecisionSeconds: 600, operatorBeforeFirstReply: true,
    });
    expect(r.firstReplyAt?.getTime()).toBe(ts(5).getTime() + 11 * 60_000);
  });
  it('the measures over those rows, and the day\'s forms counted', async () => {
    const { loadFunnel, exitMeasures, signupForms } = await import('../../src/pipeline/funnel.js');
    const mine = (await loadFunnel(db)).filter((x) => x.businessId === BIZ);
    const m = exitMeasures(mine, new Date('2026-10-20T00:00:00Z'), null);
    expect(m.firstReplyIn7Days).toEqual({ pass: 1, of: 1 });
    expect(m.signupToChecklistMinutes).toBe(180);
    expect(m.expired).toEqual({ expired: 1, of: 2 });
    expect(m.firstReplyWithoutOperator).toEqual({ pass: 0, of: 1 });
    const forms = await signupForms(db, new Date(Date.now() - 3_600_000));
    expect(forms.forms).toBeGreaterThanOrEqual(1);
    expect(forms.codesUsed).toBeGreaterThanOrEqual(1);
  });
});
