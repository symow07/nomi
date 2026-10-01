import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';
import type { PageFactsReader } from '../../src/llm/ports.js';
import { StoreFetchError, type StoreFetcher } from '../../src/net/publicFetch.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * EXT — a page of her site, through the real routes, the model and the web
 * faked: the proposal is kept and shows each line with its sentence; nothing
 * is written until she ticks, and then only what she ticked, once, on the
 * audit trail; a page that cannot be read says why; never past the allowance;
 * not offered where no reader exists; another business's proposal is not hers.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `e7710000-0000-4000-8000-${RUN}0001`;
const OTHER = `e7710000-0000-4000-8000-${RUN}0002`;
const CODE = `extp-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const PAGE = `<html><body><h1>Shipping</h1><p>We ship within 2 business days.</p>
  <p>Returns are accepted within 30 days of delivery.</p><p>We do not ship to PO boxes.</p></body></html>`;

d('EXT · a page of her site, learned line by line (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let bare: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let cookie = '';
  let bareCookie = '';
  const fetched: string[] = [];
  const asked: string[] = [];
  const fetcher: StoreFetcher = {
    get: async (url) => {
      fetched.push(url);
      if (url.includes('internal')) throw new StoreFetchError('not_public');
      if (url.includes('huge')) throw new StoreFetchError('too_large');
      if (url.includes('image')) return { status: 200, contentType: 'image/png', body: 'x' };
      return { status: 200, contentType: 'text/html; charset=utf-8', body: PAGE };
    },
  };
  const reader: PageFactsReader = {
    read: async ({ text }) => {
      asked.push(text);
      return {
        facts: [
          { fact: 'Orders ship within 2 business days.', quote: 'We ship within 2 business days.' },
          { fact: 'Returns are accepted for 30 days after delivery.', quote: 'Returns are accepted within 30 days of delivery.' },
          // A sentence the page does not hold: never proposed.
          { fact: 'Shipping is free worldwide.', quote: 'Free worldwide shipping on every order.' },
        ],
        promptVersion: 'test', modelId: 'test', usage: { inputTokens: 7, outputTokens: 3 },
      };
    },
  };
  const post = (a: typeof app, c: string, url: string, body: Record<string, string>) =>
    a.inject({ method: 'POST', url, headers: { cookie: c, ...FORM }, payload: new URLSearchParams(body).toString() });
  const get = (a: typeof app, c: string, url: string) => a.inject({ method: 'GET', url, headers: { cookie: c } });
  const knowledge = async () => (await admin.query(
    `select label, content, source, product_id from product_knowledge where business_id = $1 and status = 'active' order by content`, [BIZ])).rows as { label: string; content: string; source: string; product_id: string | null }[];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name, kind, country) values ($1, $2, 'online_shop', 'US'), ($3, $4, 'online_shop', 'US')`,
      [BIZ, `EXT Page ${RUN}`, OTHER, `EXT Other ${RUN}`]);
    const base = {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', factsTtlMs: 0,
      secureCookie: false, messagingEnabled: false, storeFetcher: fetcher, kickOutbound: async () => {}, kickDrive: async () => {}, enqueueInbound: async () => {},
    };
    app = Fastify({ logger: false });
    registerWebApp(app, { ...base, pageFactsReader: reader } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    bare = Fastify({ logger: false });
    registerWebApp(bare, base as unknown as Parameters<typeof registerWebApp>[1]);
    await bare.ready();
    const login = async (a: typeof app) => String((await a.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    cookie = await login(app); bareCookie = await login(bare);
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await bare?.close(); await db?.destroy(); await admin?.end(); });

  it('PROPOSED, NOTHING WRITTEN; then only the ticked lines, once, on the audit trail', async () => {
    expect((await get(app, cookie, '/app/knowledge')).body).toContain('id="from-page"');
    const r = await post(app, cookie, '/app/knowledge/from-page', { address: 'myshop.com/pages/shipping', text: '' });
    expect(r.statusCode).toBe(303);
    expect(fetched.at(-1)).toBe('https://myshop.com/pages/shipping');
    expect(asked.at(-1)).toContain('We ship within 2 business days.');
    const at = String(r.headers['location']);
    const page = (await get(app, cookie, at)).body;
    expect(page).toContain('Orders ship within 2 business days.');
    expect(page).toContain('Returns are accepted for 30 days after delivery.');
    expect(page).not.toContain('Shipping is free worldwide.');
    expect(page).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(await knowledge()).toEqual([]);
    const spent = (await admin.query(`select llm_calls from usage_ledger where business_id = $1`, [BIZ])).rows[0];
    expect(spent.llm_calls).toBe(1);

    // None ticked: nothing written, the proposal still open.
    const none = await post(app, cookie, `${at}/confirm`, {});
    expect(flashSaid(none, SECRET)).toBe(t('en', 'pageFacts.flash.noneTicked'));
    expect(await knowledge()).toEqual([]);

    // One ticked (and a key the proposal never had): only that line.
    const ok = await post(app, cookie, `${at}/confirm`, { 'line:f2': 'on', 'line:f9': 'on' });
    expect(ok.headers['location']).toBe('/app/knowledge');
    expect(flashSaid(ok, SECRET)).toBe(t('en', 'pageFacts.flash.written', { n: 1 }));
    expect(await knowledge()).toEqual([{ label: t('en', 'pageFacts.label', { source: 'myshop.com' }), content: 'Returns are accepted for 30 days after delivery.', source: 'owner_confirmed', product_id: null }]);
    const audit = (await admin.query(`select detail from channel_audit where business_id = $1 and action = 'knowledge_imported'`, [BIZ])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toMatchObject({ written: 1, of: 2 });

    // Decided: closed — a second confirm writes nothing.
    await post(app, cookie, `${at}/confirm`, { 'line:f1': 'on' });
    expect(await knowledge()).toHaveLength(1);
    expect((await get(app, cookie, at)).body).not.toContain('name="line:f1"');
  });

  it('PASTED TEXT is read as it is, without fetching anything', async () => {
    const before = fetched.length;
    const r = await post(app, cookie, '/app/knowledge/from-page', { address: '', text: 'We ship within 2 business days.\nReturns are accepted within 30 days of delivery.' });
    expect(r.statusCode).toBe(303);
    expect(fetched.length).toBe(before);
    expect((await get(app, cookie, String(r.headers['location']))).body).toContain(t('en', 'pageFacts.pasted'));
  });

  it('A PAGE THAT CANNOT BE READ SAYS WHY, and asks nothing of the model', async () => {
    const before = asked.length;
    const why = async (address: string) => (await post(app, cookie, '/app/knowledge/from-page', { address, text: '' })).body;
    expect(await why('not an address')).toContain(t('en', 'pageFacts.refused.not_an_address'));
    expect(await why('internal.example.com')).toContain(t('en', 'pageFacts.refused.not_public'));
    expect(await why('huge.example.com')).toContain(t('en', 'pageFacts.refused.too_large'));
    expect(await why('image.example.com/a.png')).toContain(t('en', 'pageFacts.refused.not_a_page'));
    expect(asked.length).toBe(before);
  });

  it('NEVER PAST THE ALLOWANCE; NOT OFFERED where no reader exists; ANOTHER BUSINESS\'S PROPOSAL is not hers', async () => {
    await admin.query(`insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded) values ($1, 1, 1000, 80, 'pause')
                       on conflict (business_id) do update set daily_llm_calls = 1, on_exceeded = 'pause'`, [BIZ]);
    const before = asked.length;
    expect((await post(app, cookie, '/app/knowledge/from-page', { address: 'myshop.com/pages/shipping', text: '' })).body)
      .toContain(t('en', 'pageFacts.refused.allowance_used'));
    expect(asked.length).toBe(before);
    await admin.query(`delete from tenant_budgets where business_id = $1`, [BIZ]);

    expect((await get(bare, bareCookie, '/app/knowledge')).body).not.toContain('id="from-page"');
    expect((await post(bare, bareCookie, '/app/knowledge/from-page', { address: 'myshop.com', text: '' })).body)
      .toContain(t('en', 'pageFacts.refused.not_configured'));

    const theirs = (await admin.query(`insert into knowledge_proposals (business_id, source, lines, created_by) values ($1, 'pasted', $2::jsonb, 'x') returning id::text as id`,
      [OTHER, JSON.stringify([{ key: 'f1', fact: 'Their own fact.', quote: 'Their own fact.' }])])).rows[0].id as string;
    expect((await get(app, cookie, `/app/knowledge/from-page/${theirs}`)).statusCode).toBe(404);
    await post(app, cookie, `/app/knowledge/from-page/${theirs}/confirm`, { 'line:f1': 'on' });
    expect((await admin.query(`select count(*)::int as n from product_knowledge where business_id = $1`, [OTHER])).rows[0].n).toBe(0);
    expect((await admin.query(`select decided_at from knowledge_proposals where id = $1`, [theirs])).rows[0].decided_at).toBeNull();
  });
});
