import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { flashSaid } from './tenant.js';
import type { PageFactsReader } from '../../src/llm/ports.js';
import { StoreFetchError, type StoreFetcher } from '../../src/net/publicFetch.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * 0220 — READ THE PAGE AGAIN, through the real routes; the web and the model faked, the site changed between readings.
 *   · the confirm step spends nothing and says, before its button, what a reading uses and that finding nothing uses it;
 *   · a reading still waiting is REPLACED by the new one; an approved reading's knowledge stays live until the new
 *     reading is approved, and only then is archived;
 *   · two clicks pay once; a failure leaves the old reading as it was; pasted text has no "again".
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `e7720000-0000-4000-8000-${RUN}0001`;
const CODE = `rr-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const html = (...sentences: string[]) => `<html><body><h1>Policies</h1>${sentences.map((x) => `<p>${x}</p>`).join('')}</body></html>`;

d('0220 · read the page again (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let cookie = '';
  // The site: what each address says right now.
  const site: Record<string, string> = {};
  const down = new Set<string>();
  const fetched: string[] = [];
  const asked: string[] = [];
  let findNothing = false;
  let slow = 0;
  const fetcher: StoreFetcher = {
    get: async (url) => {
      fetched.push(url);
      if (down.has(url)) throw new StoreFetchError('unreachable');
      return { status: 200, contentType: 'text/html; charset=utf-8', body: site[url] ?? html('Nothing here yet.') };
    },
  };
  // Every sentence on the page is a fact, quoted from itself.
  const reader: PageFactsReader = {
    read: async ({ text }) => {
      asked.push(text);
      if (slow) await new Promise((r) => setTimeout(r, slow));
      const facts = findNothing ? [] : text.split('\n').filter((l) => l.endsWith('.')).map((q) => ({ fact: q, quote: q }));
      return { facts, promptVersion: 'test', modelId: 'test', usage: { inputTokens: 7, outputTokens: 3 } };
    },
  };
  const post = (url: string, body: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { cookie, ...FORM }, payload: new URLSearchParams(body).toString() });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const calls = async () => Number((await admin.query(`select coalesce(sum(llm_calls), 0)::int as n from usage_ledger where business_id = $1`, [BIZ])).rows[0].n);
  const row = async (id: string) => (await admin.query(
    `select replaced_by::text as replaced_by, reread_of::text as reread_of, reread_started_at, decided_at from knowledge_proposals where id = $1`, [id])).rows[0] as
    { replaced_by: string | null; reread_of: string | null; reread_started_at: Date | null; decided_at: Date | null };
  const knowledge = async () => (await admin.query(
    `select content, status, from_proposal::text as from_proposal from product_knowledge where business_id = $1 order by content`, [BIZ])).rows as
    { content: string; status: string; from_proposal: string | null }[];
  const active = async () => (await knowledge()).filter((k) => k.status === 'active').map((k) => k.content);
  const tickAll = async (at: string) => {
    const keys = ((await get(at)).body.match(/name="(line:[^"]+)"/g) ?? []).map((m) => m.slice(6, -1));
    return post(`${at}/confirm`, Object.fromEntries(keys.map((k) => [k, 'on'])));
  };
  const idOf = (at: string) => at.split('/').pop()!;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name, kind, country) values ($1, $2, 'online_shop', 'US')`, [BIZ, `Reread ${RUN}`]);
    // A day's allowance: 1,000 calls and 1,000,000 tokens — one reading is at most 7% of it.
    await admin.query(`insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded) values ($1, 1000, 1000000, 80, 'pause')`, [BIZ]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', factsTtlMs: 0,
      secureCookie: false, messagingEnabled: false, storeFetcher: fetcher, pageFactsReader: reader,
      kickOutbound: async () => {}, kickDrive: async () => {}, enqueueInbound: async () => {},
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('A READING STILL WAITING: the confirm step spends nothing; reading again makes one paid reading that replaces it', async () => {
    const url = 'https://waiting.example/pages/shipping';
    site[url] = html('We ship within 2 business days.');
    const first = await post('/app/knowledge/from-page', { address: 'waiting.example/pages/shipping', text: '' });
    const w1 = String(first.headers['location']);
    expect([fetched.length, asked.length, await calls()]).toEqual([1, 1, 1]);

    // The site changes. The same address sent again is still the old reading (B19), now with a way to read it again.
    site[url] = html('We ship within 1 business day.', 'Express delivery is available.');
    expect((await post('/app/knowledge/from-page', { address: url, text: '' })).headers['location']).toBe(w1);
    const old = (await get(w1)).body;
    expect(old).toContain('We ship within 2 business days.');
    expect(old).toContain(`href="${w1}/again"`);

    // The confirm step: what happens, what it uses, that nothing found still uses it — all before the button. Nothing spent.
    const confirm = (await get(`${w1}/again`)).body;
    const button = confirm.indexOf(t('en', 'pageFacts.reread.button'));
    for (const said of [t('en', 'pageFacts.reread.replacesWaiting'), t('en', 'pageFacts.reread.charge', { at: 7, used: 0 }), t('en', 'pageFacts.reread.nothingCounts')]) {
      expect(confirm, said).toContain(said);
      expect(confirm.indexOf(said), said).toBeLessThan(button);
    }
    expect([fetched.length, asked.length, await calls()]).toEqual([1, 1, 1]);

    // Read it again: one fetch, one reading, one call on the ledger; the new lines; the old one replaced.
    const again = await post(`${w1}/again`);
    expect(flashSaid(again, SECRET)).toBe(t('en', 'pageFacts.flash.reread'));
    const w2 = String(again.headers['location']);
    expect(w2).not.toBe(w1);
    expect([fetched.length, asked.length, await calls()]).toEqual([2, 2, 2]);
    const fresh = (await get(w2)).body;
    expect(fresh).toContain('We ship within 1 business day.');
    expect(fresh).not.toContain('We ship within 2 business days.');
    expect((await row(idOf(w1))).replaced_by).toBe(idOf(w2));
    expect((await row(idOf(w1))).reread_started_at).toBeNull();
    expect((await row(idOf(w2))).reread_of).toBeNull();
    // The old reading says what replaced it and cannot be approved; the knowledge page lists only the new one.
    expect((await get(w1)).body).toContain(t('en', 'pageFacts.replaced'));
    expect((await get(w1)).body).toContain(`href="${w2}"`);
    await post(`${w1}/confirm`, { 'line:f1': 'on' });
    expect(await knowledge()).toEqual([]);
    const list = (await get('/app/knowledge')).body;
    expect(list).toContain(`href="${w2}"`);
    expect(list).not.toContain(`href="${w1}"`);
    // Read again on the replaced one: nothing to read — back to it, nothing spent.
    await post(`${w1}/again`);
    expect([fetched.length, asked.length]).toEqual([2, 2]);
    // The address sent again now opens the NEW reading.
    expect((await post('/app/knowledge/from-page', { address: url, text: '' })).headers['location']).toBe(w2);
  });

  it('AN APPROVED READING: its knowledge stays live and untouched until the new reading is approved', async () => {
    const url = 'https://approved.example/pages/returns';
    site[url] = html('Returns are accepted within 30 days.', 'Refunds go back to the original card.');
    const p1 = String((await post('/app/knowledge/from-page', { address: url, text: '' })).headers['location']);
    await tickAll(p1);
    const fromP1 = await active();
    expect(fromP1).toEqual(['Refunds go back to the original card.', 'Returns are accepted within 30 days.']);
    expect((await knowledge()).every((k) => k.from_proposal === idOf(p1))).toBe(true);
    // A line she wrote herself, about the same thing: never the reading's to replace.
    await admin.query(`insert into product_knowledge (business_id, product_id, kind, label, content, source) values ($1, null, 'faq', 'Mine', 'Gift wrap is free.', 'owner_confirmed')`, [BIZ]);

    // The site changes. The address sent again opens the approved reading — no second charge — which offers "again".
    site[url] = html('Returns are accepted within 14 days.', 'Refunds go back to the original card.');
    const before = [fetched.length, asked.length, await calls()];
    const sent = await post('/app/knowledge/from-page', { address: url, text: '' });
    expect(sent.headers['location']).toBe(p1);
    expect(flashSaid(sent, SECRET)).toBe(t('en', 'pageFacts.flash.readBefore'));
    expect([fetched.length, asked.length, await calls()]).toEqual(before);
    expect((await get(p1)).body).toContain(`href="${p1}/again"`);
    const confirm = (await get(`${p1}/again`)).body;
    expect(confirm).toContain(t('en', 'pageFacts.reread.keepsApproved'));
    expect(confirm.indexOf(t('en', 'pageFacts.reread.nothingCounts'))).toBeLessThan(confirm.indexOf(t('en', 'pageFacts.reread.button')));

    // Read it again: the new reading WAITS; the old knowledge is exactly as it was.
    const p2 = String((await post(`${p1}/again`)).headers['location']);
    expect([fetched.length, asked.length, await calls()]).toEqual([before[0]! + 1, before[1]! + 1, before[2]! + 1]);
    expect((await row(idOf(p2))).reread_of).toBe(idOf(p1));
    expect((await row(idOf(p1))).replaced_by).toBeNull();
    expect(await active()).toEqual(['Gift wrap is free.', ...fromP1]);
    expect((await get(p2)).body).toContain(t('en', 'pageFacts.replacesOn', { date: '' }).slice(0, 30));
    // "Again" on the approved one while the new one waits: that one, nothing spent.
    const reopened = await post(`${p1}/again`);
    expect(reopened.headers['location']).toBe(p2);
    expect(asked.length).toBe(before[1]! + 1);

    // Approving the new reading is what replaces: the old reading's lines archived, hers kept, the old reading replaced.
    const ok = await tickAll(p2);
    expect(flashSaid(ok, SECRET)).toBe(t('en', 'pageFacts.flash.replaced'));
    expect(await active()).toEqual(['Gift wrap is free.', 'Refunds go back to the original card.', 'Returns are accepted within 14 days.']);
    const all = await knowledge();
    expect(all.filter((k) => k.from_proposal === idOf(p1)).map((k) => k.status)).toEqual(['archived', 'archived']);
    expect(all.filter((k) => k.from_proposal === idOf(p2)).map((k) => k.status)).toEqual(['active', 'active']);
    expect((await row(idOf(p1))).replaced_by).toBe(idOf(p2));
    const audit = (await admin.query(`select detail from channel_audit where business_id = $1 and action = 'knowledge_imported' order by at desc limit 1`, [BIZ])).rows[0];
    expect(audit.detail).toMatchObject({ proposal: idOf(p2), replaces: idOf(p1), archived: 2 });
  });

  it('TWO CLICKS PAY ONCE; a failure leaves the old reading as it was; finding nothing is charged and changes nothing', async () => {
    const url = 'https://twice.example/pages/care';
    site[url] = html('Wash at 30 degrees.');
    const w = String((await post('/app/knowledge/from-page', { address: url, text: '' })).headers['location']);
    site[url] = html('Wash at 40 degrees.');

    // Two at once: one reading, the other told a reading is under way.
    slow = 300;
    const n = asked.length;
    const [a, b] = await Promise.all([post(`${w}/again`), post(`${w}/again`)]);
    slow = 0;
    expect(asked.length).toBe(n + 1);
    const refused = [a, b].find((r) => r.statusCode === 400)!;
    expect(refused.body).toContain(t('en', 'pageFacts.refused.under_way'));
    const w2 = String([a, b].find((r) => r.statusCode === 302)!.headers['location']);
    expect((await row(idOf(w))).replaced_by).toBe(idOf(w2));

    // The page cannot be reached: nothing asked, nothing charged, the reading as it was, its claim let go.
    down.add(url);
    const c0 = await calls();
    const failed = await post(`${w2}/again`);
    expect(failed.statusCode).toBe(400);
    expect(failed.body).toContain(t('en', 'pageFacts.refused.unreachable'));
    expect([asked.length, await calls()]).toEqual([n + 1, c0]);
    expect(await row(idOf(w2))).toMatchObject({ replaced_by: null, reread_started_at: null });
    down.delete(url);

    // A reading that finds nothing: charged (as the confirm step says), and the reading as it was.
    findNothing = true;
    const empty = await post(`${w2}/again`);
    findNothing = false;
    expect(empty.statusCode).toBe(400);
    expect(empty.body).toContain(t('en', 'pageFacts.refused.nothing_read'));
    expect([asked.length, await calls()]).toEqual([n + 2, c0 + 1]);
    expect(await row(idOf(w2))).toMatchObject({ replaced_by: null, reread_started_at: null });
  });

  it('TODAY\'S ALLOWANCE USED: the confirm step says so and offers no button; the POST reads nothing', async () => {
    const url = 'https://budget.example/pages/faq';
    site[url] = html('We answer within a day.');
    const w = String((await post('/app/knowledge/from-page', { address: url, text: '' })).headers['location']);
    await admin.query(`update tenant_budgets set daily_llm_calls = 1 where business_id = $1`, [BIZ]);
    try {
      const confirm = (await get(`${w}/again`)).body;
      expect(confirm).toContain(t('en', 'pageFacts.refused.allowance_used'));
      expect(confirm).not.toContain(`action="${w}/again"`);
      const n = [fetched.length, asked.length];
      expect((await post(`${w}/again`)).body).toContain(t('en', 'pageFacts.refused.allowance_used'));
      expect(asked.length).toBe(n[1]);
      expect((await row(idOf(w))).replaced_by).toBeNull();
    } finally {
      await admin.query(`update tenant_budgets set daily_llm_calls = 1000 where business_id = $1`, [BIZ]);
    }
  });

  it('TEXT PASTED has no "again": pasting new text is a new reading', async () => {
    const w = String((await post('/app/knowledge/from-page', { address: '', text: 'Our shop opens at nine every morning.' })).headers['location']);
    expect((await get(w)).body).not.toContain(`${w}/again`);
    const r = await get(`${w}/again`);
    expect([r.statusCode, r.headers['location']]).toEqual([302, w]);
    const n = asked.length;
    await post(`${w}/again`);
    expect(asked.length).toBe(n);
  });
});
