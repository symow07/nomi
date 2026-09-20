import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant, runDigits, flashSaid} from './tenant.js';

/**
 * M38 — who may be written to, end to end.
 *
 * The parity suite proves the decision and the page. Only Postgres can prove
 * the things this milestone actually rests on: that a buyer's consent is DERIVED
 * from his own message and matches on the wa_id, that a suppression survives
 * archiving and re-adding the same address, that the app role cannot edit or
 * delete one, and that another tenant's list is invisible.
 *
 * Its own tenant, so nothing here depends on another file having run.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd380000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd380000-0000-4000-8000-${RUN}0002`;
// wa_id form: digits only. `client_channels` is unique on (channel, user id)
// GLOBALLY, so the run id keeps two runs from colliding.
const WA = `8613${runDigits(RUN, 8)}`;
const CARD = `mei-${RUN}@example.com`;
// A second person, added late, so the suppression the rest of this file records
// against CARD does not take the only writable contact out of play.
const FRESH = `yusuf-${RUN}@example.com`;

d('M38 · contacts, consent and suppression (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  const CODE = 'contacts-code';

  const post = (url: string, payload: string) =>
    app.inject({
      method: 'POST', url, payload,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });

  const inTenant = async <T>(biz: string, fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const tx = <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>) => inTenant(BIZ, fn);

  const bid = async (biz = BIZ) => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const r = parseBusinessId(biz); if (!r.ok) throw new Error('fixture'); return r.value;
  };

  const state = async (channel: 'email' | 'whatsapp', identity: string, biz = BIZ) => {
    const { contactability } = await import('../../src/db/contacts.js');
    return inTenant(biz, async (t) => contactability(t, await bid(biz), channel, identity));
  };

  const list = async (biz = BIZ) => {
    const { listContacts } = await import('../../src/db/contacts.js');
    return inTenant(biz, async (t) => listContacts(t, await bid(biz)));
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);

    for (const b of [BIZ, OTHER]) {
      await inTenant(b, async (t) => {
        await sql`insert into businesses (id, name) values (${b}, 'Contacts Factory')
                  on conflict (id) do nothing`.execute(t);
      });
    }

    /**
     * A BUYER WHO WROTE FIRST. No consent row is ever created for him — his
     * message is the evidence, and the product finds it every time.
     *
     * AND DELIBERATELY NO `client_channels` ROW. That table is written
     * `on conflict do nothing` against an index unique on (channel, user id)
     * GLOBALLY, so a number another business already claimed produces no row —
     * which is the state every buyer in the seeded demo factory is in. A
     * fixture that creates one here (this one did) hides the bug completely,
     * and the bug is invisible in production too: a missing row reads as "no
     * consent", which is the fail-closed direction.
     */
    await tx(async (t) => {
      const client = (await sql<{ id: string }>`
        insert into clients (business_id, phone, display_name)
        values (${BIZ}, ${WA}, 'Ahmed') returning id::text as id`.execute(t)).rows[0]!.id;
      const conv = (await sql<{ id: string }>`
        insert into conversations (business_id, client_id, channel, phase)
        values (${BIZ}, ${client}::uuid, 'whatsapp', 'warm_intake') returning id::text as id`
        .execute(t)).rows[0]!.id;
      await sql`insert into messages (conversation_id, direction, input_type, text_content, sent_at)
                values (${conv}::uuid, 'inbound', 'text', 'price for 5000 tote bags?', now())`.execute(t);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE,
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('THE BUYER WHO WROTE FIRST NEEDS NO ROW — his consent is derived', async () => {
    const s = await state('whatsapp', WA);
    expect(s.consent).not.toBeNull();
    expect(s.consent!.evidence).toBe('inbound_message');
    expect(s.suppression).toBeNull();

    // and there is genuinely nothing stored for him.
    const stored = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from contact_consent where business_id = ${BIZ}`
      .execute(t).then((r) => r.rows[0]!.n));
    expect(stored).toBe(0);

    // NOR a channel row — the thing whose absence made this invisible.
    const chan = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from client_channels cc
        join clients c on c.id = cc.client_id
       where c.business_id = ${BIZ}`.execute(t).then((r) => r.rows[0]!.n));
    expect(chan, 'the fixture must not create one — that is what hid the bug').toBe(0);
    expect((await list()).some((c) => c.identity === WA)).toBe(true);
  });

  it('THE IDENTITY MATCHES ON THE wa_id — the form she types resolves to his row', async () => {
    // The whole derivation hangs on one canonical form. If `normalizeIdentity`
    // grew a second phone rule that produced '+8613…', this lookup would find
    // nothing and every buyer would silently need consent he already gave.
    const { normalizeIdentity } = await import('../../src/core/outreach/consent.js');
    const typed = normalizeIdentity('whatsapp', `+${WA.slice(0, 2)} ${WA.slice(2)}`);
    expect(typed.ok).toBe(true);
    expect(typed.ok && typed.value).toBe(WA);
    expect((await state('whatsapp', typed.ok ? typed.value : '')).consent).not.toBeNull();
  });

  it('HIS WHATSAPP IS NOT HIS EMAIL — the derivation does not cross channels', async () => {
    // He messaged her on WhatsApp, so he consented to WhatsApp. Whatever
    // address she has for him is untouched by that and needs its own evidence.
    expect((await state('email', `${WA}@example.com`)).consent).toBeNull();
  });

  it('THE PRODUCTION CALLER: she adds the card she took, and it has no consent yet', async () => {
    const res = await post('/app/contacts',
      `channel=email&identity=${encodeURIComponent(` ${CARD.toUpperCase()} `)}&name=Mei&company=Gulf`);
    expect(res.statusCode).toBe(302);

    // Stored canonical, so the address she types twice is one person.
    const row = (await list()).find((c) => c.identity === CARD);
    expect(row, 'the contact was not stored under its canonical address').toBeDefined();
    expect(row!.displayName).toBe('Mei');
    expect(row!.source).toBe('manual');
    expect(row!.consent).toBeNull();
  });

  it('and her page says so, rather than showing him as writable', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/contacts', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(CARD);
    expect(res.body).toContain('You have not said you may write to them');
    // The buyer who wrote is in the same list, with his own evidence.
    expect(res.body).toContain('They wrote to you first');
  });

  it('THE ATTESTATION CARRIES A NAME, and the name is whoever signed in', async () => {
    const res = await post('/app/contacts/consent', `channel=email&identity=${encodeURIComponent(CARD)}`);
    expect(res.statusCode).toBe(302);
    const s = await state('email', CARD);
    expect(s.consent!.evidence).toBe('owner_attestation');
    // M47's person, not a literal: whoever signed in is who stands behind it,
    // and for the owner that is the name on her own `people` row.
    const owner = await tx((t) => sql<{ name: string }>`
      select name from people where business_id = ${BIZ} and is_owner limit 1`
      .execute(t).then((r) => r.rows[0]?.name ?? ''));
    expect(owner).not.toBe('');
    expect(s.consent!.recordedBy).toBe(owner);
  });

  it('CONSENT IS APPEND-ONLY — the app role cannot edit what it says', async () => {
    await expect(tx((t) => sql`
      update contact_consent set evidence = 'inbound_message' where business_id = ${BIZ}
    `.execute(t))).rejects.toThrow(/permission denied/i);
  });

  it('SUPPRESSION BEATS THE ATTESTATION SHE JUST MADE', async () => {
    // Through the two-press path she actually walks: the row links to a page
    // that names the person and states the permanence, and THAT page posts.
    const confirm = await app.inject({
      method: 'GET', headers: { cookie },
      url: `/app/contacts/suppress?channel=email&identity=${encodeURIComponent(CARD)}`,
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.body).toContain('Mei');
    expect(confirm.body).toContain('This cannot be undone');
    expect(confirm.body).toContain('action="/app/contacts/suppress"');

    const res = await post('/app/contacts/suppress', `channel=email&identity=${encodeURIComponent(CARD)}`);
    expect(res.statusCode).toBe(302);

    const { mayContact } = await import('../../src/core/outreach/consent.js');
    const s = await state('email', CARD);
    expect(s.consent).not.toBeNull();          // the attestation is still on file
    expect(mayContact(s).ok).toBe(false);      // and it does not matter
  });

  it('a later attestation is REFUSED rather than quietly recorded and ignored', async () => {
    const before = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from contact_consent
       where business_id = ${BIZ} and identity = ${CARD}`.execute(t).then((r) => r.rows[0]!.n));
    const res = await post('/app/contacts/consent', `channel=email&identity=${encodeURIComponent(CARD)}`);
    expect(res.statusCode).toBe(302);
    expect(flashSaid(res, 'a-test-session-secret-of-sufficient-length')).toContain('That did not save');
    const after = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from contact_consent
       where business_id = ${BIZ} and identity = ${CARD}`.execute(t).then((r) => r.rows[0]!.n));
    expect(after).toBe(before);
  });

  it('IT SURVIVES ARCHIVING AND RE-ADDING THE SAME ADDRESS', async () => {
    // The reason suppression is keyed on the address and not on a row: this is
    // exactly how an unsubscribed buyer gets written to again.
    const { mayContact } = await import('../../src/core/outreach/consent.js');
    const row = (await list()).find((c) => c.identity === CARD)!;
    expect((await post(`/app/contacts/${row.id}/archive`, '')).statusCode).toBe(302);

    const res = await post('/app/contacts',
      `channel=email&identity=${encodeURIComponent(CARD)}&name=Mei`);
    expect(res.statusCode).toBe(302);

    const fresh = (await list()).filter((c) => c.identity === CARD);
    expect(fresh).toHaveLength(1);                       // one row per address, still
    expect(mayContact(fresh[0]!).ok).toBe(false);        // and still refused
    expect(fresh[0]!.suppression!.reason).toBe('unsubscribed');
  });

  it('ARCHIVING A BUYER WHO STILL WRITES TO HER DOES NOT MAKE HIM VANISH', async () => {
    /**
     * She adds his number to her list, then takes it off. He is still a buyer
     * mid-conversation, so he must still appear — from the derived side, live,
     * with his own message as the evidence. The row she archived was her
     * bookkeeping; archiving it is not a statement about whether he wrote.
     *
     * The merge preference is what decides this, and it is the one thing here
     * that a behavioural test would otherwise never touch: both orderings
     * produce a correct-looking list until the day these two collide.
     */
    await post('/app/contacts', `channel=whatsapp&identity=${encodeURIComponent(WA)}&name=Ahmed`);
    const added = (await list()).find((c) => c.identity === WA)!;
    expect(added.id, 'her own row should win while it is live').not.toBeNull();
    expect((await post(`/app/contacts/${added.id}/archive`, '')).statusCode).toBe(302);

    const after = (await list()).filter((c) => c.identity === WA);
    expect(after, 'he appears exactly once').toHaveLength(1);
    expect(after[0]!.archivedAt, 'and not as someone she removed').toBeNull();
    expect(after[0]!.consent!.evidence).toBe('inbound_message');

    const res = await app.inject({ method: 'GET', url: '/app/contacts', headers: { cookie } });
    expect(res.body).toContain('They wrote to you first');
  });

  it('THE APP ROLE CANNOT UNDO ONE — not by editing it, not by deleting it', async () => {
    await expect(tx((t) => sql`
      update suppressions set reason = 'bounced' where business_id = ${BIZ}`.execute(t)))
      .rejects.toThrow(/permission denied/i);
    await expect(tx((t) => sql`
      delete from suppressions where business_id = ${BIZ}`.execute(t)))
      .rejects.toThrow(/permission denied/i);
  });

  it('suppressing twice keeps the FIRST fact, not the most recent one', async () => {
    const before = await state('email', CARD);
    await post('/app/contacts/suppress',
      `channel=email&identity=${encodeURIComponent(CARD)}&reason=complained`);
    const after = await state('email', CARD);
    expect(after.suppression!.reason).toBe('unsubscribed');
    expect(after.suppression!.at).toEqual(before.suppression!.at);
  });

  it('HER PAGE AND THE ONE READER AGREE — no actions where there is no undo', async () => {
    const res = await app.inject({ method: 'GET', url: '/app/contacts', headers: { cookie } });
    const card = res.body.slice(res.body.indexOf(CARD));
    const nextRow = card.indexOf('<li class="ct');
    const block = nextRow === -1 ? card : card.slice(0, nextRow);
    expect(block).toContain('They asked you to stop');
    expect(block).not.toContain('/app/contacts/consent');
    expect(block).not.toContain('/app/contacts/suppress');
  });

  it('ANOTHER TENANT’S LIST IS INVISIBLE — the same address, a different answer', async () => {
    const { suppress } = await import('../../src/db/contacts.js');
    await inTenant(OTHER, async (t) => suppress(t, await bid(OTHER), {
      channel: 'whatsapp', identity: WA, reason: 'complained', detail: null,
    }));
    // Her buyer is untouched by another factory's suppression of the same number.
    expect((await state('whatsapp', WA)).suppression).toBeNull();
    expect((await state('whatsapp', WA, OTHER)).suppression!.reason).toBe('complained');
    expect((await list()).some((c) => c.identity === CARD && c.suppression)).toBe(true);
    expect((await list(OTHER)).some((c) => c.identity === CARD)).toBe(false);
  });

  it('M42 · HER CONTACT LIST ANSWERS THE GATE, not a second opinion of it', async () => {
    await post('/app/contacts', `channel=email&identity=${encodeURIComponent(FRESH)}&name=Yusuf`);
    await post('/app/contacts/consent', `channel=email&identity=${encodeURIComponent(FRESH)}`);

    const res = await app.inject({ method: 'GET', url: '/app/contacts', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    /**
     * Both people are refused, for DIFFERENT reasons, and both are the truth:
     *
     *   the e-mail contact — consent is on file and e-mail allows a first
     *     message, but her sending domain is not verified, so it cannot go
     *     (M40.1; before C4.a the reason was that no adapter existed at all).
     *   the buyer who WhatsApped — no template is approved, so the channel
     *     cannot carry a first message whatever she decides.
     *
     * Nothing in this product can cold-outreach today, and the page says so
     * twice rather than showing a green state it cannot honour. It opens when
     * the adapter lands and the conditions in M52 are met.
     */
    expect(res.body).toContain('does not allow a first message');
    expect(res.body).not.toContain('She can write to him first.');
    // And NOT "you have not said she may write first" — that would name a
    // decision she cannot make yet, about a switch e-mail does not have.
    expect(res.body).not.toContain('You have not said she may write first');
  });

  it('M42 · she turns writing-first on, and it is recorded with her name', async () => {
    const on = await post('/app/channels/outreach', 'channel=whatsapp&enabled=true');
    expect(on.statusCode).toBe(302);
    expect(flashSaid(on, 'a-test-session-secret-of-sufficient-length')).toContain('may now write first');

    const rows = await tx((t) => sql<{ enabled: boolean; by_actor: string }>`
      select enabled, by_actor from outreach_settings
       where business_id = ${BIZ} and channel = 'whatsapp' order by at, id`
      .execute(t).then((r) => r.rows));
    expect(rows.map((r) => r.enabled)).toEqual([true]);
    expect(rows[0]!.by_actor).not.toBe('');

    const page = await app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(page.body).toContain('She may write first here');
    expect(page.body).toContain('Stop writing first');
  });

  it('M42 · turning it off RECORDS a second row rather than erasing the first', async () => {
    const off = await post('/app/channels/outreach', 'channel=whatsapp&enabled=false');
    expect(off.statusCode).toBe(302);
    const rows = await tx((t) => sql<{ enabled: boolean }>`
      select enabled from outreach_settings
       where business_id = ${BIZ} and channel = 'whatsapp' order by at, id`
      .execute(t).then((r) => r.rows));
    expect(rows.map((r) => r.enabled)).toEqual([true, false]);

    const page = await app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(page.body).toContain('She does not write first here');
  });

  it('M42 · and the record cannot be edited afterwards', async () => {
    await expect(tx((t) => sql`
      update outreach_settings set enabled = true where business_id = ${BIZ}
    `.execute(t))).rejects.toThrow(/permission denied/i);
  });

  it('M42 · a decision that cannot take effect is refused, not stored', async () => {
    // Instagram and Messenger can never carry a first message. Neither is merely
    // hidden from the page — the writer refuses both, so a hand-made request
    // cannot create a setting with nothing behind it.
    //
    // C4.a — e-mail was on this list while it had no adapter, and came off it
    // the day `src/channels/email/` landed with a send path. That is the rule
    // this test pins working in the other direction: the switch becomes
    // storable exactly when it can take effect (asserted below), not before.
    for (const channel of ['instagram', 'messenger']) {
      const res = await post('/app/channels/outreach', `channel=${channel}&enabled=true`);
      expect(res.statusCode, channel).toBe(302);
      expect(flashSaid(res, 'a-test-session-secret-of-sufficient-length'), channel).toContain('did not save');
      const n = await tx((t) => sql<{ n: number }>`
        select count(*)::int as n from outreach_settings
         where business_id = ${BIZ} and channel = ${channel}`.execute(t).then((r) => r.rows[0]!.n));
      expect(n, channel).toBe(0);
    }
    // And the one that can take effect now is stored, with her decision on it.
    const email = await post('/app/channels/outreach', 'channel=email&enabled=true');
    expect(flashSaid(email, 'a-test-session-secret-of-sufficient-length')).not.toContain('did not save');
    const stored = await tx((t) => sql<{ n: number }>`
      select count(*)::int as n from outreach_settings
       where business_id = ${BIZ} and channel = 'email' and enabled`.execute(t).then((r) => r.rows[0]!.n));
    expect(stored).toBe(1);
  });

  it('M40.2 · A BUYER UNSUBSCRIBES HIMSELF, and it is permanent', async () => {
    const { mintUnsubscribe } = await import('../../src/outbound/unsubscribe.js');
    const token = mintUnsubscribe('a-test-session-secret-of-sufficient-length', {
      businessId: BIZ, channel: 'email', identity: FRESH, locale: 'en',
    });

    // GET renders and writes NOTHING — a scanner fetching the link must not
    // unsubscribe him.
    const page = await app.inject({ method: 'GET', url: `/u?t=${encodeURIComponent(token)}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Stop sending to me');
    expect((await state('email', FRESH)).suppression).toBeNull();

    const done = await app.inject({ method: 'POST', url: `/u?t=${encodeURIComponent(token)}` });
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain('Nothing more will be sent');

    const after = await state('email', FRESH);
    expect(after.suppression!.reason).toBe('unsubscribed');
    // and his consent is still on file — it simply does not matter any more
    expect(after.consent).not.toBeNull();
  });

  it('M40.2 · pressing it twice keeps the first fact', async () => {
    const { mintUnsubscribe } = await import('../../src/outbound/unsubscribe.js');
    const token = mintUnsubscribe('a-test-session-secret-of-sufficient-length', {
      businessId: BIZ, channel: 'email', identity: FRESH, locale: 'en',
    });
    const before = await state('email', FRESH);
    await app.inject({ method: 'POST', url: `/u?t=${encodeURIComponent(token)}` });
    expect((await state('email', FRESH)).suppression!.at).toEqual(before.suppression!.at);
  });

  it('M40.2 · A FORGED LINK IS 404, NOT 403 — and suppresses nobody', async () => {
    const { mintUnsubscribe } = await import('../../src/outbound/unsubscribe.js');
    const real = mintUnsubscribe('a-test-session-secret-of-sufficient-length', {
      businessId: BIZ, channel: 'email', identity: CARD, locale: 'en',
    });
    const forged = `${Buffer.from(JSON.stringify([BIZ, 'email', 'nobody@example.com', 'en']))
      .toString('base64url')}.${real.split('.')[1]}`;
    for (const url of [`/u?t=${encodeURIComponent(forged)}`, '/u?t=nonsense', '/u']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
      expect((await app.inject({ method: 'POST', url })).statusCode, url).toBe(404);
    }
    expect((await state('email', 'nobody@example.com')).suppression).toBeNull();
  });

  it('M40.2 · and the webhook is not mounted without a secret', async () => {
    const res = await app.inject({ method: 'POST', url: '/hooks/email', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('what is not an address is refused, and nothing is stored', async () => {
    const before = (await list()).length;
    for (const [channel, bad] of [['email', 'mei at example'], ['whatsapp', 'call me']] as const) {
      const res = await post('/app/contacts', `channel=${channel}&identity=${encodeURIComponent(bad)}`);
      expect(res.statusCode).toBe(302);
      expect(flashSaid(res, 'a-test-session-secret-of-sufficient-length')).toContain('does not look like');
    }
    expect((await list()).length).toBe(before);
  });
});
