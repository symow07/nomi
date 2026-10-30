import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import type { AdvisorModel } from '../../src/llm/ports.js';
import type { Db } from '../../src/db/client.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * A4 (audit batch 5, 2026-10-31) — THE ADVISOR IS METERED, through the real app and the real database:
 *   · before a question reaches the model, today's allowance is asked; used up, the model is asked nothing, the
 *     owner reads why in the re-read's words, and nothing is written to the ledger;
 *   · every call that answered is on the workspace's ledger — calls and tokens, never a turn;
 *   · a workspace without a daily limit is answered, and its use still recorded.
 * Before A4 the advisor made up to two model calls a question with no check and no record (the isolation sweep's
 * hard marker; LAUNCH-CHECKLIST "before the third paying workspace").
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = randomUUID();
const CODE = `advisor-meter-${RUN}`;
const SECRET = 'an-advisor-metering-session-secret-of-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('A4 · the advisor asks the allowance first and writes what it used (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let admin: pg.Client;
  let app: import('fastify').FastifyInstance;
  let owner = '';
  /** Every call the scripted model was asked to make. */
  const calls: string[] = [];
  const model: AdvisorModel = {
    recognise: async ({ question }) => {
      calls.push('recognise');
      const known = /how many customers/i.test(question);
      return { pick: known ? { id: 'A1', period: null, customer: null, product: null, reference: null } : null, usage: { inputTokens: 700, outputTokens: 40 } };
    },
    phrase: async ({ facts }) => { calls.push('phrase'); return { text: facts.join(' '), usage: { inputTokens: 300, outputTokens: 60 } }; },
  };
  const ledger = async () => (await admin.query(
    `select coalesce(sum(llm_calls), 0)::int as calls, coalesce(sum(input_tokens), 0)::int as i, coalesce(sum(output_tokens), 0)::int as o,
            coalesce(sum(turns), 0)::int as turns from usage_ledger where business_id = $1`, [BIZ])).rows[0] as { calls: number; i: number; o: number; turns: number };
  const ask = (q: string) => app.inject({ method: 'POST', url: '/app/advisor', headers: { cookie: owner, ...FORM }, payload: new URLSearchParams({ q }).toString() });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [BIZ, `Advisor Meter ${RUN}`]);
    const client = (await admin.query(`insert into clients (business_id, display_name, phone) values ($1, $2, $3) returning id::text as id`,
      [BIZ, `Noor ${RUN}`, `+3362${Math.floor(Math.random() * 1e7)}`])).rows[0].id as string;
    await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp')`, [BIZ, client]);
    const { createDb, createReadOnlyDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false, kickOutbound: async () => {}, kickDrive: async () => {},
      advisorDb: createReadOnlyDb(DATABASE_URL!), advisorModel: model, advisorProvider: { name: 'DeepSeek', model: 'scripted' },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const r = await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM });
    owner = String(r.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(owner).not.toBe('');
  }, 90_000);
  afterAll(async () => { await app?.close(); await db?.destroy(); await admin?.end(); });

  it('no daily limit: answered, and both calls are on the ledger — calls and tokens, never a turn', async () => {
    calls.length = 0;
    const before = await ledger();
    const r = await ask('How many customers do I have?');
    expect(r.statusCode).toBe(200);
    expect(calls).toEqual(['recognise', 'phrase']);
    const after = await ledger();
    expect({ calls: after.calls - before.calls, i: after.i - before.i, o: after.o - before.o, turns: after.turns - before.turns })
      .toEqual({ calls: 2, i: 1000, o: 100, turns: 0 });
  });

  it('a question it does not know still made one call, and that call is recorded', async () => {
    calls.length = 0;
    const before = await ledger();
    const r = await ask('What is the meaning of life?');
    expect(r.body).toContain(esc(t('en', 'advisor.unknown')));
    expect(calls).toEqual(['recognise']);
    const after = await ledger();
    expect({ calls: after.calls - before.calls, i: after.i - before.i, o: after.o - before.o }).toEqual({ calls: 1, i: 700, o: 40 });
  });

  it('today\'s allowance used up: the model is asked nothing, the owner reads why, and the ledger does not move', async () => {
    await admin.query(`insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded) values ($1, 3, 1000000, 80, 'pause')`, [BIZ]);
    // Three calls are already on today's ledger (the two tests above): the cap of 3 is reached.
    expect((await ledger()).calls).toBe(3);
    calls.length = 0;
    const before = await ledger();
    const r = await ask('How many customers do I have?');
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain(esc(t('en', 'advisor.allowanceUsed')));
    expect(r.body).not.toContain(esc(t('en', 'advisor.failed')));
    expect(calls).toEqual([]);
    expect(await ledger()).toEqual(before);
  });

  it('under the cap again: answered and recorded as before', async () => {
    await admin.query(`update tenant_budgets set daily_llm_calls = 1000 where business_id = $1`, [BIZ]);
    calls.length = 0;
    const before = await ledger();
    await ask('How many customers do I have?');
    expect(calls).toEqual(['recognise', 'phrase']);
    expect((await ledger()).calls - before.calls).toBe(2);
  });
});
