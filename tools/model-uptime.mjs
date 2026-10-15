#!/usr/bin/env node
/**
 * 0166 — HOW RELIABLE EACH MODEL PROVIDER WAS (the owner, 2026-10-15: "If DeepSeek is still unreliable in 48 hours,
 * the fallback becomes the primary and we re-measure properly. Tell me when we hit that mark.")
 *
 *   DATABASE_URL=<url> node tools/model-uptime.mjs [--hours 48]
 *
 * Reads the five-minute checks (`model_check_log`, kept thirty days) — never a real call, never a workspace — and
 * prints, per provider and model over the window: how many checks, the share answering / slow / not answering, the
 * median latency of the ones that answered, the longest run of not answering, and why. Read only.
 *
 * Exit 0 printed · 1 failed · 2 bad usage.
 */
import { pathToFileURL } from 'node:url';

/** The rows of one provider and model, oldest first, into the figures the report prints. Pure; the test reads it. */
export function uptime(rows, checkEveryMs = 5 * 60_000) {
  const n = rows.length;
  const count = (s) => rows.filter((r) => r.state === s).length;
  const answered = rows.filter((r) => r.state !== 'not_answering' && r.ms !== null).map((r) => r.ms).sort((a, b) => a - b);
  const median = answered.length ? answered[Math.floor((answered.length - 1) / 2)] : null;
  let longest = 0; let run = 0; let runStart = null; let longestFrom = null;
  for (const r of rows) {
    if (r.state === 'not_answering') {
      if (run === 0) runStart = r.at;
      run += 1;
      if (run > longest) { longest = run; longestFrom = runStart; }
    } else run = 0;
  }
  const reasons = {};
  for (const r of rows) if (r.state === 'not_answering') reasons[r.reason ?? 'unknown'] = (reasons[r.reason ?? 'unknown'] ?? 0) + 1;
  const pct = (k) => (n ? Math.round((1000 * k) / n) / 10 : 0);
  return {
    checks: n, first: rows[0]?.at ?? null, last: rows[n - 1]?.at ?? null,
    answering: pct(count('answering')), slow: pct(count('slow')), notAnswering: pct(count('not_answering')),
    medianMs: median, longestOutageMinutes: Math.round((longest * checkEveryMs) / 60_000), longestOutageFrom: longestFrom, reasons,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--hours');
  const hours = i >= 0 ? Number(argv[i + 1]) : 48;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) { console.error('\n  --hours must be between 1 and 720.\n'); process.exit(2); }
  const url = process.env.DATABASE_URL ?? process.env.MIGRATE_DATABASE_URL;
  if (!url) { console.error('\n  DATABASE_URL is required (read only).\n'); process.exit(2); }
  const { toolClient } = await import('./lib/db.mjs');
  const client = toolClient(url, { replyTimeoutMs: 60_000 });
  await client.connect().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
  try {
    await client.query('begin transaction read only');
    const rows = (await client.query(
      `select role, provider, model, state, ms, reason, at from model_check_log
        where at >= now() - make_interval(hours => $1::int) order by role, provider, model, at`, [Math.round(hours)])).rows;
    await client.query('rollback');
    const groups = new Map();
    for (const r of rows) {
      const k = `${r.role} · ${r.provider} · ${r.model}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    console.log(`\n  Model checks, the last ${hours} h (every five minutes; ${rows.length} in all)\n`);
    if (groups.size === 0) console.log('  None recorded in this window.\n');
    for (const [k, rs] of groups) {
      const u = uptime(rs);
      const iso = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');
      console.log(`  ${k}`);
      console.log(`    ${u.checks} checks, ${iso(u.first)} → ${iso(u.last)} UTC`);
      console.log(`    answering ${u.answering}% · slow ${u.slow}% · not answering ${u.notAnswering}%`);
      console.log(`    median latency ${u.medianMs === null ? '—' : `${u.medianMs} ms`}`);
      console.log(`    longest outage ${u.longestOutageMinutes} min${u.longestOutageFrom ? ` (from ${iso(u.longestOutageFrom)} UTC)` : ''}`);
      const why = Object.entries(u.reasons).map(([r, c]) => `${r} ×${c}`).join(', ');
      if (why) console.log(`    why: ${why}`);
      console.log('');
    }
  } catch (e) {
    console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}
