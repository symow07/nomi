import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * Phase 2a (the owner's roadmap and word, 2026-10-13) — THE MORNING SUMMARY, against real Postgres:
 *
 *   · claimed once a local day, at or past 08:00 in the business's own zone;
 *   · never inside the owner's quiet hours, never with the switch off, never before 08:00;
 *   · it says who waits (the Buyers tab's count) and what sold yesterday, and how to turn it off — by e-mail,
 *     the owner's default way — and records that it went;
 *   · a day with nothing to say sends nothing, and records that too.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const id = (n: number) => `dda40000-0000-4000-8000-${RUN}${String(n).padStart(4, '0')}`;
const [DUE, QUIET, OFF, EARLY, NOTHING] = [id(1), id(2), id(3), id(4), id(5)];
const BASE = 'https://app.example.test';

/** A fixed-offset zone whose local hour is `h` now (Etc/GMT-N is UTC+N). */
const zoneAt = (h: number): string => {
  let off = h - new Date().getUTCHours();
  if (off > 14) off -= 24;
  if (off < -12) off += 24;
  return off === 0 ? 'UTC' : off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
};

d('Phase 2a · the morning summary (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let app: pg.Client;
  let db: import('../../src/db/client.js').Db;
  const owner: Record<string, string> = {};
  const mail: { to: string; subject: string; text: string }[] = [];

  const workspace = async (biz: string, zone: string, name: string) => {
    await admin.query(`insert into businesses (id, name, timezone, owner_locale) values ($1, $2, $3, 'en')`, [biz, `${name} ${RUN}`, zone]);
    owner[biz] = (await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Mona', true) returning id::text as id`, [biz])).rows[0].id;
    await admin.query(`insert into logins (business_id, person_id, email, password_hash) values ($1, $2, $3, 'scrypt$never-used')`,
      [biz, owner[biz], `owner-${name.toLowerCase()}-${RUN}@shop.example`]);
  };
  const claimed = async (): Promise<string[]> =>
    (await app.query(`select business_id::text as b from claim_morning_summaries()`)).rows.map((r) => r.b)
      .filter((b: string) => [DUE, QUIET, OFF, EARLY, NOTHING].includes(b));

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    app = new pg.Client({ connectionString: DATABASE_URL }); await app.connect();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await workspace(DUE, zoneAt(12), 'Due');
    await workspace(QUIET, zoneAt(12), 'Quiet');
    await workspace(OFF, zoneAt(12), 'Off');
    await workspace(EARLY, zoneAt(5), 'Early');
    await workspace(NOTHING, zoneAt(12), 'Nothing');
    // QUIET's owner keeps quiet hours around now; OFF's turned the summary off.
    const here = Number((await admin.query(`select extract(hour from now() at time zone $1)::int as h`, [zoneAt(12)])).rows[0].h);
    await admin.query(`update people set quiet_from = $1, quiet_until = $2 where id = $3`, [(here + 23) % 24, (here + 2) % 24, owner[QUIET]]);
    await admin.query(`update people set morning_summary = false where id = $1`, [owner[OFF]]);
    // DUE: Amira waits for a reply to review; Bao's order was confirmed yesterday, in the business's zone.
    const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, 'Amira Haddad') returning id::text as id`, [DUE])).rows[0].id;
    const conv = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [DUE, client])).rows[0].id;
    await admin.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', 'How much for 500?', now() - interval '1 hour')`, [conv]);
    await admin.query(`insert into drafts (business_id, conversation_id, capability, draft_text, status) values ($1, $2, 'quote', 'Waiting', 'pending')`, [DUE, conv]);
    const bao = (await admin.query(`insert into clients (business_id, display_name) values ($1, 'Bao Lin') returning id::text as id`, [DUE])).rows[0].id;
    const bconv = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [DUE, bao])).rows[0].id;
    const product = (await admin.query(`insert into products (business_id, sku, name) values ($1, $2, 'Tote') returning id::text as id`, [DUE, `MS-${RUN}`])).rows[0].id;
    await admin.query(`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, status, total_value_usd, currency, confirmed_at)
      values ($1, $2, $3, $4, $5, 10, 'pcs', 'confirmed', 120, 'USD', (date_trunc('day', now() at time zone $6) - interval '12 hours') at time zone $6)`,
      [`MS-${RUN}`, DUE, bao, bconv, product, zoneAt(12)]);
  }, 60_000);
  afterAll(async () => { await db?.destroy(); await app?.end(); await admin?.end(); });

  it('CLAIMED once a local day — and never in quiet hours, with the switch off, or before 08:00', async () => {
    const first = await claimed();
    expect(first.sort()).toEqual([DUE, NOTHING].sort());
    expect(await claimed()).toEqual([]);
    const rows = (await admin.query(`select business_id::text as b, day::text as day from morning_summaries where business_id = any($1::uuid[])`,
      [[DUE, NOTHING]])).rows;
    expect(rows).toHaveLength(2);
  });

  it('SENT: who waits and what sold yesterday, and how to turn it off — by e-mail, the default way — and recorded', async () => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const day = (await admin.query(`select day::text as day from morning_summaries where business_id = $1`, [DUE])).rows[0].day;
    const out = await deliverOwnerAlert({
      db, adapter: { sendText: async () => ({ ok: true as const, providerMessageId: 'x' }) }, publicBaseUrl: BASE,
      mail: { send: async (m: { to: string; subject: string; text: string }) => { mail.push(m); return { ok: true as const }; } },
    }, { businessId: DUE, kind: 'morning_summary', conversationId: null, personId: owner[DUE]!, summaryDay: day });
    expect(out).toBe('sent');
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe(`owner-due-${RUN}@shop.example`);
    expect(mail[0]!.subject).toBe('Your morning summary');
    expect(mail[0]!.text).toContain('Customers waiting for you: 1.');
    // Counts, never names: no customer's name leaves Nomi in it.
    expect(mail[0]!.text).not.toMatch(/Amira|Bao/);
    expect(mail[0]!.text).toContain('Orders confirmed yesterday: 1 ($120.00).');
    expect(mail[0]!.text).toContain(`${BASE}/app/settings/alerts#morning`);
    expect((await admin.query(`select outcome, way from morning_summaries where business_id = $1`, [DUE])).rows[0]).toEqual({ outcome: 'sent', way: 'email' });
  });

  it('NOTHING TO SAY: nothing leaves, and the day says so', async () => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const day = (await admin.query(`select day::text as day from morning_summaries where business_id = $1`, [NOTHING])).rows[0].day;
    const before = mail.length;
    const out = await deliverOwnerAlert({
      db, adapter: { sendText: async () => ({ ok: true as const, providerMessageId: 'x' }) }, publicBaseUrl: BASE,
      mail: { send: async (m: { to: string; subject: string; text: string }) => { mail.push(m); return { ok: true as const }; } },
    }, { businessId: NOTHING, kind: 'morning_summary', conversationId: null, personId: owner[NOTHING]!, summaryDay: day });
    expect(out).toBe('skipped_quiet');
    expect(mail.length).toBe(before);
    expect((await admin.query(`select outcome from morning_summaries where business_id = $1`, [NOTHING])).rows[0].outcome).toBe('nothing');
  });

  it('THE APP reads its own claims only, and cannot write them but through the functions', async () => {
    await expect(app.query(`insert into morning_summaries (person_id, day, business_id) values ($1, current_date, $2)`, [owner[DUE], DUE]))
      .rejects.toThrow(/permission denied/);
    await app.query('begin');
    await app.query(`select set_config('app.business_id', $1, true)`, [QUIET]);
    expect((await app.query(`select count(*)::int as n from morning_summaries`)).rows[0].n).toBe(0);
    await app.query('rollback');
  });
});
