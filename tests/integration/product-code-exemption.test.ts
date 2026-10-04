import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer } from '../pipeline/fakes.js';
import { catalogueWords } from '../../src/core/safety/numerals.js';
import type { ReplyWriter } from '../../src/llm/ports.js';

/**
 * PC (2026-10-04) — the owner's "confirm none of the five products trips the
 * check after the change", against Postgres: Westlake Canvas Co.'s five active
 * products, with their exact names and SKUs (read from production, read-only,
 * 2026-10-04), in a business of this run's own; the catalogue the turn reads
 * (its own, active, nobody else's); and real turns through the production
 * worker (a signed webhook → pg-boss → the worker → the turn → the draft),
 * with a scripted writer naming each product. Nothing is held. Then a reply
 * with an invented figure IS held, and so is a code of nobody's catalogue.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const SHOP = `dd7c0000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd7c0000-0000-4000-8000-${RUN}0002`;

/** Westlake Canvas Co.'s five active products: name | sku. */
const WESTLAKE: readonly (readonly [string, string])[] = [
  ['Canvas tote bag 12oz natural', 'NEW-mu7040xb-0'],
  ['Canvas tote bag 12oz black', 'NEW-mu7040xc-1'],
  ['Cotton drawstring bag 20x25cm', 'NEW-mu7040xd-2'],
  ['Zipper canvas pouch A5', 'NEW-mu7040xe-3'],
  ['Jute shopping bag laminated', 'NEW-mu7040xh-4'],
];

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;

const inTenant = async <R>(db: Db, biz: string, fn: (tx: Tx) => Promise<R>): Promise<R> => {
  const { withTenantTx } = await import('../../src/db/client.js');
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
  return withTenantTx(db, b.value, fn);
};
const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

const addProducts = (x: Tx, biz: string, rows: readonly { name: string; sku: string; nameZh?: string; active?: boolean }[]) =>
  Promise.all(rows.map((p) => sql`
    insert into products (business_id, sku, name, name_zh, unit, moq, is_active)
    values (${biz}, ${p.sku}, ${p.name}, ${p.nameZh ?? null}, 'pcs', null, ${p.active ?? true})`.execute(x)));

d('PC · the catalogue the turn reads (requires DATABASE_URL)', () => {
  let db: Db;

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    await inTenant(db, SHOP, async (x) => {
      await sql`insert into businesses (id, name) values (${SHOP}, 'Code Check Canvas') on conflict (id) do nothing`.execute(x);
      await addProducts(x, SHOP, [
        ...WESTLAKE.map(([name, sku]) => ({ name, sku })),
        { name: 'Old tote 999', sku: 'OLD-999', active: false },               // archived: not hers to name any more
      ]);
    });
    await inTenant(db, OTHER, async (x) => {
      await sql`insert into businesses (id, name) values (${OTHER}, 'Another Bottle Shop') on conflict (id) do nothing`.execute(x);
      await addProducts(x, OTHER, [{ name: 'Insulated bottle', sku: 'ZX-300', nameZh: '保温瓶' }]);
    });
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  const words = async (biz: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(biz); if (!b.ok) throw new Error('fixture');
    return inTenant(db, biz, (x) => tenantRepos(x, b.value).catalog.productWords());
  };

  it('her five active products, with their exact names and codes — not the archived one, not another business’s', async () => {
    // One transaction wrote them, so they share a moment: compared in the SKUs' order.
    const rows = [...await words(SHOP)].sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
    expect(rows).toEqual(WESTLAKE.map(([name, sku]) => ({ names: [name, null], sku })));
    // The import made up those five codes (CC-31): the guard sets aside the names only.
    expect(catalogueWords(rows)).toEqual(WESTLAKE.map(([name]) => name));
  });

  it('a code she typed herself, and a name in Chinese, are read for the business that owns them', async () => {
    const rows = await words(OTHER);
    expect(rows).toEqual([{ names: ['Insulated bottle', '保温瓶'], sku: 'ZX-300' }]);
    expect(catalogueWords(rows)).toEqual(['Insulated bottle', '保温瓶', 'ZX-300']);
  });
});

d('PC · real turns through the production worker (requires DATABASE_URL)', () => {
  const WORKER_SHOP = `dd7c0000-0000-4000-8000-${RUN}0003`;
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let db: Db;
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  /** The scripted writer: what it says to each message, by the message's text. */
  const script = new Map<string, string>();
  const replyWriter: ReplyWriter = {
    write: async (input) => ({
      reply: script.get(input.text) ?? 'Happy to help with that.',
      promptVersion: 'resp@pc', modelId: 'scripted', usage: { inputTokens: 0, outputTokens: 0 },
    }),
  } as ReplyWriter;
  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: w.rawBody,
      headers: { 'content-type': 'application/json', ...w.headers } });

  /** One buyer asks; the writer answers with `said`; what the turn left: the draft and the conversation's events. */
  let seq = 0;
  const turn = async (said: string) => {
    const n = ++seq;
    const from = `9715${runDigits(RUN, 6)}${String(n).padStart(2, '0')}`;
    const text = `Do you make bags like that? (${RUN}-${n})`;
    script.set(text, said);
    expect((await post(sim.inboundText({ from, text }))).statusCode).toBe(200);
    return until(async () => inTenant(db, WORKER_SHOP, async (x) => {
      const draft = (await sql<{ conversation_id: string; draft_text: string }>`
        select d.conversation_id::text, d.draft_text from drafts d
          join conversations c on c.id = d.conversation_id
          join client_channels cc on cc.client_id = c.client_id
         where c.business_id = ${WORKER_SHOP} and cc.channel = 'whatsapp' and cc.channel_user_id = ${from}`.execute(x)).rows[0];
      if (!draft) return undefined;
      const events = (await sql<{ type: string; payload: Record<string, unknown> | null }>`
        select type, payload from conversation_events where conversation_id = ${draft.conversation_id}::uuid order by id`.execute(x)).rows;
      return { draft: draft.draft_text, events };
    }), `the turn on "${said}"`);
  };

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { createDb } = await import('../../src/db/client.js');
    sim = whatsappSimulator([], { tag: `pc${RUN}` });
    db = createDb(DATABASE_URL!);
    await inTenant(db, WORKER_SHOP, async (t) => {
      await sql`insert into businesses (id, name, engine) values (${WORKER_SHOP}, 'Code Check Worker Canvas', 'service') on conflict (id) do nothing`.execute(t);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${WORKER_SHOP}`.execute(t);
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                values (${WORKER_SHOP}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')`.execute(t);
      await addProducts(t, WORKER_SHOP, WESTLAKE.map(([name, sku]) => ({ name, sku })));
    });
    process.env['PILOT_BUSINESS_ID'] = WORKER_SHOP;
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'pc-verify-token-xx', CREDENTIAL_KEY: 'd'.repeat(64), PORT: 0,
    }, { adapter: sim.adapter, logger: false, media: {}, models: { analyzer, replyWriter } });
  }, 60_000);
  afterAll(async () => { await prod?.close(); await db?.destroy(); });

  const refused = (events: readonly { type: string }[]) => events.filter((e) => e.type === 'guard_violation').length;
  const heldBecause = (events: readonly { type: string; payload: Record<string, unknown> | null }[]) =>
    events.find((e) => e.type === 'draft_pending')?.payload?.['heldBecause'] ?? null;

  it('each of the five, named by its exact name: the draft is the reply, nothing refused, nothing held', async () => {
    for (const [name] of WESTLAKE) {
      const said = `Yes, the ${name} is in stock in white.`;
      const { draft, events } = await turn(said);
      expect(draft, name).toBe(said);
      expect(refused(events), name).toBe(0);
      expect(heldBecause(events), name).toBeNull();
    }
  }, 300_000);

  it('all five in one reply: nothing held', async () => {
    const said = 'We make the Canvas tote bag 12oz natural, the Canvas tote bag 12oz black, the Cotton drawstring bag 20x25cm, '
      + 'the Zipper canvas pouch A5 and the Jute shopping bag laminated.';
    const { draft, events } = await turn(said);
    expect(draft).toBe(said);
    expect(refused(events)).toBe(0);
    expect(heldBecause(events)).toBeNull();
  }, 120_000);

  it('an invented figure beside a product’s name IS held: refused twice, a stand-in drafted for her, the figure never in it', async () => {
    const { draft, events } = await turn('Cotton drawstring bag 20x25cm, 450 pieces ready by Friday.');
    expect(refused(events)).toBeGreaterThan(0);
    expect(heldBecause(events)).toBe('guards_failed_twice');
    expect(draft).not.toContain('450');
  }, 120_000);

  it('a code from nobody’s catalogue here (another business sells the ZX-300) IS held', async () => {
    const { draft, events } = await turn('Yes, the ZX-300 comes in blue.');
    expect(heldBecause(events)).toBe('guards_failed_twice');
    expect(draft).not.toContain('ZX-300');
  }, 120_000);
});
