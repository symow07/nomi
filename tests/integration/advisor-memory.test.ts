import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { advisorKeysFrom, sealAdvisor } from '../../src/advisor/seal.js';
// @ts-expect-error — the operator tools, plain JS on purpose (tools/ is not type-checked).
import { planErasure, sameCounts } from '../../tools/erase-buyer.mjs';
// @ts-expect-error — the operator tools, plain JS on purpose.
import { parseLedgerLine, ledgerLine } from '../../tools/replay-erasures.mjs';

/**
 * 0130 — THE ADVISOR'S MEMORY, STORAGE AND DELETION (docs/ADVISOR-MEMORY.md; the owner's decisions of
 * 2026-10-07), against real Postgres, row security on, the app role holding no DELETE:
 *
 *   · nothing is kept without the owner's workspace switch (D1) AND the person's own granted consent —
 *     the database refuses the row; and the trigger is what refuses it (switched off, the row goes in);
 *   · a person's history is theirs: the owner cannot read a team member's (D2) — only delete all of it,
 *     unread; nobody else can delete anyone's conversation;
 *   · every way it goes writes the ledger: withdrawal, one conversation, the owner unread, the workspace
 *     switched off, twelve months unopened (D5), a person removed from the team;
 *   · a customer's erasure removes the turns that name them — whole — and only those, a conversation it
 *     leaves empty with them; erase-buyer's plan counts the very same rows;
 *   · closing a workspace takes everything; a restore that brought any of it back is put right again.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const KEYS = advisorKeysFrom({ ADVISOR_KEY: 'ab'.repeat(32) });
const seal = (s: string) => sealAdvisor(KEYS, s)!;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** tools/replay-erasures.mjs, run for real against this database as its admin role. */
const replay = (args: string[]) => {
  const r = spawnSync(process.execPath, ['tools/replay-erasures.mjs', ...args], { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL }, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

d('0130 · the advisor\'s memory: kept only with consent, each person\'s own, and deleted every way (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let app: pg.Client;
  let SHOP = ''; let OWNER = ''; let STAFF = ''; let OTHER_STAFF = '';
  let A = ''; let B = ''; let C = '';

  /** One transaction as the app: this workspace, this person. */
  const as = async <T>(person: string, fn: (q: (sql: string, p?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>, biz = SHOP): Promise<T> => {
    await app.query('begin');
    try {
      await app.query("select set_config('app.business_id', $1, true), set_config('app.person_id', $2, true)", [biz, person]);
      const r = await fn((sql, p) => app.query(sql, p));
      await app.query('commit');
      return r;
    } catch (e) {
      await app.query('rollback').catch(() => {});
      throw e;
    }
  };
  const consent = (person: string, event: 'granted' | 'refused' | 'withdrawn') =>
    as(person, (q) => q(`insert into advisor_consents (business_id, person_id, event, wording_version, locale) values ($1, $2, $3, 'a1b2c3d4e5f6', 'en')`,
      [SHOP, person, event]));
  /** A conversation with its turns, each naming the customers given — as the app keeps it. */
  const keep = async (person: string, turns: string[][], opened = "now()"): Promise<{ thread: string; turns: string[] }> => as(person, async (q) => {
    const t = seal('How are sales?');
    const thread = (await q(`insert into advisor_threads (business_id, person_id, title_ciphertext, sealed_with, opened_at)
                             values ($1, $2, $3, $4, ${opened}) returning id::text as id`, [SHOP, person, t.ciphertext, t.sealedWith])).rows[0].id as string;
    const ids: string[] = [];
    for (const names of turns) {
      const s = seal('words');
      const id = (await q(`insert into advisor_turns (thread_id, business_id, person_id, question_ciphertext, entry_id, params_ciphertext,
                                                     answer_kind, answer_ciphertext, facts_ciphertext, sealed_with)
                           values ($1, $2, $3, $4, 'A3', $4, 'fact', $4, $4, $5) returning id::text as id`,
        [thread, SHOP, person, s.ciphertext, s.sealedWith])).rows[0].id as string;
      for (const c of names) await q('insert into advisor_turn_subjects (turn_id, client_id, business_id) values ($1, $2, $3)', [id, c, SHOP]);
      ids.push(id);
    }
    return { thread, turns: ids };
  });
  const n = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const ledger = (where: string, p: unknown[]) => admin.query(`select * from erasure_ledger where business_id = $1 and ${where} order by at desc`, [SHOP, ...p]);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL }); await admin.connect();
    app = new pg.Client({ connectionString: DATABASE_URL }); await app.connect();
    SHOP = (await admin.query(`insert into businesses (name, owner_locale) values ($1, 'en') returning id::text as id`, [`Memory Shop ${RUN}`])).rows[0].id;
    const person = async (name: string, owner: boolean) =>
      (await admin.query('insert into people (business_id, name, is_owner) values ($1, $2, $3) returning id::text as id', [SHOP, name, owner])).rows[0].id as string;
    OWNER = await person('Lena', true);
    STAFF = await person('Xiao Chen', false);
    OTHER_STAFF = await person('Omar', false);
    const client = async (name: string) =>
      (await admin.query('insert into clients (business_id, display_name) values ($1, $2) returning id::text as id', [SHOP, `${name} ${RUN}`])).rows[0].id as string;
    A = await client('Amira'); B = await client('Bao'); C = await client('Carlos');
  });
  afterAll(async () => { await app?.end(); await admin?.end(); });

  it('nothing is kept before the owner switches it on for the workspace, and before the person says yes', async () => {
    await consent(STAFF, 'granted');
    await expect(keep(STAFF, [[]])).rejects.toMatchObject({ code: 'NE020' });                     // the switch is off
    await expect(as(STAFF, (q) => q('select advisor_history_set(true)'))).rejects.toMatchObject({ code: 'NE022' });   // only the owner
    await as(OWNER, (q) => q('select advisor_history_set(true)'));
    await expect(keep(OWNER, [[]])).rejects.toMatchObject({ code: 'NE020' });                     // the owner has not said yes
    await consent(OTHER_STAFF, 'refused');
    await expect(keep(OTHER_STAFF, [[]])).rejects.toMatchObject({ code: 'NE020' });               // said no
    await expect(keep(STAFF, [[]])).resolves.toBeDefined();                                        // switch on, and yes
    await consent(STAFF, 'withdrawn');
    await expect(keep(STAFF, [[]])).rejects.toMatchObject({ code: 'NE020' });                     // took it back
    await consent(STAFF, 'granted');
    await consent(OWNER, 'granted');
    await consent(OTHER_STAFF, 'granted');
  });

  it('the gate is what refuses: the same row, with the trigger switched off, goes in (the control)', async () => {
    await consent(OTHER_STAFF, 'refused');
    await admin.query('begin');
    try {
      await admin.query('alter table advisor_threads disable trigger advisor_threads_consent');
      const t = seal('x');
      await expect(admin.query(`insert into advisor_threads (business_id, person_id, title_ciphertext, sealed_with) values ($1, $2, $3, $4)`,
        [SHOP, OTHER_STAFF, t.ciphertext, t.sealedWith])).resolves.toBeDefined();
    } finally {
      await admin.query('rollback');
    }
    await expect(keep(OTHER_STAFF, [[]])).rejects.toMatchObject({ code: 'NE020' });
    await consent(OTHER_STAFF, 'granted');
  });

  it('the practice copy keeps nothing: the owner\'s yes in the workspace does not reach it, and its switch, set by hand, changes nothing', async () => {
    // A practice copy has no people of its own (0086 refuses them), so nobody can say yes there.
    const copy = (await admin.query(`insert into businesses (name, practice_of, advisor_history_at) values ($1, $2, now()) returning id::text as id`,
      [`Memory Practice ${RUN}`, SHOP])).rows[0].id as string;
    const t = seal('practised');
    await expect(admin.query(`insert into advisor_threads (business_id, person_id, title_ciphertext, sealed_with) values ($1, $2, $3, $4)`,
      [copy, OWNER, t.ciphertext, t.sealedWith])).rejects.toMatchObject({ code: 'NE020' });
    expect((await admin.query('select advisor_may_keep($1, $2) as ok', [copy, OWNER])).rows[0].ok).toBe(false);
    expect((await admin.query('select advisor_may_keep($1, $2) as ok', [SHOP, OWNER])).rows[0].ok).toBe(true);   // the control: the workspace keeps
    await expect(as(OWNER, (q) => q('select advisor_history_set(true)'), copy)).rejects.toMatchObject({ code: 'NE022' });
  });


  it('the app can never delete, nor rewrite a consent: the database refuses', async () => {
    await expect(as(STAFF, (q) => q('delete from advisor_threads where person_id = $1', [STAFF]))).rejects.toMatchObject({ code: '42501' });
    await expect(as(STAFF, (q) => q("update advisor_consents set event = 'granted' where person_id = $1", [STAFF]))).rejects.toMatchObject({ code: '42501' });
  });

  it('D2 · a person\'s history is theirs: the owner reads none of a team member\'s — row security, not a promise', async () => {
    const mine = await keep(STAFF, [[A]]);
    const ownersView = await as(OWNER, (q) => q('select count(*)::int as n from advisor_threads where id = $1', [mine.thread]));
    expect(ownersView.rows[0].n).toBe(0);
    const ownersTurns = await as(OWNER, (q) => q('select count(*)::int as n from advisor_turns where thread_id = $1', [mine.thread]));
    expect(ownersTurns.rows[0].n).toBe(0);
    const theirs = await as(STAFF, (q) => q('select count(*)::int as n from advisor_threads where id = $1', [mine.thread]));
    expect(theirs.rows[0].n).toBe(1);
  });

  it('a person deletes one conversation of theirs; the owner deletes a team member\'s history whole, unread — and nothing else is allowed', async () => {
    const one = await keep(STAFF, [[]]);
    const two = await keep(STAFF, [[]]);
    const r = await as(STAFF, (q) => q('select advisor_forget($1, $2) as r', [STAFF, one.thread]));
    expect(r.rows[0].r.erased).toMatchObject({ advisor_threads: 1, advisor_turns: 1 });
    expect(await n('select count(*) as n from advisor_threads where id = $1', [one.thread])).toBe(0);
    expect(await n('select count(*) as n from advisor_threads where id = $1', [two.thread])).toBe(1);
    const line = (await ledger("kind = 'advisor' and $2 = any(thread_ids)", [one.thread])).rows[0];
    expect(line).toMatchObject({ via: 'person', person_id: STAFF, by_who: STAFF, customer_id: null });

    // the owner: one of a team member's conversations, no; their history whole, yes — without reading it
    await expect(as(OWNER, (q) => q('select advisor_forget($1, $2)', [STAFF, two.thread]))).rejects.toMatchObject({ code: 'NE022' });
    // a team member: someone else's, never
    await expect(as(OTHER_STAFF, (q) => q('select advisor_forget($1, null)', [STAFF]))).rejects.toMatchObject({ code: 'NE022' });
    const all = await as(OWNER, (q) => q('select advisor_forget($1, null) as r', [STAFF]));
    expect(Object.keys(all.rows[0].r)).toEqual(['erased']);                                         // counts, never content
    expect(await n('select count(*) as n from advisor_threads where person_id = $1', [STAFF])).toBe(0);
    expect((await ledger("kind = 'advisor' and person_id = $2 and via = 'owner'", [STAFF])).rows[0]).toMatchObject({ by_who: OWNER });
  });

  it('D5 · a conversation not opened for twelve months is deleted, with its ledger line; one opened inside the year stays', async () => {
    const old = await keep(OTHER_STAFF, [[]], "now() - interval '13 months'");
    const recent = await keep(OTHER_STAFF, [[]], "now() - interval '11 months'");
    const gone = Number((await admin.query('select advisor_expire() as n')).rows[0].n);
    expect(gone).toBeGreaterThanOrEqual(1);
    expect(await n('select count(*) as n from advisor_threads where id = $1', [old.thread])).toBe(0);
    expect(await n('select count(*) as n from advisor_threads where id = $1', [recent.thread])).toBe(1);
    expect((await ledger("kind = 'advisor' and $2 = any(thread_ids)", [old.thread])).rows[0]).toMatchObject({ via: 'retention', by_who: 'retention' });
  });

  it('a customer\'s erasure removes the turns that name them, whole, and only those — and erase-buyer\'s plan counts the same', async () => {
    const both = await keep(OWNER, [[A, B], [B]]);           // a turn naming Amira and Bao, then one naming only Bao
    const only = await keep(OWNER, [[A]]);                    // a conversation whose only turn names Amira
    const bao = await keep(OWNER, [[B]]);
    const req = (await admin.query(`insert into deletion_requests (business_id, scope, client_id, asked_by) values ($1, 'buyer', $2, 'owner') returning id::text as id`,
      [SHOP, A])).rows[0].id as string;

    // The operator's plan, in the same transaction the database then carries out (and rolls back): the same rows.
    await admin.query('begin');
    try {
      const plan = await planErasure(admin, { businessId: SHOP, clientId: A, requestId: req });
      expect(plan.refusals ?? []).toEqual([]);
      expect(plan.erased.get('advisor_turn_subjects')).toBe(3);
      const done = (await admin.query("select carry_out_customer_request($1::uuid, $2::uuid, 'test', 'operator') as r", [SHOP, req])).rows[0].r;
      // the tool's own cross-check, every table: nothing planned that was not erased, nothing erased that was not planned
      expect(sameCounts(plan.erased, done.erased)).toEqual([]);
      expect(plan.erased.get('advisor_turns')).toBe(2);
    } finally {
      await admin.query('rollback');
    }

    // The owner's own act, for real.
    const r = await as(OWNER, (q) => q('select erase_customer($1, $2) as r', [req, OWNER]));
    expect(r.rows[0].r.erased).toMatchObject({ advisor_turn_subjects: 3, advisor_turns: 2, advisor_threads: 1 });
    expect(await n('select count(*) as n from advisor_turns where id = $1', [both.turns[0]])).toBe(0);   // named her (and Bao): gone whole
    expect(await n('select count(*) as n from advisor_turns where id = $1', [both.turns[1]])).toBe(1);   // named only Bao: stays
    expect(await n('select count(*) as n from advisor_threads where id = $1', [only.thread])).toBe(0);    // left empty: gone
    expect(await n('select count(*) as n from advisor_threads where id = $1', [bao.thread])).toBe(1);
    expect(await n('select count(*) as n from advisor_turn_subjects where client_id = $1', [A])).toBe(0);
    const line = (await ledger("kind = 'customer' and customer_id = $2", [A])).rows[0];
    expect(line.counts.erased).toMatchObject({ advisor_turns: 2 });
  });

  it('a person removed from the team takes their history with them, with its ledger line', async () => {
    const theirs = await keep(OTHER_STAFF, [[C]]);
    await as(OWNER, (q) => q('update people set archived_at = now() where id = $1', [OTHER_STAFF]));
    expect(await n('select count(*) as n from advisor_threads where id = $1', [theirs.thread])).toBe(0);
    expect((await ledger("kind = 'advisor' and $2 = any(thread_ids)", [theirs.thread])).rows[0]).toMatchObject({ via: 'owner', by_who: 'team-removal' });
  });

  it('a restore that brought any of it back is put right: the ledger names what does not hold, the replay deletes it again', async () => {
    // What two deletions removed, brought back as a restored copy would hold it (the copy predates them).
    const back = await keep(OWNER, [[C]]);
    const forget = await as(OWNER, (q) => q('select advisor_forget($1, $2) as r', [OWNER, back.thread]));
    expect(forget.rows[0].r.erased.advisor_threads).toBe(1);
    await admin.query('set session_replication_role = replica');                          // a restore writes what was, triggers and all
    const t = seal('restored');
    await admin.query(`insert into advisor_threads (id, business_id, person_id, title_ciphertext, sealed_with) values ($1, $2, $3, $4, $5)`,
      [back.thread, SHOP, OWNER, t.ciphertext, t.sealedWith]);
    await admin.query('set session_replication_role = origin');
    const unkept = (await admin.query('select ledger_id::text as id, reason from erasure_ledger_unkept() where business_id = $1', [SHOP])).rows;
    expect(unkept.map((u) => u.reason)).toContain('an advisor conversation it deleted is still there');

    const lineRow = (await ledger("kind = 'advisor' and $2 = any(thread_ids)", [back.thread])).rows[0];
    const line = ledgerLine({ ...lineRow, thread_ids: lineRow.thread_ids });
    expect(parseLedgerLine(JSON.stringify(line)).ok).toBe(true);
    // The operator's tool, as the restore runbook runs it: a dry run changes nothing, --yes deletes it again.
    const dry = replay([]);
    expect(dry.code, dry.err).toBe(0);
    expect(dry.out).toMatch(new RegExp(`would erase +1 rows · 1 advisor conversation\\(s\\) of ${SHOP} · ledger ${lineRow.id}`));
    expect(await n('select count(*) as n from advisor_threads where id = $1', [back.thread])).toBe(1);
    const done = replay(['--yes', '--by', 'Restore Test']);
    expect(done.code, done.err).toBe(0);
    expect(done.out).toMatch(new RegExp(`erased +1 rows · 1 advisor conversation\\(s\\) of ${SHOP} · ledger ${lineRow.id}`));
    expect(await n('select count(*) as n from advisor_threads where id = $1', [back.thread])).toBe(0);
    expect((await admin.query('select * from erasure_ledger_unkept() where business_id = $1', [SHOP])).rows).toEqual([]);
  });

  it('the owner switching it off deletes everyone\'s history in the workspace, then keeps nothing', async () => {
    await keep(OWNER, [[]]);
    const before = await n('select count(*) as n from advisor_threads where business_id = $1', [SHOP]);
    expect(before).toBeGreaterThan(0);
    const r = await as(OWNER, (q) => q('select advisor_history_set(false) as r'));
    expect(r.rows[0].r.erased.advisor_threads).toBe(before);
    expect(await n('select count(*) as n from advisor_threads where business_id = $1', [SHOP])).toBe(0);
    await expect(keep(OWNER, [[]])).rejects.toMatchObject({ code: 'NE020' });
    expect((await ledger("kind = 'advisor' and person_id is null and via = 'owner'", [])).rows.length).toBeGreaterThan(0);
  });

  it('closing the workspace takes every advisor row with it', async () => {
    await as(OWNER, (q) => q('select advisor_history_set(true)'));
    await keep(OWNER, [[B]]);
    await admin.query('select erase_workspace_rows($1::uuid, false, false)', [SHOP]);
    for (const t of ['advisor_threads', 'advisor_turns', 'advisor_turn_subjects', 'advisor_consents']) {
      expect(await n(`select count(*) as n from ${t} where business_id = $1`, [SHOP]), t).toBe(0);
    }
  });
});
