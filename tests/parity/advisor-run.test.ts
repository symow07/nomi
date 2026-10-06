import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { renderEmployee, screenHref, EMPLOYEE_SCREENS, aloneInForce, type EmployeeProfile } from '../../src/api/web/employee.js';
import { renderSettingsHome } from '../../src/api/web/settings.js';
import { renderAdvisor, advisorRoutes, ADVISOR_MAX, type AdvisorIO } from '../../src/api/web/advisor.js';
import { ASSISTANT_HOME, NAV, esc } from '../../src/api/web/layout.js';
import { agentMark } from '../../src/api/web/agentMark.js';
import { t, withAssistantName, withWorkspace } from '../../src/api/web/say.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { modesFor } from '../../src/core/conversation/autonomyLevel.js';
import { messages } from '../../src/core/owner/i18n/messages.js';

/**
 * THE ADVISOR RUN (2026-10-06). The owner:
 *   SHIP 1 — "The current assistant page … is really configuration … Move ALL of it into Settings, as nested
 *   rows in the iPhone/Instagram pattern we already use. The 'how much it does alone' control keeps its
 *   prominence. Nothing is lost; it all moves one level into Settings."
 *   SHIP 2 — "In the freed nav slot, put a chat page for the advisor … a SHELL … NOT answer real questions
 *   yet, NOT read customer data yet … available to whoever is logged in (account-holder), never to
 *   customers; read-only by design — no tool, button, or path from this page can send a message, change a
 *   price, or alter any setting. Wall it off at the code level, not just the UI."
 */

const gate = vi.hoisted(() => ({ released: null as boolean | null }));
vi.mock('../../src/core/conversation/disclosure.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/conversation/disclosure.js')>();
  return { ...real, autonomyReleased: () => gate.released ?? real.autonomyReleased() };
});
afterEach(() => { gate.released = null; });

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const waits: EmployeeProfile = {
  knows: 14, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-07-09T00:00:00Z'), stage: 'partial',
  canDo: [], needConfirm: ['greet', 'quote'],
  capabilities: Object.entries(modesFor('waits')).map(([capability, mode]) => ({ capability, mode, promotable: false })),
  growth: [], promoted: false, conditions: [], products: 24, words: 3,
};
const talks: EmployeeProfile = {
  ...waits, capabilities: Object.entries(modesFor('talks')).map(([capability, mode]) => ({ capability, mode, promotable: false })),
};
const scope = { name: 'Lily', several: false, outreach: false, setup: null } as const;

describe('ship 1 · the assistant\'s page is Settings\' first row, whole, one level in', () => {
  it('its address is under Settings, and every screen under it', () => {
    expect(ASSISTANT_HOME).toBe('/app/settings/assistant');
    for (const s of EMPLOYEE_SCREENS) expect(screenHref(s)).toBe(`${ASSISTANT_HOME}/${s}`);
  });

  for (const l of LOCALES) {
    it(`${l} · Settings opens on the assistant: its own slot, its name, and how much it does alone as it stands — then My business and Setup`, () => {
      const html = withWorkspace(scope, () => renderSettingsHome(l, null, { alone: 'IN-FORCE' }));
      const rows = [...html.matchAll(/<li><a class="srow[^"]*" href="([^"]+)">/g)].map((m) => m[1]);
      expect(rows.slice(0, 3), l).toEqual([ASSISTANT_HOME, '/app/business', '/app/settings/setup']);
      expect(html, l).toContain(`<a class="srow sr-menu sr-two" href="${ASSISTANT_HOME}">${agentMark(24, 'ni')}<span class="sr-main"><span class="sr-label">Lily</span><span class="sr-desc">IN-FORCE</span></span>`);
    });

    it(`${l} · the row's line is the control's own reading: the level in force — or, held, what is in force`, () => {
      gate.released = true;
      expect(withAssistantName('Lily', () => aloneInForce(talks, l)), l).toBe(withAssistantName('Lily', () => t(l, 'autonomy.level.talks')));
      expect(withAssistantName('Lily', () => aloneInForce(waits, l)), l).toBe(withAssistantName('Lily', () => t(l, 'autonomy.level.waits')));
      // the native read not done: talks is set, nothing goes alone — the row says what IS (every reply waits)
      gate.released = false;
      expect(withAssistantName('Lily', () => aloneInForce(talks, l)), l).toBe(withAssistantName('Lily', () => t(l, 'autonomy.level.waits')));
    });

    it(`${l} · nothing lost: the landing opens on the control, whole, then the same menu, every row a door under its new address`, () => {
      gate.released = true;
      const html = withAssistantName('Lily', () => renderEmployee(talks, l, null));
      const control = html.indexOf('<section class="block level-control" id="on-her-own">');
      expect(control, l).toBeGreaterThan(0);
      expect(control, l).toBeLessThan(html.indexOf('class="sgroup"'));
      expect(html, l).toContain(`<form method="post" action="${ASSISTANT_HOME}/autonomy" class="levels">`);
      const doors = [...html.matchAll(/<a class="srow sr-menu(?: sr-two)?" href="([^"]+)">/g)].map((m) => m[1]);
      expect(doors, l).toEqual([
        screenHref('talk'), '/app/knowledge', screenHref('learning'), '/app/settings/forbidden',
        screenHref('name'), screenHref('replies'), screenHref('one-kind'), '/app/sandbox',
        screenHref('month'), screenHref('next'), screenHref('history'),
      ]);
    });
  }

  it('no page links to the old address: it lives only in the three routes that send it on', () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          if (/^\s*(\*|\/\/)/.test(line) || !line.includes('/app/employee')) return;
          found.push(`${relative(ROOT, p)}:${i + 1}: ${line.trim()}`);
        });
      }
    };
    walk(join(ROOT, 'src'));
    expect(found.map((x) => x.replace(/:\d+:/, ':'))).toEqual([
      "src/api/web/app.ts: app.get('/app/employee', async (req, reply) => sessionOf(req) ? reply.redirect(ASSISTANT_HOME, 302) : reply.redirect('/login'));",
      "src/api/web/app.ts: app.get('/app/employee/*', async (req, reply) => !sessionOf(req) ? reply.redirect('/login')",
      "src/api/web/app.ts: app.post('/app/employee/*', async (req, reply) => !sessionOf(req) ? reply.redirect('/login')",
    ]);
    // a page is sent on, the rest of its address kept; a form goes on as itself, its method and fields kept
    const app = read('src/api/web/app.ts');
    expect(app).toContain("reply.redirect(`${ASSISTANT_HOME}/${(req.params as { '*': string })['*']}`, 302));");
    expect(app).toContain("reply.redirect(`${ASSISTANT_HOME}/${(req.params as { '*': string })['*']}`, 308));");
  });
});

/** The VALUE imports a module reaches, transitively (a type-only import is erased by the compiler). */
function reached(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [resolve(ROOT, entry)];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    const specs = [
      ...[...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'";]*?from\s*['"](\.[^'"]+)['"]/gm)].map((m) => m[1]!),
      ...[...src.matchAll(/^\s*import\s+['"](\.[^'"]+)['"]/gm)].map((m) => m[1]!),
      ...[...src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((m) => m[1]!),
    ];
    for (const s of specs) {
      const ts = resolve(dirname(f), s).replace(/\.js$/, '.ts');
      if (existsSync(ts)) stack.push(ts);
    }
  }
  return [...seen].map((f) => relative(ROOT, f)).sort();
}
/** What the advisor may never reach: the database, sending, the queue, a model, the pipeline, pricing, settings that save, the app's own routes. */
const FORBIDDEN = /^src\/(db|pipeline|outbound|channels|queue|llm|conversations|worker|ops|billing|core\/trust|core\/pricing|core\/conversation)\/|^src\/api\/web\/(app|settings|employee|factory|operations|inbox|today)\.ts$/;

describe('ship 2 · the advisor: a shell, signed in only, walled off from every send, price and setting', () => {
  it('the check can fail: the assistant\'s settings module reaches the database and the pipeline (the control)', () => {
    const control = reached('src/api/web/employee.ts');
    expect(control.some((f) => f.startsWith('src/db/'))).toBe(true);
    expect(control.some((f) => f.startsWith('src/pipeline/'))).toBe(true);
  });

  it('its whole import graph reaches nothing that reads data, sends, prices, queues, calls a model or saves', () => {
    const graph = reached('src/api/web/advisor.ts');
    expect(graph[0]).toBeDefined();
    expect(graph.filter((f) => FORBIDDEN.test(f))).toEqual([]);
  });

  it('it registers two routes and only two — the page, and a question on it — and app.ts hands it three functions, nothing more', () => {
    const routes: string[] = [];
    const fake = {
      get: (path: string) => { routes.push(`GET ${path}`); },
      post: (path: string) => { routes.push(`POST ${path}`); },
    };
    const io: AdvisorIO = { signedIn: () => true, locale: () => 'en', page: (_r, o) => o.bodyHtml };
    advisorRoutes(fake as unknown as FastifyInstance, io);
    expect(routes).toEqual(['GET /app/advisor', 'POST /app/advisor']);
    const app = read('src/api/web/app.ts');
    const call = app.slice(app.indexOf('advisorRoutes(app, {'), app.indexOf('});', app.indexOf('advisorRoutes(app, {')) + 3);
    expect([...call.matchAll(/^\s+([a-zA-Z]+): /gm)].map((m) => m[1])).toEqual(['signedIn', 'locale', 'page']);
    expect(call).not.toMatch(/deps|db\b|send|enqueue|save|price/i);
    // nothing else in the app answers at the advisor's address
    expect(app.match(/['"`]\/app\/advisor/g) ?? []).toEqual([]);
    expect(read('src/api/web/advisor.ts')).not.toMatch(/\bdeps\b|withTenantTx|\bsql`|createDb/);
  });

  /** One request through the advisor's own routes, as a signed-in owner or nobody. */
  const ask = async (method: 'GET' | 'POST', signedIn: boolean, body?: Record<string, unknown>, locale: Locale = 'en') => {
    const handlers: Record<string, (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>> = {};
    const fake = {
      get: (p: string, _o: unknown, h: typeof handlers[string]) => { handlers[`GET ${p}`] = h; },
      post: (p: string, _o: unknown, h: typeof handlers[string]) => { handlers[`POST ${p}`] = h; },
    };
    let drawn: { title: string; active: string; bodyHtml: string } | null = null;
    advisorRoutes(fake as unknown as FastifyInstance, {
      signedIn: () => signedIn, locale: () => locale, page: (_r, o) => { drawn = { ...o }; return 'PAGE'; },
    });
    const out: { redirect?: string; sent?: unknown } = {};
    const reply = {
      redirect: (to: string) => { out.redirect = to; return reply; },
      type: () => reply,
      send: (v: unknown) => { out.sent = v; return reply; },
    };
    await handlers[`${method} /app/advisor`]!({ body } as FastifyRequest, reply as unknown as FastifyReply);
    return { ...out, drawn: drawn as { title: string; active: string; bodyHtml: string } | null };
  };

  it('signed out — a customer, anyone without the account\'s login — is sent to sign in, and nothing is drawn', async () => {
    for (const m of ['GET', 'POST'] as const) {
      const r = await ask(m, false, { q: 'How are sales?' });
      expect(r.redirect).toBe('/login');
      expect(r.drawn).toBeNull();
    }
  });

  it('signed in: the page, under the advisor\'s own entry', async () => {
    const r = await ask('GET', true);
    expect(r.drawn?.active).toBe('advisor');
    expect(r.drawn?.title).toBe('Advisor');
    expect(NAV.find((n) => n.id === 'advisor')?.href).toBe('/app/advisor');
  });

  it('a question comes back once, escaped and cut to the box, with the placeholder — never an answer', async () => {
    const r = await ask('POST', true, { q: '<script>alert(1)</script> How much did we sell?' });
    const body = r.drawn!.bodyHtml;
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; How much did we sell?');
    expect(body).not.toContain('<script>');
    expect(body.match(new RegExp(esc(t('en', 'advisor.soon')), 'g'))).toHaveLength(2);
    const long = await ask('POST', true, { q: 'x'.repeat(ADVISOR_MAX + 50) });
    expect(long.drawn!.bodyHtml).toContain(`<bdi>${'x'.repeat(ADVISOR_MAX)}</bdi>`);
    expect(long.drawn!.bodyHtml).not.toContain('x'.repeat(ADVISOR_MAX + 1));
    const blank = await ask('POST', true, { q: '   ' });
    expect(blank.drawn!.bodyHtml).toBe(renderAdvisor('en'));
  });

  for (const l of LOCALES) {
    it(`${l} · the page: the opening line, one box, one button — no door, link or form to anywhere else`, () => {
      const html = renderAdvisor(l);
      expect(html).toContain(`<h1 class="page">${esc(t(l, 'nav.advisor'))}</h1>`);
      expect(html).toContain(`<bdi>${esc(t(l, 'advisor.soon'))}</bdi>`);
      expect(html.match(/<form\b/g)).toHaveLength(1);
      expect(html).toContain('<form method="post" action="/app/advisor" class="msgbar">');
      expect(html.match(/<textarea\b/g)).toHaveLength(1);
      expect(html.match(/<button\b/g)).toHaveLength(1);
      expect(html.match(/<input\b/g) ?? []).toEqual([]);
      expect(html).not.toMatch(/<a\s|href=|formaction|data-confirm/);
      // its plain voice: the light magenta is the assistant's, and the advisor is not the assistant
      expect(html).not.toContain('by-as');
      expect(html).not.toContain('data-mark="agent"');
      for (const k of ['nav.advisor', 'advisor.soon', 'advisor.you', 'advisor.label', 'advisor.ask'] as const) {
        expect(messages[l][k], `${l} ${k}`).toBeTruthy();
      }
      // the placeholder promises nothing it has: no figure, no name, and it says nothing is looked up
      expect(t(l, 'advisor.soon')).not.toMatch(/\d/);
    });
  }
});
