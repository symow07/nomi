#!/usr/bin/env node
/**
 * C0 — WHAT A REAL ODOO ANSWERS, for the two answers B4 could not take from Odoo's documentation or source: a Free or
 * Standard plan's refusal, checked against the owner's own Odoo Online trial. Run by the OWNER, in their own shell;
 * Nomi never sees the key.
 *
 *   ODOO_URL=https://<yours>.odoo.com ODOO_DB=<the name Odoo shows at sign-in> ODOO_KEY=<a key made in Odoo> \
 *     node tools/odoo-probe.mjs
 *
 * Three calls of JSON-2's probe (POST /json/2/res.users/context_get), exactly as the connector makes it
 * (src/books/connectors/odoo.ts): as given; with a database name nobody has; with a key nobody made. It prints, for
 * each, the HTTP status, the content type, and Odoo's error name — never the key, never a body beyond its first
 * 120 characters, and never the answer of a call that worked (it would be the account's context).
 */
const url = process.env['ODOO_URL']?.trim().replace(/\/$/, '');
const db = process.env['ODOO_DB']?.trim();
const key = process.env['ODOO_KEY']?.trim();
if (process.argv.length > 2) { console.error('\n✗  Nothing on the command line: give ODOO_URL, ODOO_DB and ODOO_KEY in the environment.\n'); process.exit(2); }
if (!url || !/^https:\/\//.test(url) || !db || !key) { console.error('\n✗  Set ODOO_URL (https://…), ODOO_DB and ODOO_KEY in the environment.\n'); process.exit(2); }

const call = async (label, database, bearer) => {
  try {
    const res = await fetch(`${url}/json/2/res.users/context_get`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `bearer ${bearer}`, 'content-type': 'application/json; charset=utf-8', 'x-odoo-database': database, 'user-agent': 'Nomi probe' },
      body: '{}',
    });
    const text = await res.text();
    let name = '';
    try { name = String(JSON.parse(text)?.name ?? ''); } catch { /* not JSON */ }
    const shown = res.status === 200 ? '(an answer: not printed)' : JSON.stringify(text.slice(0, 120));
    console.log(`  ${label.padEnd(22)} ${res.status}  ${res.headers.get('content-type') ?? ''}  ${name || '—'}\n  ${''.padEnd(22)} ${shown}`);
  } catch (e) {
    console.log(`  ${label.padEnd(22)} no answer (${e instanceof Error ? e.name : 'error'})`);
  }
};

console.log(`\nOdoo at ${url}\n`);
await call('as given', db, key);
await call('a database nobody has', `nomi-probe-${Date.now()}`, key);
await call('a key nobody made', db, `nomi-probe-${Date.now()}`);
console.log('\n  Paste these lines back to Nomi\'s session (they hold no key).\n');
