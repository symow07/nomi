import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';

/**
 * C4.b — a first e-mail and its follow-ups, over the REAL production
 * composition: her routes, the sweep, the outbound worker on pg-boss, the
 * adapter map, and the recording mail transport.
 *
 * Time is moved by handing `runDueSteps` a later `now`, never by sleeping. The
 * cron registered by `buildProduction` also sweeps this tenant once a minute with
 * the real clock; it can only ever see a step that is due in real time, and the
 * send key makes it harmless when it does. So every assertion here reads the
 * DATABASE and the TRANSPORT, never a sweep's own counters.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd470000-0000-4000-8000-${RUN}0001`;
const CREDENTIAL_KEY = 'f'.repeat(64);
const WEB_SECRET = createHmac('sha256', CREDENTIAL_KEY).update('yf-web-session').digest('hex');
const addr = (who: string) => `${who}.${RUN}@seq-buyer.test`;
const DAY = 24 * 3600_000;

d('C4.b · first e-mails and follow-ups (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let transport: ReturnType<typeof import('../../src/channels/email/transport.js')['fakeMailTransport']>;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let cookie = '';
  let seqId = '';
  const T0 = new Date();

  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bid(), fn);
  };
  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const post = (url: string, fields: Record<string, string>, as = cookie) => prod.app.inject({
    method: 'POST', url, headers: { cookie: as, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (url: string, as = cookie) => prod.app.inject({ method: 'GET', url, headers: { cookie: as } });
  const flashOf = (res: { headers: Record<string, unknown> }): string =>
    new URL(String(res.headers['location'] ?? ''), 'https://x.test').searchParams.get('flash') ?? '';
  const login = async (code: string) => {
    const r = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    return String(r.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const until = async (cond: () => boolean | Promise<boolean>, what: string, ms = 45_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const mailsTo = (who: string) => transport.sent.filter((m) => m.to === addr(who));
  /** One sweep at a moment of the test's choosing, re-driving through the real worker. */
  const sweep = async (at: Date) => {
    const { runDueSteps } = await import('../../src/outbound/sequences.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    return runDueSteps({
      db: prod.db, now: () => at, templateState: 'none',
      kickDrive: async (b, c) => { await prod.boss.send(QUEUES.outbound, { businessId: b, conversationId: c }, { singletonKey: c }); },
    }, await bid());
  };
  const enrollment = (who: string) => tx((x) => sql<{
    next_position: number; stop_reason: string | null; completed_at: Date | null; conversation_id: string | null;
    next_due_at: Date;
  }>`select next_position, stop_reason, completed_at, conversation_id::text as conversation_id, next_due_at
       from sequence_enrollments where business_id = ${BIZ} and identity = ${addr(who)}
      order by enrolled_at desc limit 1`.execute(x).then((r) => r.rows[0]));
  const addAndAttest = async (who: string, name: string) => {
    expect((await post('/app/contacts', { channel: 'email', identity: addr(who), name, company: '' })).statusCode).toBe(302);
    expect((await post('/app/contacts/consent', { channel: 'email', identity: addr(who) })).statusCode).toBe(302);
  };
  const enrol = (who: string, id = seqId) => post(`/app/sequences/${id}/enroll`, { identity: addr(who) });

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `sequences-${RUN}`;
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { fakeMailTransport } = await import('../../src/channels/email/transport.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    // One address the provider rejects outright: the follow-up to it must not go.
    transport = fakeMailTransport((m) => m.to === addr('rejected')
      ? { ok: false, retryable: false, error: '550 no such mailbox' }
      : { ok: true, providerMessageId: '' });
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: `SIM_PNID_sq${RUN}`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'sq-verify-token',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { adapter: whatsappSimulator([], { tag: `sq${RUN}` }).adapter, logger: false, mailTransport: transport });

    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, 'Sequence Factory')
                        on conflict (id) do nothing`.execute(x));
    cookie = await login(prod.ownerAccessCode);
    expect(cookie).not.toBe('');

    const { setSendingDomain, recordDomainCheck } = await import('../../src/db/sendingDomain.js');
    const b = await bid();
    await tx(async (x) => {
      await setSendingDomain(x, b, { domain: 'sequences.example', dkimSelector: 'k1', by: 'owner' });
      await recordDomainCheck(x, b, { spf: 'ok', dkim: 'ok', dmarc: 'ok' }, new Date());
    });
    expect((await post('/app/channels/outreach', { channel: 'email', enabled: 'true' })).statusCode).toBe(302);
    for (const [who, name] of [['ahmed', 'Ahmed'], ['bounce', 'Bounce'], ['rejected', 'Rejected'],
      ['stopme', 'Stop Me'], ['late', 'Late'], ['capped', 'Capped'], ['wired', 'Wired']] as const) {
      await addAndAttest(who, name);
    }
  }, 90_000);

  afterAll(async () => { await prod?.close(); });

  it('she writes a draft: three e-mails, and nobody can be added to it yet', async () => {
    const created = await post('/app/sequences', { name: 'Totes, autumn' });
    expect(created.statusCode).toBe(302);
    seqId = /\/app\/sequences\/([0-9a-f-]{36})/.exec(String(created.headers['location']))![1]!;

    for (const [delayDays, subject, body] of [
      ['0', 'Canvas totes from Yiwu', 'We make canvas totes, 500 pcs and up.'],
      ['2', 'Following up on totes', 'Did the samples page reach you?'],
      ['3', 'Last note on totes', 'I will not write again about this.'],
    ] as const) {
      const r = await post(`/app/sequences/${seqId}/steps`, { delayDays, subject, body });
      expect(flashOf(r)).toBe(t('en', 'seq.flash.added'));
    }
    expect(flashOf(await enrol('ahmed'))).toBe(t('en', 'seq.flash.notApproved'));

    // And not merely the route: the database refuses an enrolment on a draft.
    const { insertEnrollment } = await import('../../src/db/sequences.js');
    const b = await bid();
    await expect(tx((x) => insertEnrollment(x, b, seqId, { identity: addr('ahmed'), by: 'x', firstDueAt: T0 })))
      .rejects.toThrow(/not approved/);
  });

  it('A STAFF MEMBER cannot approve — the words that go out in her name are hers to pass', async () => {
    const { addPerson } = await import('../../src/api/web/people.js');
    const person = await addPerson(prod.db, BIZ, WEB_SECRET, 'Mei');
    expect(person.code).toBe('added');
    const staff = await login((person as { accessCode: string }).accessCode);
    const page = await get(`/app/sequences/${seqId}`, staff);
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('/approve"');
    const fp = /name="fingerprint" value="([0-9a-f]{64})"/.exec((await get(`/app/sequences/${seqId}`)).body)![1]!;
    await post(`/app/sequences/${seqId}/approve`, { fingerprint: fp }, staff);
    const s = await tx((x) => sql<{ approved_at: Date | null }>`
      select approved_at from sequences where id = ${seqId}::uuid`.execute(x).then((r) => r.rows[0]!));
    expect(s.approved_at, 'a staff member approved it').toBeNull();
  });

  it('AN EDIT WHILE SHE READS is caught: she approves only the words she saw', async () => {
    const fpBefore = /name="fingerprint" value="([0-9a-f]{64})"/.exec((await get(`/app/sequences/${seqId}`)).body)![1]!;
    await post(`/app/sequences/${seqId}/steps/2`, {
      delayDays: '2', subject: 'Following up on totes', body: 'Did the samples page reach you? (edited)',
    });
    expect(flashOf(await post(`/app/sequences/${seqId}/approve`, { fingerprint: fpBefore })))
      .toBe(t('en', 'seq.flash.changed'));

    const page = await get(`/app/sequences/${seqId}`);
    expect(page.body).toContain('(edited)');
    const fp = /name="fingerprint" value="([0-9a-f]{64})"/.exec(page.body)![1]!;
    expect(flashOf(await post(`/app/sequences/${seqId}/approve`, { fingerprint: fp }))).toBe(t('en', 'seq.flash.approved'));
  });

  it('ONCE APPROVED the words cannot change — not through her page, not through SQL', async () => {
    const r = await post(`/app/sequences/${seqId}/steps/1`, { delayDays: '0', subject: 'Changed', body: 'Changed' });
    expect(flashOf(r)).toBe(t('en', 'seq.flash.notDraft'));
    await expect(tx((x) => sql`update sequence_steps set body = 'sneaky' where sequence_id = ${seqId}::uuid`.execute(x)))
      .rejects.toThrow(/approved/);
    await expect(tx((x) => sql`update sequences set name = 'renamed' where id = ${seqId}::uuid`.execute(x)))
      .rejects.toThrow(/approved/);
  });

  it('SHE ADDS HIM, and the first e-mail goes — once, through the one worker, with a way out', async () => {
    const page = await get(`/app/sequences/${seqId}`);
    expect(page.body).toContain(`value="${addr('ahmed')}"`);
    expect(flashOf(await enrol('ahmed'))).toBe(t('en', 'seq.flash.enrolled'));
    expect(flashOf(await enrol('ahmed'))).toBe(t('en', 'seq.flash.already'));

    // Three sweeps at once — a deploy overlapping, a slow minute — and one mail.
    const at = new Date(T0.getTime() + 60_000);
    await Promise.all([sweep(at), sweep(at), sweep(at)]);
    await until(() => mailsTo('ahmed').length === 1, 'the first e-mail');
    const m = mailsTo('ahmed')[0]!;
    expect(m.subject).toBe('Canvas totes from Yiwu');
    expect(m.headers['List-Unsubscribe']).toMatch(/^<https:\/\/nomi\.test\/u\?t=/);

    const e = await enrollment('ahmed');
    expect(e?.stop_reason, 'racing sweeps ended the enrolment').toBeNull();
    expect(e?.next_position).toBe(2);
    expect(e?.conversation_id).not.toBeNull();
    const rows = await tx((x) => sql<{ outbound: number; threads: number; clients: number }>`
      select (select count(*)::int from outbound_messages where business_id = ${BIZ} and to_wa_id = ${addr('ahmed')}) as outbound,
             (select count(*)::int from conversations c join clients cl on cl.id = c.client_id
               where cl.business_id = ${BIZ} and cl.email = ${addr('ahmed')}) as threads,
             (select count(*)::int from clients where business_id = ${BIZ} and email = ${addr('ahmed')}) as clients`
      .execute(x).then((r) => r.rows[0]!));
    expect(rows, 'one step became more than one row, thread or client').toEqual({ outbound: 1, threads: 1, clients: 1 });

    // A second sweep at the same moment sends nothing more.
    await sweep(new Date(T0.getTime() + 120_000));
    await new Promise((r) => setTimeout(r, 2500));
    expect(mailsTo('ahmed')).toHaveLength(1);
  }, 90_000);

  it('THE FOLLOW-UP WAITS ITS DAYS, then goes into the same conversation', async () => {
    await until(async () => (await tx((x) => sql<{ status: string }>`
      select o.status from sequence_sends s join outbound_messages o on o.id = s.outbound_id
       join sequence_enrollments e on e.id = s.enrollment_id
       where e.identity = ${addr('ahmed')} and s.position = 1`.execute(x).then((r) => r.rows[0]?.status))) === 'sent',
      'step one to be marked sent');
    // Step one left "two days ago" in this test's time, so say so in the row.
    // The outbound sequencer holds a message for up to 90 s after the one before
    // it in the same conversation was sent, waiting on a WhatsApp delivery
    // receipt; days apart in real life that hold has long expired, and a test
    // that moves time by argument has to move this timestamp with it.
    await tx((x) => sql`update outbound_messages set sent_at = now() - interval '2 days'
                         where business_id = ${BIZ} and to_wa_id = ${addr('ahmed')}`.execute(x));
    await sweep(new Date(T0.getTime() + 1 * DAY));
    await new Promise((r) => setTimeout(r, 1500));
    expect(mailsTo('ahmed'), 'the follow-up went early').toHaveLength(1);

    await sweep(new Date(T0.getTime() + 2 * DAY + 5 * 60_000));
    await until(() => mailsTo('ahmed').length === 2, 'the follow-up');
    expect(mailsTo('ahmed')[1]!.subject).toBe('Following up on totes');
    expect(mailsTo('ahmed')[1]!.text).toBe('Did the samples page reach you? (edited)');
    const threads = await tx((x) => sql<{ n: number }>`
      select count(distinct conversation_id)::int as n from outbound_messages
       where business_id = ${BIZ} and to_wa_id = ${addr('ahmed')}`.execute(x).then((r) => r.rows[0]!.n));
    expect(threads).toBe(1);
  }, 90_000);

  it('HE ANSWERS — and it stops, and says so on her page', async () => {
    const e = await enrollment('ahmed');
    await tx((x) => sql`insert into messages (conversation_id, direction, input_type, text_content, sent_at)
                        values (${e!.conversation_id}::uuid, 'inbound', 'text', 'Yes, send prices', now())`.execute(x));
    await sweep(new Date(T0.getTime() + 6 * DAY));
    expect((await enrollment('ahmed'))?.stop_reason).toBe('replied');
    await new Promise((r) => setTimeout(r, 1500));
    expect(mailsTo('ahmed'), 'the third mail went after he answered').toHaveLength(2);
    expect((await get(`/app/sequences/${seqId}`)).body).toContain(esc(t('en', 'seq.stop.replied')));
  }, 90_000);

  it('A BOUNCE stops it, by its own name', async () => {
    const { suppress } = await import('../../src/db/contacts.js');
    expect(flashOf(await enrol('bounce'))).toBe(t('en', 'seq.flash.enrolled'));
    await sweep(new Date(T0.getTime() + 60_000));
    await until(() => mailsTo('bounce').length === 1, 'the first e-mail to bounce');
    const b = await bid();
    await tx((x) => suppress(x, b, { channel: 'email', identity: addr('bounce'), reason: 'bounced', detail: null }));
    await sweep(new Date(T0.getTime() + 3 * DAY));
    expect((await enrollment('bounce'))?.stop_reason).toBe('bounced');
    expect(mailsTo('bounce')).toHaveLength(1);
  }, 90_000);

  it('A FOLLOW-UP TO A MAIL THAT NEVER ARRIVED does not go', async () => {
    expect(flashOf(await enrol('rejected'))).toBe(t('en', 'seq.flash.enrolled'));
    await sweep(new Date(T0.getTime() + 60_000));
    await until(async () => (await tx((x) => sql<{ status: string }>`
      select o.status from outbound_messages o where o.business_id = ${BIZ} and o.to_wa_id = ${addr('rejected')}`
      .execute(x).then((r) => r.rows[0]?.status))) === 'failed', 'the rejected first mail to be marked failed');
    await sweep(new Date(T0.getTime() + 3 * DAY));
    expect((await enrollment('rejected'))?.stop_reason).toBe('previous_not_sent');
  }, 90_000);

  it('she stops it for one person by hand, and nothing more goes', async () => {
    expect(flashOf(await enrol('stopme'))).toBe(t('en', 'seq.flash.enrolled'));
    const id = await tx((x) => sql<{ id: string }>`
      select id::text as id from sequence_enrollments where identity = ${addr('stopme')}`.execute(x).then((r) => r.rows[0]!.id));
    expect(flashOf(await post(`/app/sequences/${seqId}/enrollments/${id}/stop`, {}))).toBe(t('en', 'seq.flash.stopped'));
    await sweep(new Date(T0.getTime() + 60_000));
    await new Promise((r) => setTimeout(r, 1500));
    expect(mailsTo('stopme')).toEqual([]);
    expect((await enrollment('stopme'))?.stop_reason).toBe('stopped_by_owner');
  }, 60_000);

  it('HER CAP HOLDS a step until tomorrow — and a week of holding stops it', async () => {
    const b = await bid();
    expect((await post('/app/channels/outreach/cap', { channel: 'email', cap: '1' })).statusCode).toBe(302);
    expect(flashOf(await enrol('capped'))).toBe(t('en', 'seq.flash.enrolled'));
    await sweep(new Date(T0.getTime() + 60_000));
    const held = await enrollment('capped');
    expect(held?.next_position, 'a capped step was queued anyway').toBe(1);
    expect(held?.next_due_at.getTime()).toBeGreaterThan(T0.getTime());
    expect(mailsTo('capped')).toEqual([]);

    // A week on, with her domain checked again that day so only the cap is in play.
    const weekOn = new Date(T0.getTime() + 8 * DAY);
    const { recordDomainCheck } = await import('../../src/db/sendingDomain.js');
    await tx((x) => recordDomainCheck(x, b, { spf: 'ok', dkim: 'ok', dmarc: 'ok' }, weekOn));
    await sweep(weekOn);
    expect((await enrollment('capped'))?.stop_reason).toBe('cap');
    await post('/app/channels/outreach/cap', { channel: 'email', cap: '' });
  }, 60_000);

  it('THE SWEEP IS WIRED INTO PRODUCTION: a tick on its queue sends what is due', async () => {
    // The cron fires this same job every minute; sending one by hand exercises
    // the worker `buildProduction` registered without waiting for the clock.
    const { QUEUES } = await import('../../src/queue/boss.js');
    expect(flashOf(await enrol('wired'))).toBe(t('en', 'seq.flash.enrolled'));
    await prod.boss.send(QUEUES.sequences, { businessId: BIZ });
    await until(() => mailsTo('wired').length === 1, 'the worker on the sequences queue to send it');
  }, 90_000);

  it('THE OPS KILL SWITCH holds every follow-up: the sweep queues nothing, and a step already queued is refused', async () => {
    const pg = (await import('pg')).default;
    const ops = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
    await ops.connect();
    try {
      // A step queued the moment before the switch: the send-time gate must stop it.
      const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
      const { claimSend, recordSend, insertEnrollment } = await import('../../src/db/sequences.js');
      const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
      const { emailAdapter } = await import('../../src/channels/email/adapter.js');
      const { fakeMailTransport } = await import('../../src/channels/email/transport.js');
      const b = await bid();
      await addAndAttest('silenced', 'Silenced');
      const queued = await tx(async (x) => {
        await insertEnrollment(x, b, seqId, { identity: addr('silenced'), by: 'Lily', firstDueAt: T0 });
        const e = (await sql<{ id: string }>`select id::text as id from sequence_enrollments
                    where identity = ${addr('silenced')}`.execute(x)).rows[0]!;
        const c = await ensureConversation(x, b, addr('silenced'), 'Silenced', 'email');
        await claimSend(x, b, e.id, 1);
        const o = (await enqueueOutboundRow(x, b, c.conversationId, 'Hello.', 'outreach', { subject: 'Hello' }))!;
        await recordSend(x, e.id, 1, o);
        return c.conversationId;
      });

      await ops.query(`insert into ops_flags (business_id, flag, reason, set_by) values ($1, 'global_silence', 'C4.b test', 'test')`, [BIZ]);
      const own = fakeMailTransport();
      const email = emailAdapter({ transport: own });
      const effects = await tx((x) => driveConversationOutbound({
        store: channelStore(x, b), adapter: email, adapters: (k) => (k === 'email' ? email : undefined),
        mailHeaders: () => ({ 'List-Unsubscribe': '<https://nomi.test/u?t=x>' }), now: () => new Date(),
      }, queued));
      expect(effects).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'silenced' }));
      expect(own.sent).toEqual([]);

      // And the sweep looks at nothing while it is on.
      expect(flashOf(await enrol('late'))).toBe(t('en', 'seq.flash.enrolled'));
      const r = await sweep(new Date(T0.getTime() + 60_000));
      expect(r.looked).toBe(0);
      expect((await enrollment('late'))?.next_position).toBe(1);
    } finally {
      await ops.query(`update ops_flags set cleared_at = now() where business_id = $1 and cleared_at is null`, [BIZ]);
      await ops.end();
    }
  }, 60_000);

  it('TAKING IT OUT OF USE stops everyone still on it, and nobody can be added again', async () => {
    // 'late' was enrolled while the switch was on, and is still waiting.
    expect(flashOf(await post(`/app/sequences/${seqId}/archive`, {}))).toBe(t('en', 'seq.flash.archived'));
    expect((await enrollment('late'))?.stop_reason).toBe('sequence_archived');
    expect(flashOf(await enrol('late'))).toBe(t('en', 'seq.flash.notApproved'));
    await expect(tx((x) => sql`update sequences set archived_at = null where id = ${seqId}::uuid`.execute(x)))
      .rejects.toThrow(/archived/);
  });

  it('A DEFERRAL NEVER BRINGS A STEP FORWARD, whoever asks for one', async () => {
    const { deferEnrollment } = await import('../../src/db/sequences.js');
    const id = await tx((x) => sql<{ id: string; due: Date }>`
      select id::text as id, next_due_at as due from sequence_enrollments
       where business_id = ${BIZ} and identity = ${addr('late')}`.execute(x).then((r) => r.rows[0]!));
    await tx((x) => deferEnrollment(x, id.id, new Date(id.due.getTime() - 3 * DAY)));
    const after = await tx((x) => sql<{ due: Date }>`
      select next_due_at as due from sequence_enrollments where id = ${id.id}::uuid`.execute(x).then((r) => r.rows[0]!));
    expect(after.due.getTime()).toBe(id.due.getTime());
  });

  it('the stop vocabulary in code is the vocabulary the column accepts', async () => {
    const { SEQUENCE_STOPS } = await import('../../src/core/outreach/sequence.js');
    const def = await tx((x) => sql<{ def: string }>`
      select pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = 'sequence_enrollments'::regclass and conname = 'sequence_enrollments_stop_reason_check'`
      .execute(x).then((r) => r.rows[0]?.def ?? ''));
    for (const r of SEQUENCE_STOPS) expect(def, r).toContain(`'${r}'`);
  });
});
