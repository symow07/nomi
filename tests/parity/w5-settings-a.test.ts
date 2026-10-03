import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely';
import { registerWebApp, type WebDeps } from '../../src/api/web/app.js';
import { makeSessionCodec } from '../../src/api/web/session.js';

/**
 * THE WARMTH RUN, PHASE 9 — the fix wave, area settings-a (docs/UI-AUDIT.md §8).
 *
 * Routes are asked through the real app, with a database that answers every
 * question with nothing — except the rail's count, which says three customers
 * wait. Nothing is written; no Postgres is needed.
 */
const SECRET = 'x'.repeat(64);
const PILOT = 'de300000-0000-4000-8000-0000000000b1';
const OTHER = 'de300000-0000-4000-8000-0000000000c2';

/**
 * A database that answers the rail's count with 3; a question that is one row
 * of yes/no figures (setup's steps, the channels connected) with "no" for each;
 * and everything else with no rows.
 */
const answer = (q: string): unknown[] => {
  if (/ as waiting,/.test(q)) return [{ waiting: 3, blocked: 0, mine: 0, deletion: 0, channels: 1 }];
  if (/^\s*select\s+(exists\(|coalesce\(\(|\(exists)/.test(q)) return [Object.fromEntries([...q.matchAll(/\) as (\w+)/g)].map((m) => [m[1], false]))];
  return [];
};
const quietDb = (): Kysely<never> => new Kysely<never>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (d) => new PostgresIntrospector(d),
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createDriver: () => ({
      init: async () => {}, destroy: async () => {},
      acquireConnection: async () => ({
        executeQuery: async (q: CompiledQuery) => ({
          rows: answer(q.sql) as never[],
        }),
        // eslint-disable-next-line require-yield
        streamQuery: async function* () { return; },
      }),
      beginTransaction: async () => {}, commitTransaction: async () => {}, rollbackTransaction: async () => {},
      releaseConnection: async () => {},
    }),
  },
});

const appWith = (over: Partial<WebDeps> = {}) => {
  const a = Fastify({ logger: false });
  registerWebApp(a, {
    db: quietDb() as never, sessionSecret: SECRET, accessCode: 'let-me-in',
    businessId: PILOT, employeeName: 'Lily', avatar: '', provider: 'disabled',
    secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    ...over,
  });
  return a;
};
const cookieFor = (businessId: string) =>
  `yf_session=${makeSessionCodec(SECRET).sign({ businessId, exp: Date.now() + 3_600_000 })}`;
const HTML = { accept: 'text/html' };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

describe('w4-settings-a-24 · a form sent back keeps the rail: its waiting count and its live check', () => {
  it('the page drawn for a GET has them (the baseline the sent-back page must match)', async () => {
    const a = appWith();
    const r = await a.inject({ method: 'GET', url: '/app/settings/closures', headers: { ...HTML, cookie: cookieFor(PILOT) } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('data-rail="/app/live/rail?since=3"');
  });

  for (const [what, url, payload] of [
    ['a closure whose last day is before its first', '/app/settings/closures', 'label=Holiday&from=2026-12-20&to=2026-12-10'],
    ['a forbidden word of spaces only', '/app/settings/forbidden', 'term=%20%20%20'],
  ] as const) {
    it(`${what}: sent back with status 400, the rail still counts 3 and still asks`, async () => {
      const a = appWith();
      const r = await a.inject({ method: 'POST', url, payload, headers: { ...HTML, ...FORM, cookie: cookieFor(PILOT) } });
      expect(r.statusCode).toBe(400);
      expect(r.body).toContain('role="alert"');
      expect(r.body).toContain('data-rail="/app/live/rail?since=3"');
      expect(r.body).toMatch(/data-nav="inbox"[^>]*aria-label="[^"]*3/);
    });
  }
});

describe('V1-006 (the gallery) · the component gallery is no owner\'s page on a normal installation', () => {
  it('without the switch: no page, for the installation\'s own workspace too — the wrong-address page, in the workspace', async () => {
    const a = appWith();
    for (const who of [PILOT, OTHER]) {
      const r = await a.inject({ method: 'GET', url: '/app/settings/components', headers: { ...HTML, cookie: cookieFor(who) } });
      expect(r.statusCode, who).toBe(404);
      expect(r.body, who).not.toContain('Rest');
    }
  });
  it('with the switch (a local instance, COMPONENT_GALLERY=on): the screenshots tool still walks it, as the installation\'s workspace only', async () => {
    const a = appWith({ componentGallery: true });
    const own = await a.inject({ method: 'GET', url: '/app/settings/components', headers: { ...HTML, cookie: cookieFor(PILOT) } });
    expect(own.statusCode).toBe(200);
    expect(own.body).toContain('<h1 class="page">');
    expect((await a.inject({ method: 'GET', url: '/app/settings/components', headers: { ...HTML, cookie: cookieFor(OTHER) } })).statusCode).toBe(404);
  });
  it('the switch is read from the environment by name, documented, and set only by the local smoke script', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    expect(read('src/main.ts')).toContain("componentGallery: process.env['COMPONENT_GALLERY'] === 'on',");
    expect(read('.claude/skills/run-nomi/smoke.sh')).toContain('COMPONENT_GALLERY=on');
    expect(read('docs/env-checklist.md')).toContain('| `COMPONENT_GALLERY` |');
  });
});
