import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * D6 (Phase 5, item 7; 0191) — the done-criterion (PHASE-5.md §4): a receipt, invoice or bill read into a DRAFT the
 * owner confirms, never posted alone. Through the routes, with a recorded reader (no model is called in tests).
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `d6d60000-0000-4000-8000-${RUN}0001`;
const CODE = `papers-owner-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const KEY = randomBytes(32);
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(64)]);
const PDF = Buffer.from('%PDF-1.4\n% a bill\n');

d('D6 · the books\' papers, read into a draft (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let tenant: pg.Client;
  let owner = '';
  let accountant = '';
  let k: Record<'purchases' | 'tva' | 'payable' | 'ac' | 'tax' | 'supplier', string>;
  let answer = '';
  const reads: string[] = [];
  const as = <T>(fn: (q: Q) => Promise<T>) => asTenant(tenant, BIZ, fn);
  const cookiesOf = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!);
  const session = (r: { headers: Record<string, unknown> }) => cookiesOf(r).find((c) => c.startsWith('yf_session=')) ?? '';
  const notice = async (r: { headers: Record<string, unknown> }) =>
    (await app.inject({ method: 'GET', url: String(r.headers['location']).split('#')[0]!, headers: { cookie: `${owner}; ${cookiesOf(r).join('; ')}` } })).body;
  const upload = (bytes: Buffer, name: string, type: string, who = owner) => {
    const b = `----nomi${RUN}`;
    return app.inject({ method: 'POST', url: '/app/books/papers', headers: { cookie: who, 'content-type': `multipart/form-data; boundary=${b}` },
      payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="paper"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), bytes, Buffer.from(`\r\n--${b}--\r\n`)]) });
  };
  const post = (url: string, body: Record<string, string> = {}, who = owner) => app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(),
    headers: { cookie: who, 'content-type': 'application/x-www-form-urlencoded' } });
  const bill = (o: Record<string, unknown> = {}) => JSON.stringify({ kind: 'bill', supplier: { name: 'Rif Coton', taxId: '' }, number: 'FA-311', date: '2026-04-05',
    currency: 'MAD', lines: [{ label: 'Coton écru', net: '1 000,00', taxRate: '20', tax: '200,00' }, { label: 'Transport', net: '50,00', taxRate: '', tax: '' }],
    totalNet: '1 050,00', totalTax: '200,00', total: '1 250,00', ...o });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [BIZ, `Papers ${RUN}`]);
    k = await as(async (q) => {
      const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
      const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
      const out = { purchases: await acc('6121', 'expense'), tva: await acc('34552', 'asset'), payable: await acc('4411', 'liability'),
        ac: await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'AC', 'Achats', 'purchases') returning id::text as id`),
        supplier: await one(`insert into parties (business_id, code, name, kind) values (current_business_id(), 'F001', 'Rif Coton', 'supplier') returning id::text as id`),
        tax: '' };
      out.tax = await one(`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values (current_business_id(), 'TVA20D', 'TVA récupérable 20 %', 20, 'deductible', $1, '2026-01-01') returning id::text as id`, [out.tva]);
      await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31')`);
      return out;
    });
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    const { documentStoresFrom } = await import('../../src/db/documents.js');
    db = createDb(DATABASE_URL!);
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {}, credentialKey: KEY, documents: documentStoresFrom({}, KEY), pdfReadable: false,
      documentReader: { read: async ({ mediaType }: { mediaType: string }) => { reads.push(mediaType); return { answer, cutOff: false, promptVersion: 'books-document-1', modelId: 'recorded', usage: { inputTokens: 900, outputTokens: 120 } }; } },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = (code: string) => app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    owner = session(await login(CODE));
    const acct = await addPerson(db, BIZ, SECRET, `Accountant ${RUN}`, 'accountant');
    if (acct.code !== 'added') throw new Error('fixture');
    accountant = session(await login(acct.accessCode));
  });
  afterAll(async () => { await app?.close(); await db?.destroy(); await tenant?.end(); await purgeBusinesses(admin, [BIZ], 'books-papers-test'); await admin?.end(); });

  let paper = '';
  it('KEPT: a photo of a bill is sealed in the workspace\'s store; a file that only claims to be one is refused', async () => {
    expect(await notice(await upload(Buffer.from('not a picture'), 'x.png', 'image/png'))).toContain('That is not a paper Nomi keeps');
    const r = await upload(PNG, 'facture-rif.png', 'image/png');
    expect(await notice(r)).toContain('Kept.');
    paper = String(r.headers['location']).split('/').pop()!;
    expect((await as((q) => q(`select name, media_type, bytes from documents where id = $1`, [paper]))).rows[0]).toEqual({ name: 'facture-rif.png', media_type: 'image/png', bytes: PNG.length });
    const file = await app.inject({ method: 'GET', url: `/app/books/papers/${paper}/file`, headers: { cookie: owner } });
    expect(file.rawPayload.equals(PNG)).toBe(true);
  });

  it('READ: what is printed, kept as read; one of the day\'s reads spent', async () => {
    answer = bill();
    expect(await notice(await post(`/app/books/papers/${paper}/read`))).toContain('Read. Check it, then draft the entry.');
    expect(reads).toEqual(['image/png']);
    const kept = (await as((q) => q(`select outcome, reading->>'number' as number, reading->>'total' as total, jsonb_array_length(problems) as problems from document_readings where document_id = $1`, [paper]))).rows;
    expect(kept).toEqual([{ outcome: 'read', number: 'FA-311', total: '1250', problems: 0 }]);
    expect((await as((q) => q(`select photo_reads from allowance_today()`))).rows[0].photo_reads).toBe(1);
    const body = (await app.inject({ method: 'GET', url: `/app/books/papers/${paper}`, headers: { cookie: owner } })).body;
    expect(body).toContain('Rif Coton');
    expect(body).toContain('action="/app/books/papers/' + paper + '/draft"');
  });

  it('DRAFTED, NEVER POSTED: the owner\'s accounts and supplier; the tax to its code\'s account; the supplier credited the total; once', async () => {
    const reading = (await as((q) => q(`select id::text as id from document_readings where document_id = $1`, [paper]))).rows[0].id as string;
    const choice = { reading, journal: k.ac, party: k.supplier, payable: k.payable, account0: k.purchases, tax0: k.tax, account1: k.purchases, tax1: '' };
    expect(await notice(await post(`/app/books/papers/${paper}/draft`, { ...choice, account1: '' }))).toContain('Choose the journal, the supplier');
    const r = await post(`/app/books/papers/${paper}/draft`, choice);
    expect(await notice(r)).toContain('Drafted. Check it, then post it.');
    const entry = String(r.headers['location']).split('/').pop()!;
    const e = (await as((q) => q(`select state, document_ref, document_date::text as day, number from journal_entries where id = $1`, [entry]))).rows[0];
    expect(e).toEqual({ state: 'draft', document_ref: 'FA-311', day: '2026-04-05', number: null });
    const lines = (await as((q) => q(`select a.code, p.code as party, l.debit::text, l.credit::text from journal_lines l join accounts a on a.id = l.account_id
      left join parties p on p.id = l.party_id where l.entry_id = $1 order by l.line_no`, [entry]))).rows;
    expect(lines).toEqual([
      { code: '6121', party: null, debit: '1000.00', credit: '0.00' }, { code: '6121', party: null, debit: '50.00', credit: '0.00' },
      { code: '34552', party: null, debit: '200.00', credit: '0.00' }, { code: '4411', party: 'F001', debit: '0.00', credit: '1250.00' }]);
    expect(await notice(await post(`/app/books/papers/${paper}/draft`, choice))).toContain('An entry was drafted from this reading already.');
  });

  it('A READING WITH PROBLEMS drafts nothing — the page offers no draft, and the database refuses one', async () => {
    const r = await upload(PNG, 'ticket.png', 'image/png');
    const other = String(r.headers['location']).split('/').pop()!;
    answer = bill({ total: '1 300,00' });
    expect(await notice(await post(`/app/books/papers/${other}/read`))).toContain('Read, with problems');
    const body = (await app.inject({ method: 'GET', url: `/app/books/papers/${other}`, headers: { cookie: owner } })).body;
    expect(body).toContain('The lines come to 1250, the total says 1300.');
    expect(body).not.toContain('/draft"');
    const reading = (await as((q) => q(`select id::text as id from document_readings where document_id = $1`, [other]))).rows[0].id as string;
    const anEntry = (await as((q) => q(`select id::text as id from journal_entries limit 1`))).rows[0].id as string;
    await expect(as((q) => q(`update document_readings set entry_id = $2, drafted_at = now(), drafted_by = 'owner' where id = $1`, [reading, anEntry])))
      .rejects.toThrow(/nothing is drafted from a reading with problems/);
    // and a reading is kept as read
    await expect(as((q) => q(`update document_readings set problems = '[]' where id = $1`, [reading]))).rejects.toThrow(/kept as it was read/);
  });

  it('A PDF is read only where the reader reads documents: here it is kept, and said not read', async () => {
    const r = await upload(PDF, 'bill.pdf', 'application/pdf');
    const pdf = String(r.headers['location']).split('/').pop()!;
    expect(await notice(await post(`/app/books/papers/${pdf}/read`))).toContain('A PDF is not read here');
    expect(reads).toEqual(['image/png', 'image/png']);
  });

  it('THE ACCOUNTANT sees and takes the papers, and keeps, reads and drafts nothing', async () => {
    expect((await app.inject({ method: 'GET', url: '/app/books/papers', headers: { cookie: accountant } })).body).toContain('facture-rif.png');
    expect((await app.inject({ method: 'GET', url: `/app/books/papers/${paper}/file`, headers: { cookie: accountant } })).statusCode).toBe(200);
    for (const tried of [await upload(PNG, 'x.png', 'image/png', accountant), await post(`/app/books/papers/${paper}/read`, {}, accountant)]) {
      expect([tried.statusCode, tried.headers['location']]).toEqual([302, '/app/books']);
    }
  });
});
