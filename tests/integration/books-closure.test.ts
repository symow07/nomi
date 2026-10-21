import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { asTenant, purgeBusinesses, type Q } from './books-db.js';

/**
 * A2.4 (Phase 5, 0172) — a closing workspace keeps its books, and its owner leaves with them FIRST (the owner,
 * 2026-10-22). Run through the production paths: the owner's `closeWorkspace` (close_workspace), the books file
 * route's maker (`makeBooksFile`), the operator's erasure under a request, and tools/books-retention.mjs.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const BOOKS = `a2a40000-0000-4000-8000-${RUN}0001`;   // posts entries, then closes
const PLAIN = `a2a40000-0000-4000-8000-${RUN}0002`;   // a fiscal year and a draft, nothing posted
const OWNER = `a2a40000-0000-4000-8000-${RUN}00aa`;
const PLAIN_OWNER = `a2a40000-0000-4000-8000-${RUN}00ab`;

d('A2.4 · closing with books: kept until the legal date, downloaded first (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let app: pg.Client;
  let db: import('../../src/db/client.js').Db;
  let erasure: typeof import('../../src/api/web/erasure.js');
  let books: typeof import('../../src/db/booksExport.js');
  const as = <T>(b: string, fn: (q: Q) => Promise<T>) => asTenant(app, b, fn);

  const setUp = async (biz: string, owner: string, post: boolean) => {
    await admin.query(`insert into businesses (id, name, engine, country, currency) values ($1, $2, 'service', 'MA', 'MAD')`, [biz, `Closure ${biz.slice(-4)} ${RUN}`]);
    await admin.query(`insert into people (id, business_id, name, is_owner) values ($1, $2, 'Mei', true)`, [owner, biz]);
    await admin.query(`insert into clients (business_id, phone, display_name) values ($1, $2, 'A buyer')`, [biz, `+2126${RUN.replace(/\D/g, '1').slice(0, 7)}${biz.slice(-1)}`]);
    await as(biz, async (q) => {
      const acc = async (code: string, kind: string) => (await q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), $1, $1, $2) returning id::text as id`, [code, kind])).rows[0].id as string;
      const bank = await acc('5141', 'asset'); const sales = await acc('7111', 'income');
      const vt = (await q(`insert into journals (business_id, code, name, kind) values (current_business_id(), 'VT', 'Ventes', 'sales') returning id::text as id`)).rows[0].id;
      const fy = (await q(`insert into fiscal_years (business_id, starts_on, ends_on) values (current_business_id(), '2026-01-01', '2026-12-31') returning id::text as id`)).rows[0].id;
      const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, '2026-03-01', 'Facture 1', 'mei') returning id::text as id`, [vt, fy])).rows[0].id;
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit) values (current_business_id(), $1, 1, $2, 'MAD', 1200.50)`, [e, bank]);
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, credit) values (current_business_id(), $1, 2, $2, 'MAD', 1200.50)`, [e, sales]);
      if (post) await q(`update journal_entries set state = 'posted', posted_by = 'mei', document_ref = 'F-1', document_date = entry_date where id = $1`, [e]);
    });
  };
  const close = (biz: string, owner: string) => erasure.closeWorkspace(db, biz, `Closure ${biz.slice(-4)} ${RUN}`, owner);
  const one = async (sql: string, v: unknown[] = []) => (await admin.query(sql, v)).rows[0];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await app.connect();
    const { createDb } = await import('../../src/db/client.js');
    db = createDb(DATABASE_URL!);
    erasure = await import('../../src/api/web/erasure.js');
    books = await import('../../src/db/booksExport.js');
    await setUp(BOOKS, OWNER, true);
    await setUp(PLAIN, PLAIN_OWNER, false);
  });
  afterAll(async () => {
    await purgeBusinesses(admin, [BOOKS, PLAIN], 'books-closure-test').catch(() => {});
    await db?.destroy();
    await app.end();
    await admin.end();
  });

  it('closing is REFUSED until the owner has downloaded the books — and nothing at all is erased', async () => {
    expect(await close(BOOKS, OWNER)).toEqual({ outcome: 'books_first' });
    expect(await one(`select is_active, books_held_until from businesses where id = $1`, [BOOKS])).toEqual({ is_active: true, books_held_until: null });
    expect((await one(`select count(*)::int as n from clients where business_id = $1`, [BOOKS])).n).toBe(1);
  });

  it('the copy is every posted line, exact, with its receipt; a posting after it makes it old again', async () => {
    const file = await books.makeBooksFile(db, BOOKS, OWNER, { sep: ',', decimal: '.' });
    expect(file).not.toBeNull();
    const lines = file!.csv.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines[0]).toBe('Code_Journal,Libelle_Journal,Num_Ecriture,Date_Ecriture,Num_Compte,Libelle_Compte,Num_Compte_Aux,Libelle_Compte_Aux,Ref_Piece,Date_Piece,Libelle_Ecriture,Montant_Debit,Montant_Credit,Lettrage_Ecriture,Date_Lettrage,Date_Validation,Montant_Devise,Id_devise,Exercice,Champs_Personnalises');
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 13).join(','))).toEqual([
      'VT,Ventes,1,2026-03-01,5141,5141,,,F-1,2026-03-01,Facture 1,1200.50,0.00',
      'VT,Ventes,1,2026-03-01,7111,7111,,,F-1,2026-03-01,Facture 1,0.00,1200.50',
    ]);
    expect(file).toMatchObject({ entries: 1, lines: 2 });
    expect(file!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const receipt = await as(BOOKS, async (q) => (await q(`select made_by, entries, lines, sha256 from books_exports order by made_at desc limit 1`)).rows[0]);
    expect(receipt).toEqual({ made_by: OWNER, entries: 1, lines: 2, sha256: file!.sha256 });
    // what the data page reads: books there, kept until the legal date under the country's law, the copy covering all
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BOOKS); if (!bid.ok) throw new Error('fixture');
    const holding = await withTenantTx(db, bid.value, (tx) => books.booksHoldingTx(tx, BOOKS));
    expect(holding).toMatchObject({ hasBooks: true, copyCoversAll: true, law: 'Code Général des Impôts, art. 211: dix (10) ans' });
    expect(holding.keepUntil?.toISOString().slice(0, 10)).toBe('2036-12-31');
    // a posting after the copy makes the copy old: closing waits for a new one
    await as(BOOKS, async (q) => {
      const ids = (await q(`select (select id::text from journals) as vt, (select id::text from fiscal_years) as fy,
        (select id::text from accounts where code = '5141') as bank, (select id::text from accounts where code = '7111') as sales`)).rows[0];
      const e = (await q(`insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values (current_business_id(), $1, $2, '2026-03-02', 'Facture 2', 'mei') returning id::text as id`, [ids.vt, ids.fy])).rows[0].id;
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit) values (current_business_id(), $1, 1, $2, 'MAD', 10)`, [e, ids.bank]);
      await q(`insert into journal_lines (business_id, entry_id, line_no, account_id, currency, credit) values (current_business_id(), $1, 2, $2, 'MAD', 10)`, [e, ids.sales]);
      await q(`update journal_entries set state = 'posted', posted_by = 'mei', document_ref = 'F-2', document_date = entry_date where id = $1`, [e]);
    });
    expect((await withTenantTx(db, bid.value, (tx) => books.booksHoldingTx(tx, BOOKS))).copyCoversAll).toBe(false);
    expect(await close(BOOKS, OWNER)).toEqual({ outcome: 'books_first' });
    expect(await books.makeBooksFile(db, BOOKS, OWNER, { sep: ',', decimal: '.' })).toMatchObject({ entries: 2, lines: 4 });
    expect((await withTenantTx(db, bid.value, (tx) => books.booksHoldingTx(tx, BOOKS))).copyCoversAll).toBe(true);
  });

  it('with the copy, closing finishes: everything else is erased, the books are HELD until the legal date, switched off', async () => {
    const r = await close(BOOKS, OWNER);
    expect(r.outcome).toBe('closed');
    const biz = await one(`select is_active, books_held_until::text as until, books_closed_at is not null as closed from businesses where id = $1`, [BOOKS]);
    // Morocco: ten years (CGI art. 211), from the end of the fiscal year — the later reading.
    expect(biz).toEqual({ is_active: false, until: '2036-12-31', closed: true });
    expect((await one(`select count(*)::int as n from clients where business_id = $1`, [BOOKS])).n).toBe(0);
    expect((await one(`select count(*)::int as n from people where business_id = $1`, [BOOKS])).n).toBe(0);
    expect((await one(`select count(*)::int as n from journal_entries where business_id = $1 and state = 'posted'`, [BOOKS])).n).toBe(2);
    expect((await one(`select count(*)::int as n from journal_lines where business_id = $1`, [BOOKS])).n).toBe(4);
    expect((await one(`select count(*)::int as n from books_exports where business_id = $1`, [BOOKS])).n).toBe(2);
    // the restore drill's check knows a held workspace is an erasure that holds
    expect((await admin.query(`select * from erasure_ledger_unkept() where business_id = $1`, [BOOKS])).rows).toEqual([]);
  });

  it('a workspace with nothing posted closes as before, drafts and all — nothing is held', async () => {
    const r = await close(PLAIN, PLAIN_OWNER);
    expect(r.outcome).toBe('closed');
    expect((await one(`select count(*)::int as n from businesses where id = $1`, [PLAIN])).n).toBe(0);
    expect((await one(`select count(*)::int as n from journal_entries where business_id = $1`, [PLAIN])).n).toBe(0);
  });

  it('the books are erased when the law no longer needs them — by the operator\'s tool, and not a day early', async () => {
    const run = (extra: string[]) => spawnSync(process.execPath, ['tools/books-retention.mjs', ...extra], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN_URL ?? '' } });
    const early = run(['--yes', '--by', 'test']);
    expect(early.stdout).not.toContain(BOOKS);
    expect((await one(`select count(*)::int as n from businesses where id = $1`, [BOOKS])).n).toBe(1);
    await admin.query(`update businesses set books_held_until = current_date - 1 where id = $1`, [BOOKS]);
    const dry = run([]);
    expect(dry.stdout).toContain(`${BOOKS}): held until`);
    expect(dry.stdout).toContain('a dry run: nothing was changed');
    expect((await one(`select count(*)::int as n from businesses where id = $1`, [BOOKS])).n).toBe(1);
    expect(run(['--yes']).status).toBe(2);   // who erases is said, or nothing happens
    const done = run(['--yes', '--by', 'books-closure-test']);
    expect(done.status, done.stderr).toBe(0);
    expect(done.stdout).toContain('erased');
    expect((await one(`select count(*)::int as n from businesses where id = $1`, [BOOKS])).n).toBe(0);
    expect((await one(`select count(*)::int as n from journal_lines where business_id = $1`, [BOOKS])).n).toBe(0);
    expect(await one(`select via, by_who from erasure_ledger where business_id = $1 order by at desc limit 1`, [BOOKS]))
      .toEqual({ via: 'operator', by_who: 'books-closure-test' });
  });
});
