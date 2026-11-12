import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * The authorization audit (Block 7) — A BANK MATCH POINTS ONLY AT THE WORKSPACE'S OWN JOURNAL LINE.
 *
 * `POST /app/books/bank/match` takes the journal line's id from the form. `statement_matches.journal_line_id` is a
 * single-column key, and a key's check looks past row security; the rule trigger (`statement_matches_rules`) runs as the
 * caller, so another workspace's journal line was invisible to it — every comparison it made was with null, none
 * raised, and the match was written. Workspace A's statement line then held a live match on workspace B's journal
 * line, and B's own match of that line was refused by the one-match-per-line index (B could not see why).
 *
 * 0241 makes the rule read the line in the match's own workspace and refuse one it does not find. Here: A's owner,
 * through the route, with B's journal line — refused, no row anywhere names B's line, and B still matches it itself;
 * as admin (no row security) the same row is refused by the database; A's own match still works.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const A = `a0741000-0000-4000-8000-${RUN}0001`;
const B = `a0741000-0000-4000-8000-${RUN}0002`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const ofx = (tag: string) => `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>MAD<BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260420<TRNAMT>1440.60<FITID>AZ-${tag}-${RUN}-1<NAME>VIR ATLAS TEXTILES</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

type Books = { bank: string; inLine: string };

d('Authorization audit · a bank match names only its own workspace\'s journal line (0241; requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let tenant: pg.Client;
  let db: import('../../src/db/client.js').Db;
  const apps: import('fastify').FastifyInstance[] = [];
  const owner: Record<'A' | 'B', { app: import('fastify').FastifyInstance; cookie: string }> = {} as never;
  const books: Record<'A' | 'B', Books> = {} as never;

  const seedBooks = (biz: string) => asTenant(tenant, biz, async (q: Q) => {
    const one = async (s: string, v: unknown[] = []) => (await q(s, v)).rows[0].id as string;
    const acc = (code: string, kind: string) => one(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind]);
    const bank = await acc('5141', 'asset'); const receivable = await acc('3421', 'asset');
    const bq = await one(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'BQ', 'Banque', 'bank') returning id::text as id`);
    const fy = await one(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`);
    const e = await one(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, '2026-04-19', 'Encaissement', 'owner') returning id::text as id`, [bq, fy]);
    const inLine = await one(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, 1, $2, 'MAD', 1440.60, 0) returning id::text as id`, [e, bank]);
    await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values (current_business_id(), $1, 2, $2, 'MAD', 0, 1440.60)`, [e, receivable]);
    await q(`update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-1', document_date = entry_date where id = $1`, [e]);
    return { bank, inLine };
  });
  const session = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
  const post = (who: 'A' | 'B', url: string, body: Record<string, string>) =>
    owner[who].app.inject({ method: 'POST', url, payload: new URLSearchParams(body).toString(), headers: { cookie: owner[who].cookie, ...FORM } });
  const notice = async (who: 'A' | 'B', r: { headers: Record<string, unknown> }) => {
    const set = ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).join('; ');
    return (await owner[who].app.inject({ method: 'GET', url: String(r.headers['location']), headers: { cookie: `${owner[who].cookie}; ${set}` } })).body;
  };
  const upload = (who: 'A' | 'B') => {
    const boundary = `----nomi${RUN}`;
    return owner[who].app.inject({ method: 'POST', url: `/app/books/bank/import?account=${books[who].bank}`,
      headers: { cookie: owner[who].cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="statement"; filename="s.ofx"\r\nContent-Type: application/octet-stream\r\n\r\n${ofx(who)}\r\n--${boundary}--\r\n` });
  };
  const statementLine = (who: 'A' | 'B') => asTenant(tenant, who === 'A' ? A : B, async (q) =>
    (await q(`select id::text as id from statement_lines where amount = 1440.60`)).rows[0].id as string);
  const matchesOn = async (journalLine: string) =>
    (await admin.query(`select business_id::text as b from statement_matches where journal_line_id = $1 and unmatched_at is null`, [journalLine])).rows.map((r) => r.b as string);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    tenant = new pg.Client({ connectionString: DATABASE_URL }); await tenant.connect();
    for (const [biz, tag] of [[A, 'A'], [B, 'B']] as const) {
      await admin.query(`insert into businesses (id, name, engine, country, currency, books_area) values ($1, $2, 'service', 'MA', 'MAD', true)`, [biz, `Authz bank ${tag} ${RUN}`]);
      books[tag] = await seedBooks(biz);
    }
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    for (const [biz, tag] of [[A, 'A'], [B, 'B']] as const) {
      const app = Fastify({ logger: false });
      registerWebApp(app, {
        db, businessId: biz, accessCode: `authz-bank-${tag}-${RUN}`, sessionSecret: SECRET, factsTtlMs: 0,
        employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
        kickOutbound: async () => {}, kickDrive: async () => {},
      } as unknown as Parameters<typeof registerWebApp>[1]);
      await app.ready();
      apps.push(app);
      const cookie = session(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(`authz-bank-${tag}-${RUN}`)}`, headers: FORM }));
      expect(cookie, tag).not.toBe('');
      owner[tag] = { app, cookie };
      expect(await notice(tag, await upload(tag))).toContain('Read in: 1 new lines');
    }
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await db?.destroy(); await tenant?.end();
    await purgeBusinesses(admin, [A, B], 'authz-bank-match-test'); await admin?.end();
  });

  it('A\'s owner, through the route, with B\'s journal line: refused, and nothing anywhere names B\'s line', async () => {
    const said = await notice('A', await post('A', '/app/books/bank/match', { account: books.A.bank, line: await statementLine('A'), journalLine: books.B.inLine }));
    expect(said).toContain('That match could not be made');
    expect(said).not.toContain('Matched.');
    expect(await matchesOn(books.B.inLine)).toEqual([]);
    expect((await admin.query(`select count(*)::int as n from statement_matches where business_id = $1`, [A])).rows[0].n).toBe(0);
  });

  it('as admin, past row security, the database refuses the same row', async () => {
    const line = await statementLine('A');
    const err = await admin.query(`insert into statement_matches (business_id, statement_line_id, journal_line_id, matched_by) values ($1, $2, $3, 'owner')`, [A, line, books.B.inLine])
      .then(() => null, (e: { code?: string }) => e.code ?? 'error');
    expect(err).not.toBeNull();
    expect(await matchesOn(books.B.inLine)).toEqual([]);
  });

  it('B still matches its own line, and A its own: the rule is unchanged for a workspace\'s own rows', async () => {
    expect(await notice('B', await post('B', '/app/books/bank/match', { account: books.B.bank, line: await statementLine('B'), journalLine: books.B.inLine }))).toContain('Matched.');
    expect(await matchesOn(books.B.inLine)).toEqual([B]);
    expect(await notice('A', await post('A', '/app/books/bank/match', { account: books.A.bank, line: await statementLine('A'), journalLine: books.A.inLine }))).toContain('Matched.');
    expect(await matchesOn(books.A.inLine)).toEqual([A]);
  });
});
