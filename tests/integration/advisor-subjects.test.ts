import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { CATALOGUE } from '../../src/advisor/catalogue.js';

/**
 * EVERY ADVISOR READ SAYS WHICH CUSTOMERS IT NAMES OR QUOTES (0130, docs/ADVISOR-MEMORY.md §2). A kept advisor
 * turn is linked to each customer its facts name or quote (`advisor_turn_subjects`), so that a customer's
 * erasure finds every turn that carries them. The links come from the sheet's `subjects`; a customer named
 * in a line, or whose own words a line quotes, and missing there would outlive their own erasure in the
 * owner's advisor history.
 *
 *   · Every factual entry of the catalogue is classified here: it names customers, it quotes their words, or
 *     it does neither. A new entry nobody classified fails the first test.
 *   · Each entry that names customers runs on one workspace whose records make it name some, in English,
 *     Chinese and Arabic: every customer whose name its lines carry (or its fixed sentence, `noneParams`) is a
 *     subject, and every subject is a customer the sheet names — the one nameless customer, named by the
 *     stand-in "Customer", aside. A list cut by "…and N more" names only the customers whose lines are shown,
 *     and only those are its subjects.
 *   · Each entry that quotes customers holds the same for their words: everyone whose words a shown line
 *     carries is a subject, and nobody else is.
 *   · No other entry quotes a word any customer wrote: every message, question and sample request of the
 *     fixture is distinctive, and each is looked for in every sheet.
 *   · Each entry that names nobody names none of these customers, and has no subject, whatever is asked.
 *   · Nobody else is ever a subject: not the owner's own test conversation, not another workspace's customer.
 *
 * The workspace's zone is chosen so that its local time is midday while this runs, so "today", "tomorrow"
 * and "in five days" fall where the fixture puts them, whatever the hour of the run.
 */

/** The entries whose lines (or fixed sentence) can name a customer. */
const NAMES_CUSTOMERS = ['A2', 'A3', 'A4', 'A5', 'A7', 'A8', 'B1', 'B7', 'C1', 'C2', 'C3', 'C4', 'D3', 'D11', 'E1', 'E2', 'E3', 'E4', 'E6'] as const;
/** The entries whose lines quote what customers wrote, without naming them: G5's unanswered questions. */
const QUOTES_CUSTOMERS = ['G5'] as const;
/** The entries that never name or quote one: counts, totals, products, the assistant, the business. */
const NAMES_NO_CUSTOMER = ['A1', 'A6', 'A10', 'B2', 'B3', 'B4', 'B5', 'B8', 'B9', 'D1', 'D2', 'D4', 'D5', 'D7', 'D8', 'E5',
  'F1', 'F2', 'F3', 'F4', 'G1', 'G2', 'G3', 'G4', 'G6', 'G7', 'G8', 'H1', 'H2', 'H3'] as const;

describe('the advisor\'s subjects · every factual entry is classified', () => {
  it('the three lists are exactly the catalogue\'s grounded, new and metric entries, each once (opinions cite these; not stored runs nothing)', () => {
    const factual = CATALOGUE.filter((e) => e.kind === 'grounded' || e.kind === 'new' || e.kind === 'metric').map((e) => e.id).sort();
    const classified: string[] = [...NAMES_CUSTOMERS, ...QUOTES_CUSTOMERS, ...NAMES_NO_CUSTOMER];
    expect(new Set(classified).size, 'an entry in two lists, or twice in one').toBe(classified.length);
    expect(classified.sort()).toEqual(factual);
  });
});

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const id = (n: number) => `dda40000-0000-4000-8000-${RUN}${String(n).padStart(4, '0')}`;
const BIZ = id(1); const OTHER = id(2); const PID = id(3); const BARE = id(4);
const REF = `SUBJ-${RUN}`;

/** A zone whose local time is about midday now: Etc/GMT-N is UTC+N. */
const MIDDAY = (() => {
  const offset = 12 - new Date().getUTCHours();
  return offset === 0 ? 'UTC' : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
})();

/** A gap's question as `loadKnowledgeOps` groups it: the same words, but for case, spacing and punctuation. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();

type Who = { readonly client: string; readonly conv: string; readonly name: string | null };
const who = (n: number, name: string | null): Who => ({ client: id(100 + n), conv: id(200 + n), name: name === null ? null : `${name} ${RUN}` });

/**
 *   Wanda    wrote ten minutes ago, unanswered; a reply waits for review; she said yes to an order that waits
 *            for the owner's OK; a reply to her never left (blocked).
 *   Quentin  given a price five days ago, and nothing from him since.
 *   Regina   a regular gone quiet: three orders, 100, 80 and 60 days ago, each in its own conversation.
 *   Orla     an order by reference, confirmed five minutes ago, its next step recorded for tomorrow.
 *   Sami     asked for a sample two days ago; it has not gone out.
 *   Hana     handed over to a person; the reply owed to her is two hours overdue.
 *   Petra    a follow-up promised for tomorrow, a delivery promised in five days.
 *   Nils     a conversation with no message in it.
 *   Delia    asked to be deleted half an hour ago; the request waits.
 *   Ingrid   asked a question nothing taught answers (a gap), forty minutes ago; she was answered.
 *   (nameless) wrote twenty minutes ago; every line says "Customer".
 *   Crowd 01–16  wrote an hour or so ago, unanswered: enough to cut the lists at "…and N more". Crowd 01–11
 *            each asked a gap question of their own, so G5 shows ten and counts two; Crowd 16 asked Ingrid's,
 *            in other case and punctuation, so one line quotes them both.
 *   Tess     the owner testing their own shop (a gap question too) — in no fact, so in no subject.
 *   Zora     another workspace's customer, with a gap question of her own.
 */
const WANDA = who(1, 'Wanda Okafor');
const QUENTIN = who(2, 'Quentin Marsh');
const REGINA = who(3, 'Regina Duarte');
const ORLA = who(4, 'Orla Brennan');
const SAMI = who(5, 'Sami Haddad');
const HANA = who(6, 'Hana Sato');
const PETRA = who(7, 'Petra Novak');
const NILS = who(8, 'Nils Berg');
const DELIA = who(9, 'Delia Fontaine');
const NAMELESS = who(10, null);
const INGRID = who(11, 'Ingrid Solberg');
const CROWD = Array.from({ length: 16 }, (_, i) => who(20 + i, `Crowd ${String(i + 1).padStart(2, '0')}`));
const TESS = who(50, 'Tess Testing');
const ZORA = who(60, 'Zora Elsewhere');
const REGINA_MORE = [id(301), id(302)];

/** Every named customer of the workspace, and the two who must never be a subject. */
const NAMED: readonly Who[] = [WANDA, QUENTIN, REGINA, ORLA, SAMI, HANA, PETRA, NILS, DELIA, INGRID, ...CROWD];
const NEVER: readonly Who[] = [TESS, ZORA];

/** What the customers wrote, each distinctive: every message, every gap question, the sample request. */
const QUESTION = `Do you ship hammocks to Reykjavik, ${RUN}?`;
const QUESTION_AGAIN = `do you ship HAMMOCKS to   reykjavik ${RUN}`;
const STOCK = (i: number) => `Is model ${String(i + 1).padStart(2, '0')} in stock, ${RUN}?`;
const CROWD_SAID = (i: number) => (i < 11 ? STOCK(i) : i === 15 ? QUESTION_AGAIN : `Hello there from the back of the queue ${String(i + 1).padStart(2, '0')} ${RUN}`);
const SAMPLE_ASKED = `Could I get a sample of the tote, ${RUN}`;
const WORDS: readonly { readonly who: Who; readonly said: string }[] = [
  { who: WANDA, said: `Can you do 500 pieces by the end of the month ${RUN}?` },
  { who: NAMELESS, said: `Hello from somebody without a name ${RUN}` },
  { who: DELIA, said: `Please delete everything you hold on me ${RUN}` },
  { who: ORLA, said: `Thanks for confirming the order ${RUN}` },
  { who: INGRID, said: QUESTION },
  ...CROWD.map((c, i) => ({ who: c, said: CROWD_SAID(i) })),
  { who: HANA, said: `I would like to speak to someone in charge ${RUN}` },
  { who: PETRA, said: `When will the parcel arrive ${RUN}` },
  { who: SAMI, said: SAMPLE_ASKED },
  { who: QUENTIN, said: `How much would 200 cost ${RUN}` },
  { who: TESS, said: `Testing my own shop with a question ${RUN}?` },
  { who: ZORA, said: `A question asked at another shop ${RUN}?` },
];
const said = (w: Who): string => WORDS.find((x) => x.who === w)!.said;

type Params = import('../../src/advisor/reads.js').Params;
type Locale = import('../../src/core/owner/i18n/locale.js').Locale;

/** What each customer-naming entry is asked: a customer by full name, one name matching six, a reference. */
const ASKED: Readonly<Record<string, readonly Partial<Params>[]>> = {
  A3: [{ customer: ORLA.name }, { customer: RUN }],
  A4: [{ customer: WANDA.name }, { customer: NILS.name }, { customer: RUN }],
  E6: [{ customer: PETRA.name }, { customer: NILS.name }, { customer: RUN }],
  D11: [{ reference: REF }],
};

d('the advisor\'s subjects · every customer a read names or quotes is one of its subjects (requires DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let ro: import('../../src/db/client.js').Db;
  let ours: ReadonlySet<string>;
  const tx = async <R>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const read = async (key: string, params: Partial<Params> = {}, locale: Locale = 'en') => {
    const { READS } = await import('../../src/advisor/reads.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return READS[key]!({ db: ro, businessId: bid.value, viewerId: 'owner', locale, now: new Date(),
      params: { period: null, customer: null, product: null, reference: null, ...params } });
  };
  /** Everything the owner would read: the lines, or the fixed sentence's names. */
  const textOf = (s: import('../../src/advisor/reads.js').Sheet): string => [...s.lines, ...Object.values(s.noneParams ?? {})].join('\n');
  /** The customers whose own words the text carries. */
  const quotedIn = (text: string) => WORDS.filter((w) => norm(text).includes(norm(w.said)));

  beforeAll(async () => {
    const { createDb, createReadOnlyDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    ro = createReadOnlyDb(DATABASE_URL!);
    await tx(BIZ, async (t) => {
      await sql`insert into businesses (id, name, timezone, country, currency) values (${BIZ}, 'Advisor Subjects Co', ${MIDDAY}, 'CN', 'USD')`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, is_active) values (${PID}, ${BIZ}, ${REF}, 'Canvas tote', 'pcs', true)`.execute(t);
      await sql`insert into products (id, business_id, sku, name, unit, is_active) values (${BARE}, ${BIZ}, ${`${REF}-2`}, 'Linen apron', 'pcs', true)`.execute(t);
      await sql`insert into price_tiers (product_id, min_qty, unit_price_usd, currency) values (${PID}, 1, 2.5, 'USD')`.execute(t);
      for (const c of [...NAMED, NAMELESS, TESS]) {
        await sql`insert into clients (id, business_id, display_name) values (${c.client}, ${BIZ}, ${c.name})`.execute(t);
        await sql`insert into conversations (id, business_id, client_id, channel, owner_testing, assigned_to)
                  values (${c.conv}, ${BIZ}, ${c.client}, 'whatsapp', ${c === TESS}, ${c === HANA ? 'unclaimed' : null})`.execute(t);
      }
      for (const conv of REGINA_MORE) {
        await sql`insert into conversations (id, business_id, client_id, channel) values (${conv}, ${BIZ}, ${REGINA.client}, 'whatsapp')`.execute(t);
      }
      let n = 0;
      const say = (c: Who, dir: 'inbound' | 'outbound', minutesAgo: number, text = said(c)) =>
        sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
            values (${c.conv}, ${`${RUN}-${c.conv}-${++n}`}, ${dir}, 'text', ${text}, now() - make_interval(mins => ${minutesAgo}))`.execute(t);
      /** A turn that answered without anything taught: a gap, in the question's own words. */
      const gap = (c: Who, minutesAgo: number, question = said(c)) =>
        sql`insert into turns (message_id, business_id, conversation_id, state_before, input, decision, engine, engine_version, created_at)
            values (${`${RUN}-turn-${++n}`}, ${BIZ}, ${c.conv}, '{}'::jsonb, ${JSON.stringify({ text: question })}::jsonb,
                    '{"action":{"kind":"generate_reply"}}'::jsonb, 'service', 'test', now() - make_interval(mins => ${minutesAgo}))`.execute(t);
      const DAY = 24 * 60;
      await say(WANDA, 'inbound', 10);
      await say(NAMELESS, 'inbound', 20);
      await say(DELIA, 'inbound', 30);
      await say(INGRID, 'inbound', 40);
      await gap(INGRID, 39);
      await say(INGRID, 'outbound', 38, 'Let me check with the team.');
      await say(ORLA, 'inbound', 50);
      await say(ORLA, 'outbound', 45, 'You are welcome.');
      for (const [i, c] of CROWD.entries()) {
        await say(c, 'inbound', 61 + i);
        if (i < 11 || i === 15) await gap(c, 60 + i);
      }
      await say(HANA, 'inbound', 180);
      await say(PETRA, 'inbound', DAY);
      await say(PETRA, 'outbound', DAY - 5, 'We will follow up tomorrow.');
      await say(SAMI, 'inbound', 2 * DAY);
      await say(SAMI, 'outbound', 2 * DAY - 5, 'Yes, we will send one.');
      await say(QUENTIN, 'inbound', 5 * DAY + 10);
      await say(QUENTIN, 'outbound', 5 * DAY - 1, 'Here is the price.');
      await say(TESS, 'inbound', 5);
      await gap(TESS, 4);
      // Wanda: a reply to review, an order to OK, a reply that never left
      for (const c of [WANDA, TESS]) {
        await sql`insert into drafts (business_id, conversation_id, capability, draft_text, status) values (${BIZ}, ${c.conv}, 'quote', 'Waiting', 'pending')`.execute(t);
      }
      await sql`insert into order_proposals (business_id, conversation_id, client_id, product_id, quantity, unit, unit_price, total, currency, client_email, state)
                values (${BIZ}, ${WANDA.conv}, ${WANDA.client}, ${PID}, 500, 'pcs', 2, 1000, 'USD', 'wanda@example.com', 'pending')`.execute(t);
      await sql`insert into outbound_messages (business_id, conversation_id, seq, body, status, cancel_reason)
                values (${BIZ}, ${WANDA.conv}, 1, 'Never left', 'canceled', 'window_closed')`.execute(t);
      // Quentin: a price given five days ago (a line left to him after it), nothing from him since
      await sql`insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version, currency, created_at)
                values (${BIZ}, ${QUENTIN.conv}, ${PID}, 200, '{}'::jsonb, 2.5, 500, 'test', 'USD', now() - make_interval(mins => ${5 * DAY}))`.execute(t);
      // Regina: three orders, twenty days apart, the last sixty days ago; Orla: one, by reference
      const order = (ref: string, c: Who, conv: string, total: number, at: string) =>
        sql`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit,
                                agreed_unit_price_usd, total_value_usd, currency, status, confirmed_at)
            values (${ref}, ${BIZ}, ${c.client}, ${conv}, ${PID}, 10, 'pcs', ${total / 10}, ${total}, 'USD', 'confirmed', now() - ${at}::interval)`.execute(t);
      await order(`${REF}-R1`, REGINA, REGINA.conv, 100, '100 days');
      await order(`${REF}-R2`, REGINA, REGINA_MORE[0]!, 100, '80 days');
      await order(`${REF}-R3`, REGINA, REGINA_MORE[1]!, 100, '60 days');
      await order(REF, ORLA, ORLA.conv, 120, '5 minutes');
      // Orla's next step, recorded for tomorrow: the calendar's line names the order, not her
      await sql`insert into order_updates (business_id, order_id, state, at)
                select ${BIZ}, o.id, 'shipped', now() + interval '1 day' from orders o where o.order_reference = ${REF}`.execute(t);
      await sql`insert into sample_requests (business_id, conversation_id, asked_text, requested_at)
                values (${BIZ}, ${SAMI.conv}, ${SAMPLE_ASKED}, now() - interval '2 days')`.execute(t);
      await sql`insert into handoffs (business_id, conversation_id, reason, sla_deadline_at)
                values (${BIZ}, ${HANA.conv}, 'human_requested', now() - interval '2 hours')`.execute(t);
      const today = sql`(now() at time zone ${MIDDAY})::date`;
      await sql`insert into promised_dates (business_id, conversation_id, kind, due_on, said, said_by)
                values (${BIZ}, ${PETRA.conv}, 'follow_up', ${today} + 1, 'We will follow up tomorrow.', 'assistant'),
                       (${BIZ}, ${PETRA.conv}, 'delivery', ${today} + 5, 'It will arrive in five days.', 'assistant')`.execute(t);
      await sql`insert into deletion_asks (business_id, client_id, conversation_id, asked_at)
                values (${BIZ}, ${DELIA.client}, ${DELIA.conv}, now() - interval '30 minutes')`.execute(t);
      await sql`insert into factory_closures (business_id, label, starts_on, ends_on) values (${BIZ}, 'Spring holiday', ${today} + 10, ${today} + 12)`.execute(t);
      await sql`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at) values (${BIZ}, 'USD', 'CNY', 7.1, now())`.execute(t);
    });
    await tx(OTHER, async (t) => {
      await sql`insert into businesses (id, name, timezone) values (${OTHER}, 'Somebody Else Co', ${MIDDAY})`.execute(t);
      await sql`insert into clients (id, business_id, display_name) values (${ZORA.client}, ${OTHER}, ${ZORA.name})`.execute(t);
      await sql`insert into conversations (id, business_id, client_id, channel) values (${ZORA.conv}, ${OTHER}, ${ZORA.client}, 'whatsapp')`.execute(t);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
                values (${ZORA.conv}, ${`${RUN}-zora`}, 'inbound', 'text', ${said(ZORA)}, now() - interval '1 minute')`.execute(t);
      await sql`insert into turns (message_id, business_id, conversation_id, state_before, input, decision, engine, engine_version)
                values (${`${RUN}-zora-turn`}, ${OTHER}, ${ZORA.conv}, '{}'::jsonb, ${JSON.stringify({ text: said(ZORA) })}::jsonb,
                        '{"action":{"kind":"generate_reply"}}'::jsonb, 'service', 'test')`.execute(t);
      await sql`insert into drafts (business_id, conversation_id, capability, draft_text, status) values (${OTHER}, ${ZORA.conv}, 'quote', 'Waiting', 'pending')`.execute(t);
    });
    ours = new Set(await tx(BIZ, async (t) => (await sql<{ id: string }>`select id::text as id from clients`.execute(t)).rows.map((r) => r.id)));
  });
  afterAll(async () => { await ro?.destroy(); await db?.destroy(); });

  it('the workspace is this one: its customers are the fixture\'s, and the other workspace\'s is not among them', () => {
    for (const c of [...NAMED, NAMELESS, TESS]) expect(ours.has(c.client)).toBe(true);
    expect(ours.has(ZORA.client)).toBe(false);
  });

  for (const key of NAMES_CUSTOMERS) {
    it(`${key} · every customer its lines name is a subject, and every subject is one it names`, async () => {
      for (const locale of ['en', 'zh', 'ar'] as const) {
        for (const params of ASKED[key] ?? [{}]) {
          const at = `${key} ${locale} ${JSON.stringify(params)}`;
          const sheet = await read(key, params, locale);
          const text = textOf(sheet);
          const named = NAMED.filter((c) => text.includes(c.name!));
          // the fixture makes this entry name somebody, or it proves nothing
          expect(named.length, `${at}: names nobody\n${text}`).toBeGreaterThan(0);
          for (const c of named) expect(sheet.subjects, `${at}: ${c.name} is named and is no subject`).toContain(c.client);
          for (const s of sheet.subjects) {
            expect(s === NAMELESS.client || named.some((c) => c.client === s), `${at}: ${s} is a subject the sheet does not name`).toBe(true);
            expect(ours.has(s), `${at}: ${s} is not this workspace's customer`).toBe(true);
          }
          for (const c of NEVER) {
            expect(text, at).not.toContain(c.name);
            expect(sheet.subjects, at).not.toContain(c.client);
          }
          // names, never words: a line that quoted a customer would belong with the quoting entries
          expect(quotedIn(text).map((w) => w.said), `${at}: quotes a customer`).toEqual([]);
          expect(new Set(sheet.subjects).size, `${at}: a subject twice`).toBe(sheet.subjects.length);
        }
      }
    });
  }

  for (const key of QUOTES_CUSTOMERS) {
    it(`${key} · every customer whose words its lines quote is a subject, and every subject is one it quotes`, async () => {
      for (const locale of ['en', 'zh', 'ar'] as const) {
        const at = `${key} ${locale}`;
        const sheet = await read(key, {}, locale);
        const text = textOf(sheet);
        const quoted = quotedIn(text);
        expect(quoted.length, `${at}: quotes nobody\n${text}`).toBeGreaterThan(0);
        for (const w of quoted) expect(sheet.subjects, `${at}: “${w.said}” is quoted and its writer is no subject`).toContain(w.who.client);
        for (const s of sheet.subjects) {
          expect(quoted.some((w) => w.who.client === s), `${at}: ${s} is a subject the sheet does not quote`).toBe(true);
          expect(ours.has(s), `${at}: ${s} is not this workspace's customer`).toBe(true);
        }
        for (const c of NEVER) {
          expect(norm(text), at).not.toContain(norm(said(c)));
          expect(sheet.subjects, at).not.toContain(c.client);
        }
        expect(new Set(sheet.subjects).size, `${at}: a subject twice`).toBe(sheet.subjects.length);
      }
    });
  }

  for (const key of NAMES_NO_CUSTOMER) {
    it(`${key} · names and quotes no customer, and has no subject — even when a customer is asked about`, async () => {
      for (const params of [{}, { customer: WANDA.name, product: 'tote', reference: REF, period: 'month' as const }]) {
        const sheet = await read(key, params);
        const text = textOf(sheet);
        for (const c of [...NAMED, ...NEVER]) expect(text, `${key} ${JSON.stringify(params)}`).not.toContain(c.name);
        expect(quotedIn(text).map((w) => w.said), `${key} ${JSON.stringify(params)}: quotes a customer`).toEqual([]);
        expect(sheet.subjects, `${key} ${JSON.stringify(params)}`).toEqual([]);
      }
    });
  }

  it('a list cut at "…and N more" has as subjects only the customers whose lines are shown', async () => {
    const { t } = await import('../../src/api/web/say.js');
    const b7 = await read('B7');
    // Wanda, the nameless customer, Delia and Crowd 01–12 are shown; Crowd 13–16 and Hana are counted
    expect(b7.lines).toContain(t('en', 'advisor.k.more', { n: '5' }));
    expect(b7.subjects).toEqual([WANDA, NAMELESS, DELIA, ...CROWD.slice(0, 12)].map((c) => c.client));
    for (const c of [...CROWD.slice(12), HANA]) expect(b7.subjects).not.toContain(c.client);
    const a2 = await read('A2');
    expect(a2.lines).toContain(t('en', 'advisor.k.more', { n: '7' }));
    expect(a2.subjects).toHaveLength(20);
    for (const c of [CROWD[15]!, HANA, PETRA, SAMI, QUENTIN, NILS, REGINA]) expect(a2.subjects).not.toContain(c.client);
  });

  it('G5 quotes a customer\'s unanswered question and carries them — and everyone who asked it in other case — and not the questions it only counts', async () => {
    const { t } = await import('../../src/api/web/say.js');
    const g5 = await read('G5');
    expect(g5.lines[0]).toBe(t('en', 'advisor.k.gap', { question: QUESTION, n: '2' }));
    expect(g5.subjects).toContain(INGRID.client);
    expect(g5.subjects).toContain(CROWD[15]!.client);
    // ten shown: Ingrid's (asked twice), then Crowd 01–09's; Crowd 10's and 11's are counted
    expect(g5.lines).toContain(t('en', 'advisor.k.more', { n: '2' }));
    expect([...g5.subjects].sort()).toEqual([INGRID, CROWD[15]!, ...CROWD.slice(0, 9)].map((c) => c.client).sort());
    for (const c of CROWD.slice(9, 11)) expect(g5.subjects).not.toContain(c.client);
  });

  it('a customer with no name is named by the stand-in, and is a subject like any other', async () => {
    const { t } = await import('../../src/api/web/say.js');
    for (const key of ['A2', 'A5', 'B7']) expect((await read(key)).subjects, key).toContain(NAMELESS.client);
    expect((await read('B7')).lines.join('\n')).toContain(`Message from ${t('en', 'common.buyer')}:`);
  });

  it('a fixed sentence that names a customer has them as its subject; one that names only what was asked has none', async () => {
    const never = await read('A4', { customer: NILS.name });
    expect(never).toMatchObject({ empty: true, none: 'advisor.none.neverWrote', subjects: [NILS.client] });
    const noDelivery = await read('E6', { customer: NILS.name });
    expect(noDelivery).toMatchObject({ empty: true, none: 'advisor.none.delivery', subjects: [NILS.client] });
    const nobody = await read('A3', { customer: `Nobody ${RUN}` });
    expect(nobody).toMatchObject({ empty: true, none: 'advisor.none.noSuchCustomer', subjects: [] });
  });

  it('the calendar names the customer of a promise, a sample, a reply owed — not the one whose order a line gives by its reference', async () => {
    const e1 = await read('E1');
    expect(e1.lines.join('\n')).toContain(REF);
    expect(e1.lines.join('\n')).not.toContain(ORLA.name);
    expect(e1.subjects).not.toContain(ORLA.client);
    expect([...e1.subjects].sort()).toEqual([SAMI, HANA, PETRA].map((c) => c.client).sort());
  });
});
