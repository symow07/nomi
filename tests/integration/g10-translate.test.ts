import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { flashSaid } from './tenant.js';

/**
 * G10 (decision 38) — over Postgres and the real route: a waiting reply in
 * Chinese, an owner who reads English. "Translate it for me" asks the model
 * (a fake here), keeps the translation on the draft, counts the call on the
 * day's ledger, and shows it on the card — and nothing is sent. With the
 * day's allowance used, no model is asked.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd9a0000-0000-4000-8000-${RUN}0001`;
const CODE = `g10-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('G10 · a reply the owner may not read (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let cookie = '';
  let conv = '';
  let draft = '';
  const asked: string[] = [];
  const sent: string[] = [];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [BIZ, `G10 Shop ${RUN}`]);
    const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, 'Wang Fang') returning id`, [BIZ])).rows[0].id;
    conv = (await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'instagram') returning id::text as id`, [BIZ, client])).rows[0].id;
    await admin.query(`insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at) values ($1, $2, 'inbound', 'text', '玫瑰精华10瓶多少钱？', now())`, [conv, `g10-${RUN}`]);
    draft = (await admin.query(`insert into drafts (business_id, conversation_id, capability, draft_text) values ($1, $2, 'quote', '玫瑰精华每瓶34.90美元，10瓶共349美元。') returning id::text as id`, [BIZ, conv])).rows[0].id;
    await admin.query(`insert into conversation_events (business_id, conversation_id, type, payload) values ($1, $2, 'draft_pending', $3)`,
      [BIZ, conv, JSON.stringify({ draftId: draft, capability: 'quote', language: 'zh' })]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, kickOutbound: async (_b: string, _c: string, text: string) => { sent.push(text); }, kickDrive: async () => {},
      draftTranslator: { translate: async ({ text, toLanguage }: { text: string; toLanguage: string }) => {
        asked.push(`${toLanguage}: ${text}`);
        return { text: 'Rose serum is $34.90 a bottle; 10 bottles are $349.', modelId: 'fake', usage: { inputTokens: 40, outputTokens: 20 } };
      } },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    cookie = String((await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 60_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  const page = () => app.inject({ method: 'GET', url: `/app/inbox/${conv}`, headers: { cookie } });
  const translate = () => app.inject({ method: 'POST', url: `/app/inbox/${conv}/translate`, payload: `draftId=${draft}`, headers: { cookie, ...FORM } });

  it('the card says the reply is in Chinese, lists its figures, and offers the translation', async () => {
    const body = (await page()).body.replace(/[\u2066-\u2069]/g, '');
    expect(body).toContain(t('en', 'card.foreign', { language: 'Chinese' }));
    expect(body).toContain('<bdi dir="ltr">34.90</bdi>, <bdi dir="ltr">10</bdi>, <bdi dir="ltr">349</bdi>');
    expect(body).toContain(`action="/app/inbox/${conv}/translate"`);
  });

  it('WITH THE ALLOWANCE USED, no model is asked', async () => {
    await admin.query(`insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded) values ($1, 10, 1000000, 80, 'pause')`, [BIZ]);
    await admin.query(`insert into usage_ledger (business_id, day, llm_calls) values ($1, (now() at time zone 'UTC')::date, 10)`, [BIZ]);
    const r = await translate();
    expect(flashSaid(r, SECRET)).toBe(t('en', 'inbox.flash.translate.allowance'));
    expect(asked).toEqual([]);
    await admin.query(`delete from tenant_budgets where business_id = $1`, [BIZ]);
  });

  it('TRANSLATED into the owner\'s language, kept on the draft, counted — and nothing sent', async () => {
    const before = Number((await admin.query(`select llm_calls from usage_ledger where business_id = $1 and day = (now() at time zone 'UTC')::date`, [BIZ])).rows[0].llm_calls);
    const r = await translate();
    expect(r.statusCode).toBe(302);
    expect(asked).toEqual(['English: 玫瑰精华每瓶34.90美元，10瓶共349美元。']);
    const row = (await admin.query(`select translation, translation_locale, status from drafts where id = $1`, [draft])).rows[0];
    expect(row).toEqual({ translation: 'Rose serum is $34.90 a bottle; 10 bottles are $349.', translation_locale: 'en', status: 'pending' });
    expect(Number((await admin.query(`select llm_calls from usage_ledger where business_id = $1 and day = (now() at time zone 'UTC')::date`, [BIZ])).rows[0].llm_calls)).toBe(before + 1);
    const body = (await page()).body;
    expect(body).toContain('Rose serum is $34.90 a bottle; 10 bottles are $349.');
    expect(body).toContain(t('en', 'card.foreign.translation', { language: 'English' }));
    expect(sent).toEqual([]);
    expect((await admin.query(`select count(*)::int as n from outbound_messages where conversation_id = $1`, [conv])).rows[0].n).toBe(0);
  });

  it('a reply no longer waiting is not translated', async () => {
    await admin.query(`update drafts set status = 'rejected', decided_at = now() where id = $1`, [draft]);
    const r = await translate();
    expect(flashSaid(r, SECRET)).toBe(t('en', 'inbox.flash.translate.gone'));
    expect(asked).toHaveLength(1);
  });
});
