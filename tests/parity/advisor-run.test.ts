import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { renderEmployee, screenHref, EMPLOYEE_SCREENS, aloneInForce, type EmployeeProfile } from '../../src/api/web/employee.js';
import { renderSettingsHome } from '../../src/api/web/settings.js';
import { ASSISTANT_HOME } from '../../src/api/web/layout.js';
import { agentMark } from '../../src/api/web/agentMark.js';
import { t, withAssistantName, withWorkspace } from '../../src/api/web/say.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { modesFor } from '../../src/core/conversation/autonomyLevel.js';

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

// SHIP 2's shell became the advisor itself (the advisor batch, 2026-10-06): its wall, its routes and its page
// are held in tests/parity/advisor-build.test.ts and tests/integration/advisor-build.test.ts.
