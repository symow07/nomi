import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { RECORD_STATES } from '../../src/core/outreach/domain.js';

/**
 * The SPF state the code has returned since G14, which the column refused
 * (0045).
 *
 * G14 gave "is her SPF record right?" a fourth answer — `no_sender`: her record
 * is fine and we cannot confirm it, because no sending provider is configured
 * yet. It stops the page telling her to fix DNS that is already correct. The
 * type gained the value; the CHECK did not.
 *
 * `SENDING_SPF_INCLUDE` is unset in production — it arrives with the sending
 * provider (M52) — so `checkSpf` returns `no_sender` for every well-formed
 * record, and `recordDomainCheck` writes it unconditionally. Pressing "check my
 * domain" therefore raised a constraint violation and a 500, on an owner
 * action, in exactly the configuration production runs in.
 *
 * NOTHING CAUGHT IT because the existing suite always passes an include
 * (tests/integration/sending-domain.test.ts:70) and so never produced the one
 * state the column rejected. This file is that configuration: no include, which
 * is the default everywhere today.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd450000-0000-4000-8000-${RUN}0001`;

d('the domain check with no sending provider configured (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };
  const post = (url: string, body: string) => app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: body,
  });

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx((t) => sql`insert into businesses (id, name) values (${BIZ}, 'No Sender Factory')
                        on conflict (id) do nothing`.execute(t));

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: 'no-sender-code',
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      // NO sendingInclude — production's own configuration.
      resolveDns: async () => ({
        spf: ['v=spf1 include:spf.protection.outlook.com -all'],   // hers, and correct
        dkim: ['v=DKIM1; k=rsa; p=MIIBIjANBgkq'],
        dmarc: ['v=DMARC1; p=quarantine; rua=mailto:dmarc@yiwuhf.com'],
      }),
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({
      method: 'POST', url: '/login', payload: 'code=no-sender-code',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('HER CHECK SUCCEEDS AND IS RECORDED — it used to be a 500 from the database', async () => {
    expect((await post('/app/channels/domain', 'domain=yiwuhf.com&selector=k1')).statusCode).toBe(302);
    const res = await post('/app/channels/domain/check', '');
    expect(res.statusCode).toBe(302);

    const row = await tx((t) => sql<{ spf_state: string; dkim_state: string; checked_at: Date | null }>`
      select spf_state, dkim_state, checked_at from sending_domains where business_id = ${BIZ}
    `.execute(t).then((r) => r.rows[0]));
    expect(row?.spf_state, 'her correct record was called something else').toBe('no_sender');
    expect(row?.dkim_state).toBe('ok');
    expect(row?.checked_at, 'the check ran but was never recorded').not.toBeNull();
  });

  it('and sending stays refused: unconfirmed is not confirmed', async () => {
    const { sendingDomain } = await import('../../src/db/sendingDomain.js');
    const { mayUseDomain } = await import('../../src/core/outreach/domain.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const dom = await tx((t) => sendingDomain(t, bid.value));
    expect(dom).not.toBeNull();
    const verdict = mayUseDomain({ check: dom!.check, checkedAt: dom!.checkedAt }, new Date());
    expect(verdict.ok, 'an unconfirmable SPF record was treated as verified').toBe(false);
  });

  it('THE COLUMN AND THE TYPE HOLD THE SAME VOCABULARY, so this cannot recur', async () => {
    // The defect was a type that knew a value its column refused. Compared
    // directly, for all three records: they share one `RecordState`.
    const defs = await tx((t) => sql<{ name: string; def: string }>`
      select conname as name, pg_get_constraintdef(oid) as def
        from pg_constraint
       where conrelid = 'sending_domains'::regclass and contype = 'c'
         and conname like '%_state_check'
    `.execute(t).then((r) => r.rows));
    expect(defs.length, 'a state column lost its constraint').toBe(3);
    for (const c of defs) {
      for (const state of RECORD_STATES) {
        expect(c.def, `${c.name} refuses '${state}', which the code can produce`).toContain(`'${state}'`);
      }
    }
  });
});
