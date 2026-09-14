import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { fakeProspectSource } from '../connectors/fakeSource.js';

/**
 * C5 · M41 — prospecting over Postgres and her own routes.
 *
 * The source is the recording fake, handed to the web app exactly where the
 * composition root hands it Apollo, so what is proven here is everything but the
 * wire: that her key is stored encrypted and reaches the source intact, that the
 * owner alone can set it, that a credit is spent only where a person clicked and
 * never twice for the same company, and that someone found in a search lands on
 * her list with no consent — so the gate refuses him until one is recorded.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd490000-0000-4000-8000-${RUN}0001`;
const CODE = `prospects-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const KEY = `apollo_key_${RUN}_abcdefgh`;
const addr = (who: string, domain = 'gulftrading-test.ae') => `${who}.${RUN}@${domain}`;

d('C5 · finding buyers (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let ownerCookie = '';
  let staffCookie = '';
  const keysSeen: string[] = [];
  let failWith: NonNullable<Parameters<typeof fakeProspectSource>[0]>['failWith'];
  const source = () => fakeProspectSource({
    organizations: {
      'gulftrading-test.ae': {
        name: 'Gulf Trading LLC', domain: 'gulftrading-test.ae', industry: 'Wholesale', employees: 60,
        country: 'United Arab Emirates', city: 'Dubai', website: null, linkedinUrl: null, foundedYear: 2009,
      },
    },
    prospects: [
      { sourceId: 'p-omar', name: 'Omar Haddad', title: 'Purchasing Manager', organization: 'Souk Home',
        organizationDomain: 'soukhome-test.om', country: 'Oman', city: 'Muscat', email: addr('omar', 'soukhome-test.om') },
      { sourceId: 'p-noemail', name: 'Nadia Karim', title: 'Buyer', organization: 'Private Label Co',
        organizationDomain: null, country: 'Oman', city: null, email: null },
    ],
    ...(failWith ? { failWith } : {}),
  });
  let current = source();

  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const post = (cookie: string, url: string, fields: Record<string, string>) => app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const flashOf = (res: { headers: Record<string, unknown> }): string =>
    new URL(String(res.headers['location'] ?? ''), 'https://x.test').searchParams.get('flash') ?? '';
  const login = async (code: string) => String((await app.inject({
    method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })).headers['set-cookie'] ?? '').split(';')[0] ?? '';

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, 'Prospect Factory')
                        on conflict (id) do nothing`.execute(x));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'meta',
      secureCookie: false, messagingEnabled: true,
      kickOutbound: async () => {}, kickDrive: async () => {},
      credentialKey: deriveKey('b'.repeat(64)),
      prospectSourceFor: (apiKey: string) => { keysSeen.push(apiKey); return current; },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = await login(CODE);
    const person = await addPerson(db, BIZ, SECRET, 'Mei');
    staffCookie = await login((person as { accessCode: string }).accessCode);
    expect(ownerCookie).not.toBe('');
    expect(staffCookie).not.toBe('');
    // Two people on her list with work addresses, one with a personal one.
    for (const [who, domain] of [['ahmed', 'gulftrading-test.ae'], ['khalid', 'gulftrading-test.ae'], ['sami', 'gmail.com']] as const) {
      await post(ownerCookie, '/app/contacts', { channel: 'email', identity: addr(who, domain), name: who, company: '' });
    }
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('with no key there is nothing to search with and no lookup to offer', async () => {
    const page = await get(ownerCookie, '/app/prospects');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(esc(t('en', 'prospects.key.none')));
    expect(page.body).not.toContain('name="search"');
    expect((await get(ownerCookie, '/app/contacts')).body).not.toContain('action="/app/contacts/lookup"');
  });

  it('A SALES ASSISTANT cannot set the key — nor her daily cap, which C4.b made hers', async () => {
    for (const [url, fields] of [
      ['/app/prospects/key', { apiKey: KEY }],
      ['/app/prospects/key/remove', {}],
      ['/app/channels/outreach/cap', { channel: 'email', cap: '5' }],
    ] as const) {
      const res = await post(staffCookie, url, fields);
      expect(decodeURIComponent(String(res.headers['location'])), url).toContain('Only the owner');
    }
    expect(await tx((x) => sql<{ n: number }>`select count(*)::int as n from connector_credentials
      where business_id = ${BIZ}`.execute(x).then((r) => r.rows[0]!.n))).toBe(0);
  });

  it('a paste that is not a key is refused and nothing is stored', async () => {
    expect(flashOf(await post(ownerCookie, '/app/prospects/key', { apiKey: 'not a key!' })))
      .toBe(t('en', 'prospects.flash.invalid'));
  });

  it('HER KEY IS STORED LOCKED: the row holds ciphertext and a fingerprint, the page only the fingerprint', async () => {
    const { credentialFingerprint } = await import('../../src/security/credentials.js');
    expect(flashOf(await post(ownerCookie, '/app/prospects/key', { apiKey: `  ${KEY}  ` }))).toBe(t('en', 'prospects.flash.saved'));
    const row = await tx((x) => sql<{ secret_ciphertext: string; fingerprint: string }>`
      select secret_ciphertext, fingerprint from connector_credentials
       where business_id = ${BIZ} and archived_at is null`.execute(x).then((r) => r.rows[0]!));
    expect(row.secret_ciphertext.startsWith('v1.')).toBe(true);
    expect(row.secret_ciphertext).not.toContain(KEY);
    expect(row.fingerprint).toBe(credentialFingerprint(KEY));
    const page = await get(ownerCookie, '/app/prospects');
    expect(page.body).toContain(row.fingerprint);
    expect(page.body).not.toContain(KEY);
  });

  it('a search reaches the source with her key, decrypted, and lists people she can judge', async () => {
    const res = await get(ownerCookie, '/app/prospects?search=1&titles=Purchasing&countries=Oman');
    expect(res.statusCode).toBe(200);
    expect(keysSeen.at(-1)).toBe(KEY);
    expect(res.body).toContain('Omar Haddad');
    expect(res.body).toContain('Purchasing Manager');
    expect(current.calls.filter((c) => c.op === 'reveal' || c.op === 'enrich'), 'a search spent a credit').toEqual([]);
  });

  it('SHE ADDS SOMEONE: one credit for the address, on her list — and NOT writable, because nobody consented', async () => {
    const back = '?search=1&page=1&titles=Purchasing';
    const res = await post(ownerCookie, '/app/prospects/add', {
      sourceId: 'p-omar', name: 'Omar Haddad', title: 'Purchasing Manager', organization: 'Souk Home', back,
    });
    expect(String(res.headers['location'])).toContain('/app/prospects?search=1&page=1&titles=Purchasing&flash=');
    expect(flashOf(res)).toBe(t('en', 'prospects.flash.added'));
    expect(current.calls.filter((c) => c.op === 'reveal')).toHaveLength(1);

    const contact = await tx((x) => sql<{ source: string; title: string | null; company: string | null; created_by: string }>`
      select source, title, company, created_by from contacts
       where business_id = ${BIZ} and identity = ${addr('omar', 'soukhome-test.om')}`.execute(x).then((r) => r.rows[0]!));
    expect(contact).toMatchObject({ source: 'apollo', title: 'Purchasing Manager', company: 'Souk Home' });
    // Whoever added him, by name — here the owner, whose name is her business's.
    expect(contact.created_by).toBe('Prospect Factory');
    const consent = await tx((x) => sql<{ n: number }>`select count(*)::int as n from contact_consent
      where business_id = ${BIZ} and identity = ${addr('omar', 'soukhome-test.om')}`.execute(x).then((r) => r.rows[0]!.n));
    expect(consent, 'a search result was given consent').toBe(0);

    const list = await get(ownerCookie, '/app/contacts');
    expect(list.body).toContain(esc(t('en', 'contacts.source.apollo')));
    expect(list.body).not.toContain(`/app/contacts/write?channel=email&amp;identity=${encodeURIComponent(addr('omar', 'soukhome-test.om'))}`);

    // And the send path agrees: he cannot be put on a sequence either.
    const { enroll } = await import('../../src/outbound/sequences.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    const r = await enroll({ db, now: () => new Date(), templateState: 'none', kickDrive: async () => {} },
      { businessId: b.value, sequenceId: randomUUID(), identity: addr('omar', 'soukhome-test.om'), by: 'owner' });
    expect(r).toBe('not_approved');   // no such sequence — and below, the gate's own answer about him
    const { outreachFacts } = await import('../../src/db/outreach.js');
    const { gateOutreach } = await import('../../src/core/outreach/gate.js');
    const facts = await tx((x) => outreachFacts(x, b.value, {
      channel: 'email', identity: addr('omar', 'soukhome-test.om'), templateState: 'none', now: new Date(),
    }));
    expect(gateOutreach({ ...facts, enabled: true, satisfied: new Set(['verified_sending_domain']) }))
      .toEqual({ ok: false, error: 'no_consent' });
  });

  it('adding him again spends nothing new on her list; someone Apollo has no address for is not added', async () => {
    expect(flashOf(await post(ownerCookie, '/app/prospects/add', { sourceId: 'p-omar', name: 'Omar Haddad' })))
      .toBe(t('en', 'prospects.flash.exists'));
    expect(flashOf(await post(ownerCookie, '/app/prospects/add', { sourceId: 'p-noemail', name: 'Nadia Karim' })))
      .toBe(t('en', 'prospects.flash.not_found'));
    expect(await tx((x) => sql<{ n: number }>`select count(*)::int as n from contacts
      where business_id = ${BIZ} and display_name = 'Nadia Karim'`.execute(x).then((r) => r.rows[0]!.n))).toBe(0);
  });

  it('A COMPANY IS BOUGHT ONCE: the first lookup spends a credit, the second reads what the first found', async () => {
    const before = current.calls.filter((c) => c.op === 'enrich').length;
    const list = await get(ownerCookie, '/app/contacts');
    expect(list.body).toContain('action="/app/contacts/lookup"');
    expect(flashOf(await post(ownerCookie, '/app/contacts/lookup', { identity: addr('ahmed') })))
      .toBe(t('en', 'contacts.lookup.flash.found'));
    // Khalid works at the same company: already known, nothing spent.
    expect(flashOf(await post(ownerCookie, '/app/contacts/lookup', { identity: addr('khalid') })))
      .toBe(t('en', 'contacts.lookup.flash.reused'));
    expect(current.calls.filter((c) => c.op === 'enrich').length - before).toBe(1);

    const page = await get(ownerCookie, '/app/contacts');
    expect(page.body).toContain('Gulf Trading LLC');
    expect(page.body).toContain(esc(t('en', 'contacts.company.employees', { n: '60' })));
    const rows = await tx((x) => sql<{ n: number; by: string }>`
      select count(*)::int as n, max(looked_up_by) as by from organization_enrichments
       where business_id = ${BIZ} and domain = 'gulftrading-test.ae'`.execute(x).then((r) => r.rows[0]!));
    expect(rows).toEqual({ n: 1, by: 'Prospect Factory' });
  });

  it('a personal mailbox is never looked up — there is no company behind gmail.com to buy', async () => {
    const before = current.calls.length;
    expect(flashOf(await post(ownerCookie, '/app/contacts/lookup', { identity: addr('sami', 'gmail.com') })))
      .toBe(t('en', 'contacts.lookup.flash.personal'));
    expect(current.calls.length).toBe(before);
  });

  it('a failure at the source is named in her words and records nothing, so she can try again', async () => {
    failWith = { kind: 'failed', reason: 'no_credits', retryable: false };
    current = source();
    const res = await post(ownerCookie, '/app/prospects/add', { sourceId: 'p-omar', name: 'Omar Haddad' });
    expect(flashOf(res)).toBe(t('en', 'prospects.failure.no_credits'));
    failWith = undefined;
    current = source();
  });

  it('REPLACING the key archives the old row; REMOVING it stops every lookup, and nothing is erased', async () => {
    await post(ownerCookie, '/app/prospects/key', { apiKey: `${KEY}_second` });
    const rows = await tx((x) => sql<{ live: number; archived: number }>`
      select count(*) filter (where archived_at is null)::int as live,
             count(*) filter (where archived_at is not null)::int as archived
        from connector_credentials where business_id = ${BIZ}`.execute(x).then((r) => r.rows[0]!));
    expect(rows).toEqual({ live: 1, archived: 1 });

    expect(flashOf(await post(ownerCookie, '/app/prospects/key/remove', {}))).toBe(t('en', 'prospects.flash.removed'));
    expect((await get(ownerCookie, '/app/prospects')).body).not.toContain('name="search"');
    expect(flashOf(await post(ownerCookie, '/app/prospects/add', { sourceId: 'p-omar', name: 'Omar Haddad' })))
      .toBe(t('en', 'prospects.noSource.no_key'));
    expect(await tx((x) => sql<{ n: number }>`select count(*)::int as n from connector_credentials
      where business_id = ${BIZ}`.execute(x).then((r) => r.rows[0]!.n))).toBe(2);
  });

  it('A KEY WRITTEN UNDER ANOTHER CREDENTIAL_KEY is reported unreadable, never guessed at', async () => {
    const { encryptSecret, deriveKey, credentialFingerprint } = await import('../../src/security/credentials.js');
    await tx((x) => sql`insert into connector_credentials (business_id, connector, secret_ciphertext, fingerprint, created_by)
      values (${BIZ}, 'apollo', ${encryptSecret(KEY, deriveKey('c'.repeat(64)))}, ${credentialFingerprint(KEY)}, 'owner')`.execute(x));
    const page = await get(ownerCookie, '/app/prospects');
    expect(page.body).toContain(esc(t('en', 'prospects.noSource.unreadable_key')));
    expect(page.body).not.toContain('name="search"');
    expect(flashOf(await post(ownerCookie, '/app/contacts/lookup', { identity: addr('ahmed', 'another-co-test.ae') })))
      .toBe(t('en', 'prospects.noSource.unreadable_key'));
  });
});
