import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql, type RawBuilder } from 'kysely';
import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { seedRunTenant, flashSaid } from './tenant.js';
import { BOUNDARY } from './importReview.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * BLOCK 4.4 (0232) — CUSTOMERS FROM A FILE, through the real routes and into real rows. What only Postgres can hold:
 *
 *   · a pasted table goes upload → columns → check → add, and the Check form's repeated `rows` all arrive (the scope's
 *     own parser: the app's keeps only the last);
 *   · a number already a customer — by `clients.phone` as typed, or by a WhatsApp address — is matched and never
 *     changed; two customers on one number is `ambiguous_existing`; the first row owns a number; a local number, an
 *     unknown language are refused by name;
 *   · adding writes a customer and their WhatsApp address and NOTHING else: no consent, conversation, allowlist entry,
 *     channel, message or outbound row; the file's language goes to `stated_language`, never `preferred_language`; the
 *     audit holds counts only; the contacts milestone is set once and never moves; the kept file is gone;
 *   · that customer's first WhatsApp message (the real parser's wa_id, the real ensureConversation) lands on the SAME
 *     customer; a customer who wrote on Instagram, with the same number on record, has no WhatsApp consent;
 *   · nothing ticked adds nobody and keeps the file; Tick all / Untick all; Discard; a file past seven days is gone
 *     to the routes and removed by the job; another workspace's file is "no longer kept", also to an admin
 *     connection; the workspace's erasure finds the table; a customer's erasure takes every file the workspace
 *     keeps (one may hold their number) and leaves another workspace's; staff are refused, and the customer list they
 *     land on says why (en and ar), once; refused files say why.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd232000-0000-4000-8000-${RUN}0001`;
const OTHER = `dd232000-0000-4000-8000-${RUN}0002`;
const CODE = `contact-import-owner-${RUN}`;
const STAFF_CODE = `CIMPORT-${RUN.toUpperCase()}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
type Tx = import('../../src/db/client.js').Tx;

/** The file the owner pastes; record 1 is the header. Each row says what it should become. */
const FILE = [
  'name,phone,language,notes',                              //  1 header
  'Nadia,+971 50 111 0101,ar,Met at the fair',             //  2 to add (ticked)
  'Omar,00971501110102,en,',                                //  3 to add (ticked) — 00 is international too
  'Amal Changed,+971501110001,fr,should not overwrite',     //  4 existing: clients.phone as typed with spaces
  'Basma,+971501110002,,',                                  //  5 existing: a WhatsApp address
  'Two Of Them,+971501110003,,',                            //  6 refused: two customers on this number
  'Nadia again,+971 50 111 0101,,',                         //  7 duplicate in file: row 2 owns it
  'Local,0501110104,,',                                     //  8 refused: not international (the country is never guessed)
  'Lang,+971501110105,Martian,',                            //  9 refused: language not recognised
  'Unticked,+971501110106,,',                               // 10 to add, left unticked
  'Iris,+971501110009,,',                                   // 11 existing: wrote on Instagram, number on record
].join('\n');

d('4.4 · customers from a file (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let owner = '';
  let staff = '';
  const ids: Record<string, string> = {};

  const bidOf = async (raw: string) => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
  };
  const inBiz = async <T>(raw: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(raw), fn);
  };
  const login = async (code: string) =>
    String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const post = (cookie: string, url: string, body: string) => app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: body });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const fields = (o: Record<string, string>) => new URLSearchParams(o).toString();
  /** Paste a table; answers the import's id (from the 303 to its Columns step). */
  const paste = async (text: string): Promise<string> => {
    const r = await post(owner, '/app/customers/import', fields({ text }));
    expect([r.statusCode, String(r.headers['location'])], r.body.slice(0, 300)).toEqual([303, expect.stringMatching(/^\/app\/customers\/import\/[0-9a-f-]{36}\/columns$/)]);
    return String(r.headers['location']).split('/')[4]!;
  };
  /** Every row the workspace holds that adding must never write. */
  const untouched = () => inBiz(BIZ, (tx) => sql<Record<string, number>>`
    select (select count(*)::int from contact_consent where business_id = ${BIZ}::uuid) as consent,
           (select count(*)::int from pilot_allowlist where business_id = ${BIZ}::uuid) as allowlist,
           (select count(*)::int from conversations where business_id = ${BIZ}::uuid) as conversations,
           (select count(*)::int from messages m join conversations c on c.id = m.conversation_id where c.business_id = ${BIZ}::uuid) as messages,
           (select count(*)::int from outbound_messages where business_id = ${BIZ}::uuid) as outbound,
           (select count(*)::int from channels where business_id = ${BIZ}::uuid) as channels,
           (select count(*)::int from contacts where business_id = ${BIZ}::uuid) as contacts`.execute(tx).then((r) => r.rows[0]!));
  const client = (id: string) => inBiz(BIZ, (tx) => sql<{ name: string | null; phone: string | null; preferred: string | null; stated: string | null; notes: string | null }>`
    select display_name as name, phone, preferred_language as preferred, stated_language as stated, notes from clients where id = ${id}::uuid`.execute(tx).then((r) => r.rows[0]));
  const byPhone = (phone: string) => inBiz(BIZ, (tx) => sql<{ id: string }>`
    select id::text as id from clients where business_id = ${BIZ}::uuid and phone = ${phone}`.execute(tx).then((r) => r.rows.map((x) => x.id)));
  const kept = (id: string) => inBiz(BIZ, (tx) => sql<{ n: number }>`select count(*)::int as n from contact_imports where id = ${id}::uuid`.execute(tx).then((r) => r.rows[0]!.n));
  const firstImported = () => inBiz(BIZ, (tx) => sql<{ at: Date | null }>`select contacts_first_imported_at as at from businesses where id = ${BIZ}::uuid`.execute(tx).then((r) => r.rows[0]!.at));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { hashCode } = await import('../../src/api/web/people.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    db = createDb(DATABASE_URL!);
    for (const [id, name] of [[BIZ, 'Contact Import Boutique'], [OTHER, 'Another Boutique']] as const) {
      await inBiz(id, (tx) => sql`insert into businesses (id, name, kind, country, currency) values (${id}, ${name}, 'brand', 'AE', 'AED')
                                  on conflict (id) do nothing`.execute(tx));
    }
    await inBiz(BIZ, async (tx) => {
      const one = async (q: RawBuilder<{ id: string }>) => (await q.execute(tx)).rows[0]!.id;
      // Amal: the number as the owner once typed it, with spaces and a plus.
      ids['amal'] = await one(sql<{ id: string }>`insert into clients (business_id, display_name, phone, notes) values (${BIZ}, 'Amal', '+971 50 111 0001', 'VIP') returning id::text as id`);
      // Basma: known only by her WhatsApp address (as an Instagram-first customer who later gave her number would not be).
      ids['basma'] = await one(sql<{ id: string }>`insert into clients (business_id, display_name) values (${BIZ}, 'Basma') returning id::text as id`);
      await sql`insert into client_channels (business_id, client_id, channel, channel_user_id) values (${BIZ}, ${ids['basma']}, 'whatsapp', '971501110002')`.execute(tx);
      // Two customers on one number: the file cannot say which it means.
      for (const n of ['Twin A', 'Twin B']) await sql`insert into clients (business_id, display_name, phone) values (${BIZ}, ${n}, '+971501110003')`.execute(tx);
      // Iris wrote on Instagram; her number is on record in WhatsApp's digits. That history is no WhatsApp consent.
      ids['iris'] = await one(sql<{ id: string }>`insert into clients (business_id, display_name, phone) values (${BIZ}, 'Iris', '971501110009') returning id::text as id`);
      await sql`insert into client_channels (business_id, client_id, channel, channel_user_id) values (${BIZ}, ${ids['iris']}, 'instagram', ${`iris-${RUN}`})`.execute(tx);
      const conv = await one(sql<{ id: string }>`insert into conversations (business_id, client_id, channel) values (${BIZ}, ${ids['iris']}, 'instagram') returning id::text as id`);
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values (${conv}, ${`ig-${RUN}`}, 'inbound', 'text', 'hello', now())`.execute(tx);
      // The positive control: Wafa wrote on WhatsApp, so she has (derived) WhatsApp consent.
      const w = await ensureConversation(tx, await bidOf(BIZ), '971501110010', 'Wafa', 'whatsapp');
      await sql`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values (${w.conversationId}, ${`wa-${RUN}`}, 'inbound', 'text', 'hi', now())`.execute(tx);
      await sql`insert into people (business_id, name, code_hash) values (${BIZ}, 'Staff Member', ${hashCode(SECRET, STAFF_CODE)})`.execute(tx);
    });
    // Another workspace holds a customer on Nadia's number: never matched here.
    await inBiz(OTHER, (tx) => sql`insert into clients (business_id, display_name, phone) values (${OTHER}, 'Elsewhere', '971501110101')`.execute(tx));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', factsTtlMs: 0,
      secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    owner = await login(CODE);
    staff = await login(STAFF_CODE);
    expect(owner).not.toBe('');
    expect(staff).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('UPLOAD → COLUMNS → CHECK: the header names the columns, and every row says what adding would make of it', async () => {
    const id = await paste(FILE);
    ids['file'] = id;
    const columns = await get(owner, `/app/customers/import/${id}/columns`);
    expect(columns.statusCode).toBe(200);
    expect(columns.body).toContain('name="header" value="on" checked');
    // The owner keeps the guessed columns: name 0, phone 1, language 2, notes 3.
    const saved = await post(owner, `/app/customers/import/${id}/columns`, fields({ name: '0', phone: '1', language: '2', notes: '3', header: 'on' }));
    expect([saved.statusCode, saved.headers['location']]).toEqual([303, `/app/customers/import/${id}`]);
    expect((await get(owner, `/app/customers/import/${id}`)).statusCode).toBe(200);

    const { previewContactImport } = await import('../../src/db/contactImports.js');
    const preview = (await inBiz(BIZ, async (tx) => previewContactImport(tx, await bidOf(BIZ), id)))!;
    const verdict = (row: number) => preview.rows.find((r) => r.row === row)!.verdict;
    expect(verdict(2)).toMatchObject({ kind: 'to_add', selected: true, contact: { name: 'Nadia', phone: '971501110101', language: 'ar', notes: 'Met at the fair' } });
    expect(verdict(3)).toMatchObject({ kind: 'to_add', contact: { phone: '971501110102', language: 'en', notes: null } });
    expect(verdict(4)).toMatchObject({ kind: 'existing', customer: { id: ids['amal'], name: 'Amal' } });
    expect(verdict(5)).toMatchObject({ kind: 'existing', customer: { id: ids['basma'], name: 'Basma' } });
    expect(verdict(6)).toEqual({ kind: 'refused', reason: 'ambiguous_existing' });
    expect(verdict(7)).toEqual({ kind: 'duplicate_in_file', firstRow: 2 });
    expect(verdict(8)).toEqual({ kind: 'refused', reason: 'not_international' });
    expect(verdict(9)).toEqual({ kind: 'refused', reason: 'language_not_recognised' });
    expect(verdict(10)).toMatchObject({ kind: 'to_add' });
    expect(verdict(11)).toMatchObject({ kind: 'existing', customer: { id: ids['iris'] } });
    expect(preview.counts).toEqual({ total: 10, toAdd: 3, existing: 3, duplicateInFile: 1, refused: 3, selected: 3 });
  });

  it('A FORM THAT CHOOSES NO PHONE COLUMN is refused, and the other choices come back as sent', async () => {
    // No header word and no international number: nothing is guessed as the phone.
    const id = await paste('Who;Where\nZed;Dubai');
    // A Check visited before a phone is chosen goes back to Columns.
    const early = await get(owner, `/app/customers/import/${id}`);
    expect([early.statusCode, early.headers['location']]).toEqual([303, `/app/customers/import/${id}/columns`]);
    const r = await post(owner, `/app/customers/import/${id}/columns`, fields({ name: '0', phone: '', language: '', notes: '', header: 'on' }));
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain(esc(t('en', 'contactImport.refused.no_phone_column')));
    await post(owner, `/app/customers/import/${id}/discard`, 'go=1');
  });

  it('NOTHING TICKED adds nobody and keeps the file and the ticks; Tick all and Untick all are the ticks only', async () => {
    const id = ids['file']!;
    const before = await untouched();
    const none = await post(owner, `/app/customers/import/${id}/confirm`, 'go=1');
    expect(none.headers['location']).toBe(`/app/customers/import/${id}`);
    expect(flashSaid(none, SECRET)).toBe(t('en', 'contactImport.flash.none'));
    expect(await kept(id)).toBe(1);
    expect(await byPhone('971501110101')).toEqual([]);
    expect(await firstImported()).toBeNull();
    expect((await get(owner, `/app/customers/import/${id}`)).body).not.toMatch(/name="rows" value="\d+" checked/);

    const all = await post(owner, `/app/customers/import/${id}/select`, fields({ selection: 'all' }));
    expect([all.statusCode, all.headers['location']]).toEqual([303, `/app/customers/import/${id}#contact-toAdd`]);
    expect((await get(owner, `/app/customers/import/${id}`)).body.match(/name="rows" value="\d+" checked/g)).toHaveLength(3);
    await post(owner, `/app/customers/import/${id}/select`, fields({ selection: 'none' }));
    expect((await get(owner, `/app/customers/import/${id}`)).body).not.toMatch(/name="rows" value="\d+" checked/);
    expect(await untouched()).toEqual(before);
  });

  it('ADD: two ticked rows (the repeated `rows`) become customers with their WhatsApp address — and nothing else is written', async () => {
    const id = ids['file']!;
    const before = await untouched();
    const amalBefore = await client(ids['amal']!);
    const r = await post(owner, `/app/customers/import/${id}/confirm`, 'rows=2&rows=3');
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    expect(String(r.headers['cache-control'])).toContain('no-store');

    // Both rows arrived (the app's own parser kept only the last: Omar alone).
    const [nadia] = await byPhone('971501110101');
    const [omar] = await byPhone('971501110102');
    expect(nadia && omar).toBeTruthy();
    ids['nadia'] = nadia!;
    expect(await client(nadia!)).toEqual({ name: 'Nadia', phone: '971501110101', preferred: null, stated: 'ar', notes: 'Met at the fair' });
    expect(await client(omar!)).toMatchObject({ name: 'Omar', preferred: null, stated: 'en', notes: null });
    expect(await byPhone('971501110106')).toEqual([]);   // unticked: not added
    const channels = await inBiz(BIZ, (tx) => sql<{ client: string; channel: string; identity: string }>`
      select client_id::text as client, channel, channel_user_id as identity from client_channels
       where client_id in (${nadia!}::uuid, ${omar!}::uuid) order by channel_user_id`.execute(tx).then((x) => x.rows));
    expect(channels).toEqual([
      { client: nadia, channel: 'whatsapp', identity: '971501110101' },
      { client: omar, channel: 'whatsapp', identity: '971501110102' },
    ]);
    // A customer already on record is never changed, whatever the file says about them.
    expect(await client(ids['amal']!)).toEqual(amalBefore);
    expect(await inBiz(BIZ, (tx) => sql<{ n: number }>`select count(*)::int as n from client_channels where client_id = ${ids['iris']}::uuid and channel = 'whatsapp'`.execute(tx).then((x) => x.rows[0]!.n))).toBe(0);

    // No consent, allowlist, conversation, message, outbound, channel or contact row.
    expect(await untouched()).toEqual(before);
    // The audit holds counts, never a name or a number.
    const audit = await inBiz(BIZ, (tx) => sql<{ detail: Record<string, unknown> }>`
      select detail from channel_audit where business_id = ${BIZ}::uuid and action = 'customers_imported' order by at desc limit 1`.execute(tx).then((x) => x.rows[0]!.detail));
    expect(audit).toEqual({ source: 'paste', total: 10, added: 2, existing: 3, newlyMatched: 0, notSelected: 1, duplicateInFile: 1, refused: 3 });
    expect(JSON.stringify(audit)).not.toMatch(/Nadia|9715011/);
    // The milestone, the file gone, and a second send of the same form adds nothing.
    const first = await firstImported();
    expect(first).toBeInstanceOf(Date);
    expect(await kept(id)).toBe(0);
    const again = await post(owner, `/app/customers/import/${id}/confirm`, 'rows=2&rows=3');
    expect(flashSaid(again, SECRET)).toBe(t('en', 'contactImport.flash.gone'));
    expect(await byPhone('971501110101')).toHaveLength(1);
  });

  it('THE CONTACTS MILESTONE is the first import and never moves: not by a later file, not by an update', async () => {
    const first = (await firstImported())!;
    const id = await paste('name,phone\nAmal,+971501110001');
    await post(owner, `/app/customers/import/${id}/columns`, fields({ name: '0', phone: '1', language: '', notes: '', header: 'on' }));
    expect((await post(owner, `/app/customers/import/${id}/confirm`, 'go=1')).statusCode).toBe(200);   // all existing: still added
    expect(await firstImported()).toEqual(first);
    await inBiz(BIZ, (tx) => sql`update businesses set contacts_first_imported_at = null where id = ${BIZ}::uuid`.execute(tx));
    await inBiz(BIZ, (tx) => sql`update businesses set contacts_first_imported_at = now() + interval '1 day' where id = ${BIZ}::uuid`.execute(tx));
    expect(await firstImported()).toEqual(first);
  });

  it('THEIR FIRST WHATSAPP MESSAGE lands on the same customer (the real parser\'s wa_id); no WhatsApp history is no consent', async () => {
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { parseWebhook } = await import('../../src/channels/whatsapp/parse.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { contactability } = await import('../../src/db/contacts.js');
    const bid = await bidOf(BIZ);
    // Imported, never wrote: no consent. Wrote on Instagram, same number on record: no WhatsApp consent either.
    expect((await inBiz(BIZ, (tx) => contactability(tx, bid, 'whatsapp', '971501110101'))).consent).toBeNull();
    expect((await inBiz(BIZ, (tx) => contactability(tx, bid, 'whatsapp', '971501110009'))).consent).toBeNull();
    // The control: a customer who wrote on WhatsApp has it.
    expect((await inBiz(BIZ, (tx) => contactability(tx, bid, 'whatsapp', '971501110010'))).consent).toMatchObject({ evidence: 'inbound_message' });

    const sim = whatsappSimulator([], { tag: `ci${RUN}` });
    const hook = sim.inboundText({ from: '971501110101', text: 'Hello, is the bag still available?', name: 'Nadia W' });
    const event = parseWebhook(JSON.parse(hook.rawBody)).find((e) => e.kind === 'message') as { waId: string; profileName: string | null } | undefined;
    expect(event?.waId).toBe('971501110101');
    const landed = await inBiz(BIZ, (tx) => ensureConversation(tx, bid, event!.waId, event!.profileName, 'whatsapp'));
    expect(landed.clientId).toBe(ids['nadia']);
    expect(await byPhone('971501110101')).toEqual([ids['nadia']]);
    // The name she typed stays; the profile name does not overwrite it.
    expect((await client(ids['nadia']!))?.name).toBe('Nadia');
  });

  it('DISCARD removes the kept file and nothing else; a file another workspace kept is "no longer kept"', async () => {
    const id = await paste('name,phone\nDina,+971501110120');
    const before = await untouched();
    const r = await post(owner, `/app/customers/import/${id}/discard`, 'go=1');
    expect([r.headers['location'], flashSaid(r, SECRET)]).toEqual(['/app/customers/import', t('en', 'contactImport.flash.discarded')]);
    expect(await kept(id)).toBe(0);
    expect(await untouched()).toEqual(before);
    expect(flashSaid(await post(owner, `/app/customers/import/${id}/discard`, 'go=1'), SECRET)).toBe(t('en', 'contactImport.flash.gone'));

    const { createContactImport } = await import('../../src/db/contactImports.js');
    const theirs = await inBiz(OTHER, async (tx) => createContactImport(tx, await bidOf(OTHER), { source: 'paste', records: [['name', 'phone'], ['X', '+971501110130']], createdBy: 'test' }));
    for (const res of [await get(owner, `/app/customers/import/${theirs}`), await get(owner, `/app/customers/import/${theirs}/columns`),
      await post(owner, `/app/customers/import/${theirs}/confirm`, 'rows=2'), await post(owner, `/app/customers/import/${theirs}/discard`, 'go=1')]) {
      expect(flashSaid(res, SECRET)).toBe(t('en', 'contactImport.flash.gone'));
    }
    expect(await inBiz(OTHER, (tx) => sql<{ n: number }>`select count(*)::int as n from contact_imports where id = ${theirs}::uuid`.execute(tx).then((x) => x.rows[0]!.n))).toBe(1);
  });

  it('SEVEN DAYS: an older file is gone to the routes at once, and the hourly job removes it — and only it', async () => {
    const id = await paste('name,phone\nOld,+971501110140');
    await inBiz(BIZ, (tx) => sql`update contact_imports set created_at = now() - interval '8 days' where id = ${id}::uuid`.execute(tx));
    expect(flashSaid(await get(owner, `/app/customers/import/${id}/columns`), SECRET)).toBe(t('en', 'contactImport.flash.gone'));
    const fresh = await paste('name,phone\nNew,+971501110141');
    // The negative control: a day-old file in ANOTHER workspace, which the app role's call must not reach.
    const { createContactImport, expireContactImports } = await import('../../src/db/contactImports.js');
    const dayOld = await inBiz(OTHER, async (tx) => createContactImport(tx, await bidOf(OTHER), { source: 'paste', records: [['name', 'phone'], ['Y', '+971501110131']], createdBy: 'test' }));
    await inBiz(OTHER, (tx) => sql`update contact_imports set created_at = now() - interval '1 day' where id = ${dayOld}::uuid`.execute(tx));
    const theirs = async (): Promise<number> =>
      inBiz(OTHER, (tx) => sql<{ n: number }>`select count(*)::int as n from contact_imports where id = ${dayOld}::uuid`.execute(tx).then((x) => x.rows[0]!.n));

    expect(await expireContactImports(db)).toBeGreaterThanOrEqual(1);
    expect(await kept(id)).toBe(0);
    expect(await kept(fresh)).toBe(1);
    expect(await theirs()).toBe(1);
    // No caller can move the cut-off: the function takes no time, so a far-future one is not a call that exists.
    await expect(sql`select expire_contact_imports(${'3000-01-01T00:00:00Z'}::timestamptz)`.execute(db)).rejects.toThrow(/does not exist/);
    expect(await expireContactImports(db)).toBe(0);
    expect([await kept(fresh), await theirs()]).toEqual([1, 1]);

    await post(owner, `/app/customers/import/${fresh}/discard`, 'go=1');
    await inBiz(OTHER, (tx) => sql`select contact_import_discard(${dayOld}::uuid)`.execute(tx));
  });

  it('A FILE: a CSV upload, an Excel workbook, and the refusals each named', async () => {
    const upload = (bytes: Buffer, name: string, type: string) => app.inject({
      method: 'POST', url: '/app/customers/import',
      headers: { cookie: owner, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: Buffer.concat([
        Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
        bytes, Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
      ]),
    });
    const csv = await upload(Buffer.from('name,phone\nFile Person,+971501110150\n'), 'customers.csv', 'text/csv');
    expect([csv.statusCode, String(csv.headers['location'])]).toEqual([303, expect.stringMatching(/\/columns$/)]);
    const xlsx = await upload(workbook([['Name', 'Phone'], ['Sheet Person', '+971501110151']]), 'customers.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect([xlsx.statusCode, String(xlsx.headers['location'])]).toEqual([303, expect.stringMatching(/\/columns$/)]);
    expect((await get(owner, String(xlsx.headers['location']))).body).toContain('Sheet Person');

    const refused = async (res: Awaited<ReturnType<typeof upload>>, reason: string) => {
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain(esc(t('en', `contactImport.refused.${reason}` as never)));
    };
    await refused(await upload(Buffer.alloc(0), 'empty.csv', 'text/csv'), 'empty');
    await refused(await upload(Buffer.from([0xff, 0xfe, 0x00, 0xd8, 0x41]), 'broken.csv', 'text/csv'), 'encoding');
    await refused(await post(owner, '/app/customers/import', fields({ text: '   ' })), 'empty');
    for (const loc of [csv.headers['location'], xlsx.headers['location']]) {
      await post(owner, `${String(loc).replace(/\/columns$/, '')}/discard`, 'go=1');
    }
  });

  it('STAFF are told the owner decides, and nothing is read or written', async () => {
    const id = await paste('name,phone\nKept,+971501110160');
    for (const res of [await get(staff, '/app/customers/import'), await get(staff, `/app/customers/import/${id}`),
      await post(staff, '/app/customers/import', fields({ text: 'name,phone\nX,+971501110161' })),
      await post(staff, `/app/customers/import/${id}/confirm`, 'rows=2'), await post(staff, `/app/customers/import/${id}/discard`, 'go=1')]) {
      expect(res.statusCode).toBe(302);
      expect(flashSaid(res, SECRET)).toBe(t('en', 'staff.notAllowed'));
    }
    expect(await kept(id)).toBe(1);
    expect(await byPhone('971501110160')).toEqual([]);
    expect(await byPhone('971501110161')).toEqual([]);
    await post(owner, `/app/customers/import/${id}/discard`, 'go=1');
  });

  it('STAFF SENT AWAY read why on the customer list (en and ar): the notice is drawn once, and its cookie cleared', async () => {
    const { FLASH_COOKIE } = await import('../../src/api/web/flash.js');
    const cookies = (res: { headers: Record<string, unknown> }): string[] => {
      const raw = res.headers['set-cookie'];
      return Array.isArray(raw) ? raw.map(String) : raw === undefined ? [] : [String(raw)];
    };
    for (const locale of ['en', 'ar'] as const) {
      const lang = { 'accept-language': locale };
      const sent = await app.inject({ method: 'GET', url: '/app/customers/import', headers: { cookie: staff, ...lang } });
      expect([sent.statusCode, sent.headers['location']]).toEqual([302, '/app/customers']);
      const notice = cookies(sent).find((c) => c.startsWith(`${FLASH_COOKIE}=`))?.split(';')[0] ?? '';
      expect(notice.length).toBeGreaterThan(FLASH_COOKIE.length + 1);

      const landed = await app.inject({ method: 'GET', url: '/app/customers', headers: { cookie: `${staff}; ${notice}`, ...lang } });
      expect(landed.statusCode, landed.body.slice(0, 300)).toBe(200);
      const words = esc(t(locale, 'staff.notAllowed'));
      expect(landed.body.split(words).length - 1, locale).toBe(1);
      // Read once: the page clears the cookie it drew.
      expect(cookies(landed).find((c) => c.startsWith(`${FLASH_COOKIE}=`)), locale).toMatch(new RegExp(`^${FLASH_COOKIE}=;.*Max-Age=0`));
      // And a list opened without it says nothing of the kind.
      expect((await app.inject({ method: 'GET', url: '/app/customers', headers: { cookie: staff, ...lang } })).body).not.toContain(words);
    }
  });

  it.skipIf(!MIGRATE_URL)('AN ADMIN CONNECTION (row security off) still reads only the workspace named; the workspace\'s erasure finds the table', async () => {
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { createContactImport, loadContactImport, contactMatches } = await import('../../src/db/contactImports.js');
    const admin = createDb(MIGRATE_URL!);
    try {
      const theirs = await inBiz(OTHER, async (tx) => createContactImport(tx, await bidOf(OTHER), { source: 'paste', records: [['phone'], ['+971501110170']], createdBy: 'test' }));
      const bid = await bidOf(BIZ);
      await withTenantTx(admin, bid, async (tx) => {
        expect(await loadContactImport(tx, bid, theirs)).toBeNull();
        // OTHER's customer on Nadia's number is not a match here; Nadia is.
        expect([...(await contactMatches(tx, bid, ['971501110101'])).get('971501110101') ?? []].map((c) => c.id)).toEqual([ids['nadia']]);
      });
      const steps = (await sql<{ label: string }>`select label from workspace_erasure_steps()`.execute(admin)).rows.map((r) => r.label);
      expect(steps).toContain('contact_imports');
    } finally {
      await admin.destroy();
    }
  });

  // Last on purpose: it erases a customer, and with them every file this workspace still keeps.
  it.skipIf(!MIGRATE_URL)('A CUSTOMER\'S ERASURE takes every file the workspace keeps (one may hold their number); another workspace\'s stays', async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { createContactImport } = await import('../../src/db/contactImports.js');
    // Zara wrote on WhatsApp; the owner then kept a file that holds her number, and another that does not.
    const zara = await inBiz(BIZ, async (tx) => ensureConversation(tx, await bidOf(BIZ), '971501110180', 'Zara', 'whatsapp'));
    const hers = await paste('name,phone\nZara,+971 50 111 0180\nSomeone,+971501110181');
    const another = await paste('name,phone\nElse,+971501110182');
    const theirs = await inBiz(OTHER, async (tx) => createContactImport(tx, await bidOf(OTHER), { source: 'paste', records: [['name', 'phone'], ['Z', '+971501110180']], createdBy: 'test' }));
    const othersKept = () => inBiz(OTHER, (tx) => sql<{ n: number }>`select count(*)::int as n from contact_imports where id = ${theirs}::uuid`.execute(tx).then((x) => x.rows[0]!.n));
    expect([await kept(hers), await kept(another), await othersKept()]).toEqual([1, 1, 1]);

    const r = await post(owner, `/app/conversations/${zara.conversationId}/deletion/erase`, fields({ asked: '1', note: 'Asked on the phone' }));
    expect([r.statusCode, r.headers['location']], r.body.slice(0, 300)).toEqual([302, '/app/settings/data#buyers']);

    // Every file this workspace kept is gone, so adding cannot bring her back.
    expect([await kept(hers), await kept(another)]).toEqual([0, 0]);
    expect(await inBiz(BIZ, (tx) => sql<{ n: number }>`select count(*)::int as n from contact_imports where business_id = ${BIZ}::uuid`.execute(tx).then((x) => x.rows[0]!.n))).toBe(0);
    for (const res of [await get(owner, `/app/customers/import/${hers}/columns`), await post(owner, `/app/customers/import/${hers}/confirm`, 'rows=2')]) {
      expect(flashSaid(res, SECRET)).toBe(t('en', 'contactImport.flash.gone'));
    }
    expect(await byPhone('971501110180')).toEqual([]);
    expect(await inBiz(BIZ, (tx) => sql<{ n: number }>`
      select count(*)::int as n from client_channels where business_id = ${BIZ}::uuid and channel_user_id = '971501110180'`.execute(tx).then((x) => x.rows[0]!.n))).toBe(0);
    // The negative control: another workspace's file, on the same number, is untouched.
    expect(await othersKept()).toBe(1);

    // The erasure's own counts name it — the ledger line the operator is sent, and replay-erasures repeats.
    const admin = createDb(MIGRATE_URL!);
    try {
      const line = (await sql<{ counts: { erased?: Record<string, number> } }>`
        select counts from erasure_ledger where business_id = ${BIZ}::uuid and customer_id = ${zara.clientId}::uuid`.execute(admin)).rows;
      expect(line).toHaveLength(1);
      expect(line[0]!.counts.erased?.['contact_imports']).toBeGreaterThanOrEqual(2);
    } finally {
      await admin.destroy();
    }
    await inBiz(OTHER, (tx) => sql`select contact_import_discard(${theirs}::uuid)`.execute(tx));
  });
});

/** The smallest workbook the reader takes: one sheet of inline strings (as tests/integration/ext-extract.test.ts builds). */
function workbook(rows: readonly (readonly string[])[]): Buffer {
  const col = (i: number) => String.fromCharCode(65 + i);
  const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) =>
    `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${xmlEsc(c)}</t></is></c>`).join('')}</row>`).join('');
  const parts: Record<string, string> = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheet}</sheetData></worksheet>`,
  };
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = Buffer.from(text); const data = deflateRawSync(raw); const n = Buffer.from(name);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, n, data); centrals.push(c, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
