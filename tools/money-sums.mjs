#!/usr/bin/env node
/**
 * A1 (Phase 5) — every stored amount, summed exactly, per table, per column, per workspace: the before-and-after
 * check for the deploy that carries A1 (docs/A1-EXACT-MONEY.md).
 *
 * A1 rewrites no stored value — Postgres `numeric` was always exact; the floating point was in the code between
 * storage and the quote — so the sums taken before the deploy and after it must be IDENTICAL, to the last digit. A
 * difference means something wrote money during the deploy, or a migration touched what it should not have.
 *
 *   MIGRATE_DATABASE_URL=<admin url> node tools/money-sums.mjs > before.tsv
 *   … deploy …
 *   MIGRATE_DATABASE_URL=<admin url> node tools/money-sums.mjs > after.tsv
 *   node tools/money-sums.mjs --compare before.tsv after.tsv      # exit 0 identical, 1 different
 *
 * Which columns: every `numeric` column of the public schema (amounts, rates, percentages — a percentage that moved
 * is as wrong as a price that did). Grouped by `business_id` where the table has one, else one line for the table.
 * Sums are `sum(col)::text`, so nothing passes through a float, and the row count rides with each sum.
 *
 * Read-only: one `begin read only` transaction, repeatable read, so every sum is of the same moment. Refuses a role
 * that row security filters — a filtered sum would be a quietly wrong one.
 *
 * The connection URL comes from the environment only (tests/parity/no-secret-in-argv.test.ts).
 */
import { readFileSync } from 'node:fs';
import { toolClient } from './lib/db.mjs';

const args = process.argv.slice(2);

function readTsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
  return new Map(lines.map((l) => { const [k1, k2, k3, sum, n] = l.split('\t'); return [`${k1}\t${k2}\t${k3}`, `${sum}\t${n}`]; }));
}

if (args[0] === '--compare') {
  if (args.length !== 3) { console.error('usage: node tools/money-sums.mjs --compare <before.tsv> <after.tsv>'); process.exit(2); }
  const [a, b] = [readTsv(args[1]), readTsv(args[2])];
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const diff = keys.filter((k) => a.get(k) !== b.get(k));
  for (const k of diff) console.log(`${k}\tbefore ${a.get(k) ?? '(none)'}\tafter ${b.get(k) ?? '(none)'}`);
  console.error(diff.length === 0 ? `money-sums: identical — ${keys.length} sums` : `money-sums: ${diff.length} of ${keys.length} sums DIFFER`);
  process.exit(diff.length === 0 ? 0 : 1);
}
if (args.length > 0) { console.error('usage: node tools/money-sums.mjs   (or --compare <before> <after>)'); process.exit(2); }

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) { console.error('money-sums: MIGRATE_DATABASE_URL is not set (the admin role; row security must not filter it)'); process.exit(2); }

const ident = (s) => `"${s.replace(/"/g, '""')}"`;
const client = toolClient(url, { replyTimeoutMs: 120_000 });
await client.connect();
try {
  await client.query('begin transaction isolation level repeatable read read only');
  const role = (await client.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user')).rows[0];
  if (!role || !(role.rolsuper || role.rolbypassrls)) {
    throw new Error('money-sums: this role is filtered by row security — its sums would leave rows out. Use the admin role.');
  }
  const cols = (await client.query(`
    select c.table_name as t, c.column_name as col,
           exists (select 1 from information_schema.columns b
                    where b.table_schema = 'public' and b.table_name = c.table_name and b.column_name = 'business_id') as by_business
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public' and c.data_type = 'numeric' and tb.table_type = 'BASE TABLE'
     order by 1, 2`)).rows;
  console.log('# table\tcolumn\tworkspace\tsum\trows');
  for (const { t, col, by_business } of cols) {
    const q = by_business
      ? `select business_id::text as k, coalesce(sum(${ident(col)}), 0)::text as s, count(${ident(col)})::text as n
           from ${ident(t)} group by business_id order by 1 nulls first`
      : `select '-' as k, coalesce(sum(${ident(col)}), 0)::text as s, count(${ident(col)})::text as n from ${ident(t)}`;
    for (const r of (await client.query(q)).rows) console.log(`${t}\t${col}\t${r.k ?? '(none)'}\t${r.s}\t${r.n}`);
  }
  await client.query('commit');
  console.error(`money-sums: ${cols.length} numeric columns read`);
} finally {
  await client.end().catch(() => {});
}
