import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { demoSeedSql } from '../../src/demo/factory.js';
import { ensureQueueSchema } from './tenant.js';
import { purgeBusinesses } from './books-db.js';

/**
 * The authorization audit (Block 7) — STAFF AND THE ACCOUNTANT, EVERY ROUTE, THE WORKSPACE'S OWN IDS.
 *
 * people.test.ts and phase4-permissions.test.ts walk lists of owner-only routes by hand. This walks every route the web
 * app registers, three times over one workspace, with every id of its own (one or two rows of each table) in the path,
 * the form and the query, and plain values in the fields an owner-only form asks for (a price, a floor, a rate, a
 * name, a phone, a domain …). After each route it reads every row of the workspace (the presence stamp
 * `people.last_seen_at` aside) and records which tables the route changed:
 *
 *   1. as a member of the team: only the sales job's routes may change anything (`STAFF_JOB`);
 *   2. as the accountant: only the books' copy out (`books_exports`);
 *   3. as the owner, last: the control — the same walk reaches the owner's own writes (`OWNER_REACHED`), so 1 and 2
 *      are refusals, not a walk that never got as far as a write.
 *
 * What it cannot see: an owner-only route whose form needs a value it does not send (billing without a payment
 * provider, a capability by name, the export of a customer's data): those stay with the hand-made lists named in the
 * audit's ROLES list.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, '').slice(0, 7);
const NS = `e${RUN}`;
const A = `${NS}-0000-4000-8000-0000000000b1`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const OWNER_CODE = `authz-staff-${RUN}`;
const code = (tag: string) => `${tag}${RUN.slice(0, 2).toUpperCase()}-${RUN.slice(2, 7).toUpperCase().replace(/[^A-Z2-9]/g, 'Q')}`;

const ID_FIELDS = ['account', 'account_id', 'assistant', 'category', 'clientId', 'conversationId', 'draftId', 'entry', 'entryId',
  'id', 'ids', 'import', 'importId', 'invoice', 'invoiceId', 'item', 'itemId', 'journal', 'journalLine', 'label', 'labelId', 'line',
  'match', 'messageId', 'orderId', 'party', 'partyId', 'payFrom', 'pay_from', 'person', 'personId', 'photo', 'product', 'productId',
  'proposal', 'proposalId', 'quoteId', 'recurring', 'request', 'requestId', 'run', 'runId', 'sequence', 'source', 'sourceId',
  'subscription', 'supplier', 'supplierId', 'tax', 'taxCode', 'tax_code', 'thread', 'to', 'year', 'category_id', 'party_id',
  'tax_code_id', 'procedure', 'case', 'check'];
const WORDS = {
  confirm: 'yes', note: 'authz', text: 'authz', content: 'authz', reply: 'authz', title: 'authz', kind: 'faq', body: 'authz', amount: '1',
  date: '2026-04-20', name: 'Authz Walk', price: '3', floor: '0.5', maxDiscountPct: '10', askAbovePct: '5', rate: '7', level: 'sells',
  phone: '+971500009999', label: 'x', domain: 'example.com', selector: 's1', which: 'owner_ready', channel: 'whatsapp', enabled: 'true',
  locale: 'en', tone: 'plain', length: 'short', emoji: 'never',
};

/** The sales job (people.ts, OWNER_ONLY's comment): reply, take over, hand back, label, name a customer, record an opt-out, the profile. */
const STAFF_JOB = new Set([
  'GET /app/inbox/:conversationId', 'POST /app/inbox/:conversationId/takeover', 'POST /app/inbox/:conversationId/reply',
  'POST /app/inbox/:conversationId/resume', 'POST /app/buyers/:clientId/labels', 'POST /app/conversations/:conversationId/opt-out/record',
  'POST /app/conversations/:conversationId/name', 'POST /app/settings',
  // Outreach: staff draft a sequence; approving it (the exact words) is the owner's, and an approved one cannot be edited.
  'POST /app/sequences', 'POST /app/sequences/:id/steps', 'POST /app/sequences/:id/steps/:position',
]);
/** What the owner's walk must change, or the refusals above prove nothing: one route of each owner-only family it can reach. */
const OWNER_REACHED = [
  'POST /app/settings/people', 'POST /app/settings/people/:id/remove', 'POST /app/settings/assistant/autonomy', 'POST /app/products/:id/edit',
  'POST /app/settings/rate', 'POST /app/settings/samples', 'POST /app/business/deactivate', 'POST /app/business/allowlist/add',
  'POST /app/channels/domain', 'POST /app/onboarding/assistant-name', 'POST /app/books/chart/cgnc', 'POST /app/settings/books/invoices-out',
  'GET /app/conversations/:conversationId/copy.csv', 'POST /app/settings/identifiers',
];

/**
 * Every route whose handler opens with `ownerOnly(…)` (src/api, read 2026-11-11; by OWNER_ONLY action). The gate runs
 * before the form is read, so staff get the owner's notice whatever they send. A route added with the gate is not
 * listed here by itself: add it.
 */
const OWNER_ONLY_ROUTES = [
  // data_rights, through contactImportScope's own gate (contactImportRoutes.ts)
  'GET /app/customers/import', 'POST /app/customers/import', 'GET /app/customers/import/:id/columns', 'POST /app/customers/import/:id/columns',
  'GET /app/customers/import/:id', 'POST /app/customers/import/:id/select', 'POST /app/customers/import/:id/confirm', 'POST /app/customers/import/:id/discard',
  // price_rules, through the catalogue's gate (waCatalogueRoutes.ts)
  'POST /app/products/:productId/whatsapp', 'POST /app/products/whatsapp/preview', 'POST /app/products/whatsapp/review/:batchId',
  'POST /app/products/whatsapp/batches/:batchId/check',
  // messaging_activation, through the comments' gate (instagramCommentRoutes.ts)
  'GET /app/channels/instagram/comments/:id/delete', 'POST /app/channels/instagram/comments/:id/delete', 'POST /app/channels/instagram/comments/:id/reply',
  'POST /app/channels/instagram/comments/switch', 'GET /app/channels/instagram/comments/callback',
  // the books' money (booksMay 'post'), through the payments' gate (paymentRoutes.ts)
  'GET /app/payments/stripe', 'POST /app/payments/stripe/connect', 'GET /app/payments/stripe/return', 'POST /app/payments/stripe/accounts',
  'POST /app/payments/stripe/invoices/:id/create', 'POST /app/payments/stripe/invoices/:id/send', 'POST /app/payments/stripe/attempts/:id/expire',
  'POST /app/payments/stripe/disconnect', 'POST /app/payments/stripe/retry', 'POST /app/payments/stripe/payouts/:id/confirm',
  'POST /app/payments/stripe/payouts/:id/receive',
  // answers_given
  'POST /app/knowledge/answers/dismiss',
  'POST /app/knowledge/answers/teach',
  // billing
  'POST /app/settings/billing/card',
  'POST /app/settings/billing/portal',
  // business_identifiers
  'POST /app/books/fec/filename',
  'POST /app/settings/identifiers',
  // capability_grant
  'POST /app/assistant/knowledge/checks/:id/keep',
  'POST /app/assistant/knowledge/checks/:id/revert',
  'POST /app/assistant/knowledge/procedures/:id/archive',
  'POST /app/inbox/:conversationId/follow-ups/:runId/skip',
  'POST /app/inbox/:conversationId/testing',
  'POST /app/settings/assistant/autonomy',
  'POST /app/settings/assistant/capability/:capability/promote',
  'POST /app/settings/assistant/capability/:capability/revoke',
  'POST /app/settings/assistant/follow-ups',
  // capability_grant,messaging_activation
  'POST /app/settings/business/shopify/disconnect',
  // data_rights
  'GET /app/conversations/:conversationId/copy.csv',
  'GET /app/settings/data/:file',
  'GET /app/settings/data/books.csv',
  'GET /app/settings/data/papers.zip',
  'POST /app/conversations/:conversationId/deletion',
  'POST /app/conversations/:conversationId/deletion/dismiss',
  'POST /app/conversations/:conversationId/deletion/erase',
  'POST /app/settings/data/close',
  'POST /app/settings/data/delete',
  'POST /app/settings/data/withdraw',
  // messaging_activation
  'GET /app/connect/meta-ads/callback',
  'GET /app/connect/meta-ads/start',
  'GET /app/connect/meta/callback',
  'GET /app/connect/meta/start',
  'GET /app/connect/tiktok/callback',
  'GET /app/connect/tiktok/start',
  'GET /app/connect/whatsapp/callback',
  'GET /app/connect/whatsapp/start',
  'POST /app/business/activate',
  'POST /app/business/allowlist/add',
  'POST /app/business/allowlist/remove',
  'POST /app/business/deactivate',
  'POST /app/business/start-assistant',
  'POST /app/business/stop-assistant',
  'POST /app/channels/approval',
  'POST /app/channels/chat',
  'POST /app/channels/instagram/connect',
  'POST /app/channels/messenger/connect',
  'POST /app/channels/telegram',
  'POST /app/channels/whatsapp/ask',
  'POST /app/channels/whatsapp/connect',
  'POST /app/channels/whatsapp/templates/check',
  'POST /app/channels/whatsapp/templates/submit',
  'POST /app/connect/meta-ads/choose',
  'POST /app/connect/meta-ads/disconnect',
  'POST /app/connect/meta/choose',
  'POST /app/connect/meta/disconnect',
  'POST /app/connect/tiktok/disconnect',
  'POST /app/connect/whatsapp/choose',
  'POST /app/connect/whatsapp/disconnect',
  'POST /app/conversations/:conversationId/opt-out/lift',
  'POST /app/onboarding/assistant-name',
  'POST /app/onboarding/attest',
  'POST /app/onboarding/validate',
  'POST /app/settings/business/shopify/connect',
  'POST /app/settings/business/shopify/switch',
  'POST /app/settings/owner-phone',
  'POST /app/surveys',
  // outreach
  'GET /app/connect/:provider/callback',
  'GET /app/connect/:provider/start',
  'POST /app/channels/domain',
  'POST /app/channels/domain/check',
  'POST /app/channels/outreach',
  'POST /app/channels/outreach/cap',
  'POST /app/connect/mail/disconnect',
  'POST /app/prospects/key',
  'POST /app/prospects/key/remove',
  'POST /app/sequences/:id/approve',
  'POST /app/sequences/:id/archive',
  // people
  'POST /app/inbox/:conversationId/assistant',
  'POST /app/settings/people',
  'POST /app/settings/people/:id/name',
  'POST /app/settings/people/:id/remove',
  'POST /app/settings/people/:id/turn',
  'POST /app/settings/people/assistants',
  'POST /app/settings/people/assistants/:id',
  'POST /app/settings/people/assistants/:id/archive',
  'POST /app/settings/people/turn',
  // price_rules
  'GET /app/products/import/:importId/photo/:n',
  'GET /app/settings/business/selling/:q',
  'GET /app/settings/business/selling/:q/confirm',
  'POST /app/business/prices',
  'POST /app/business/prices/volume',
  'POST /app/business/prices/volume/:id/archive',
  'POST /app/business/selling/:q',
  'POST /app/business/selling/:q/confirm',
  'POST /app/business/selling/:q/skip',
  'POST /app/inbox/:conversationId/product-card',
  'POST /app/products/:id/edit',
  'POST /app/products/:id/names/remove',
  'POST /app/products/:id/photo',
  'POST /app/products/:id/photo/remove',
  'POST /app/products/:id/tiers/remove',
  'POST /app/products/add/confirm',
  'POST /app/products/add/file',
  'POST /app/products/add/photo',
  'POST /app/products/add/review',
  'POST /app/products/add/shopify',
  'POST /app/products/add/store',
  'POST /app/products/import/:importId/columns',
  'POST /app/products/import/:importId/confirm',
  'POST /app/products/import/:importId/drop',
  'POST /app/products/import/:importId/extract',
  'POST /app/products/import/:importId/reread',
  'POST /app/products/import/:importId/save',
  'POST /app/products/prices-to-me',
  'POST /app/settings/rate',
  'POST /app/settings/samples',
  'POST /app/settings/terms',
];

d('Authorization audit · staff and the accountant on every route (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 1_200_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let app: import('fastify').FastifyInstance;
  const routes: { method: string; url: string }[] = [];
  const cookies: Record<'owner' | 'team' | 'accountant', string> = { owner: '', team: '', accountant: '' };
  let hashSql = '';
  let ids: string[] = [];

  const sess = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const login = async (c: string) => sess(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(c)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
  const hash = async () => new Map((await admin.query(hashSql, [A])).rows.map((r) => [r.t as string, r.h as string]));

  /** Every route, every id: the tables each route changed, in order. */
  const walk = async (who: keyof typeof cookies) => {
    const cookie = cookies[who];
    const skip = /^\/(logout|login|signup|verify|hooks|webhooks|u$|p\/|pi\/|inv\/|media\/|chat\/|catalogue-media\/|assets|favicon|sw\.js|manifest)/;
    const form = (id: string) => { const p = new URLSearchParams(WORDS); for (const f of ID_FIELDS) p.set(f, id); return p.toString(); };
    const changed = new Map<string, string[]>();
    let prev = await hash();
    for (const r of routes.filter((x) => !skip.test(x.url) && !x.url.includes('*') && x.method !== 'HEAD' && x.method !== 'OPTIONS')) {
      for (const id of r.url.includes(':') ? ids : [ids[0]!]) {
        const url = r.url.replace(/:(\w+)/g, () => id);
        await (r.method === 'GET'
          ? app.inject({ method: 'GET', url: `${url}?${form(id)}`, headers: { cookie } })
          : app.inject({ method: r.method as 'POST', url, payload: form(id), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } }));
      }
      const now = await hash();
      const t = [...now].filter(([k, h]) => prev.get(k) !== h).map(([k]) => k);
      if (t.length) changed.set(`${r.method} ${r.url}`, t);
      prev = now;
    }
    expect((await app.inject({ method: 'GET', url: '/app/settings/personal/account', headers: { cookie } })).statusCode, `${who} still signed in`).toBe(200);
    return changed;
  };
  const show = (m: Map<string, string[]>) => [...m].map(([r, t]) => `${r}: ${t.join(', ')}`).join('\n');
  let team = new Map<string, string[]>();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await ensureQueueSchema();
    await admin.query(demoSeedSql(NS));
    // The outreach area on (rule 8), so its owner-only routes are there to refuse.
    await admin.query(`update businesses set books_area = true, country = 'MA', outreach_area = true where id = $1`, [A]);
    const { hashCode } = await import('../../src/api/web/people.js');
    for (const [kind, tag] of [['team', 'TM'], ['accountant', 'AC']] as const) {
      await admin.query(`insert into people (business_id, name, is_owner, kind, code_hash) values ($1, $2, false, $3, $4)`, [A, `Walk ${kind}`, kind, hashCode(SECRET, code(tag))]);
    }
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    app.addHook('onRoute', (r) => { for (const m of ([] as string[]).concat(r.method as string | string[])) routes.push({ method: m, url: r.url }); });
    registerWebApp(app, {
      db, businessId: A, accessCode: OWNER_CODE, sessionSecret: SECRET, factsTtlMs: 0,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookies.owner = await login(OWNER_CODE);
    cookies.team = await login(code('TM'));
    cookies.accountant = await login(code('AC'));
    for (const c of Object.values(cookies)) expect(c).not.toBe('');
    const tables = (await admin.query(`select c.relname as t from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1`)).rows.map((r) => r.t as string);
    const of = (name: string, from: string) => `select '${name}' as t, md5(coalesce(string_agg((to_jsonb(x) - 'last_seen_at')::text, '|' order by (to_jsonb(x) - 'last_seen_at')::text), '')) as h from ${from}`;
    hashSql = [...tables.map((t) => of(t, `${t} x where business_id = $1`)),
      of('price_tiers', `price_tiers x where product_id in (select id from products where business_id = $1)`),
      of('product_aliases', `product_aliases x where product_id in (select id from products where business_id = $1)`),
      of('messages', `messages x where conversation_id in (select id from conversations where business_id = $1)`)].join(' union all ');
    const idTables = (await admin.query(`select c.relname as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped)
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped) order by 1`)).rows.map((r) => r.t as string);
    for (const t of idTables) for (const r of (await admin.query(`select id::text as id from ${t} where business_id = $1 order by id limit 2`, [A])).rows) ids.push(r.id as string);
    ids = [...new Set(ids)];
  }, 120_000);
  afterAll(async () => {
    await app?.close(); await db?.destroy();
    await purgeBusinesses(admin, [A], 'authz-staff-walk-test').catch(async () => { await admin.query('rollback'); });
    await admin?.end();
  });

  it('a member of the team: only the sales job changes anything', async () => {
    team = await walk('team');
    const past = new Map([...team].filter(([r]) => !STAFF_JOB.has(r)));
    expect(past.size, `staff changed rows through:\n${show(past)}`).toBe(0);
  });

  it('the accountant: only the books\' copy out', async () => {
    const acct = await walk('accountant');
    const past = new Map([...acct].filter(([, t]) => t.some((x) => x !== 'books_exports')));
    expect(past.size, `the accountant changed rows through:\n${show(past)}`).toBe(0);
  });

  it('every owner-only route answers a member of the team with the owner\'s notice, before it reads anything', async () => {
    const { flashSaid } = await import('./tenant.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const notice = t('en', 'staff.notAllowed');
    const registered = new Set(routes.map((r) => `${r.method} ${r.url}`));
    const missing = OWNER_ONLY_ROUTES.filter((r) => !registered.has(r));
    expect(missing, `listed but not registered:\n${missing.join('\n')}`).toEqual([]);
    const answered: string[] = [];
    for (const r of OWNER_ONLY_ROUTES) {
      const [method, path] = r.split(' ') as [string, string];
      const url = path.replace(/:(\w+)/g, () => ids[0]!);
      const res = await app.inject({ method: method as 'POST', url, ...(method === 'POST' ? { payload: 'confirm=yes', headers: { cookie: cookies.team, 'content-type': 'application/x-www-form-urlencoded' } } : { headers: { cookie: cookies.team } }) });
      const said = flashSaid(res, SECRET);
      if (res.statusCode !== 302 || said !== notice) answered.push(`${r}: ${res.statusCode} ${String(res.headers['location'] ?? '')} ${said}`);
    }
    expect(answered, `owner-only routes that did not refuse staff with the owner's notice:\n${answered.join('\n')}`).toEqual([]);
  });

  it('the owner, the control: the same walk reaches the owner\'s own writes, which staff did not make', async () => {
    const owner = await walk('owner');
    const missing = OWNER_REACHED.filter((r) => !owner.has(r));
    expect(missing, `the owner's walk did not reach:\n${missing.join('\n')}`).toEqual([]);
    for (const r of OWNER_REACHED) expect(team.has(r), r).toBe(false);
  });
});
