import { describe, it, expect } from 'vitest';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { setupFrom } from '../../src/db/setup.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { shell } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';
import { menuRow, renderSetup, renderSettingsHome, renderLanguage } from '../../src/api/web/settings.js';
import { renderPilotReadiness, renderPilotRunbook, renderPilotScreen, renderPilotTechnical, practiceTasks, PILOT_SCREEN_PATH,
  type PilotReadiness, type PilotRunbook, type PilotFeedback } from '../../src/api/web/pilot.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY, shortName, type TodayData } from '../../src/api/web/today.js';
import { renderInsights } from '../../src/api/web/insights.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { t, messages } from '../../src/core/owner/i18n/messages.js';
import { esc, BACK_TO, notFoundInside } from '../../src/api/web/layout.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';
import { readFileSync } from 'node:fs';

/**
 * THE WARMTH RUN, PHASE 9 — the fix wave for Today, setting up, Settings and
 * Setup (docs/UI-AUDIT.md §3), and the whole-product items handed to this area.
 * Each block names the findings it holds; each would fail without its fix.
 */

const scopeOf = (over: Partial<RequestScope> = {}): RequestScope => ({
  name: null, several: false, outreach: false,
  setup: setupFrom({ profile: true, products: true, name: false, channels: true, first_success: false }),
  business: '义乌宏发日用品厂 (demo)', needsYou: 1, zone: 'Asia/Shanghai', country: 'CN', ...over,
});
const inScope = <T>(fn: () => T, over: Partial<RequestScope> = {}): T => withWorkspace(scopeOf(over), fn);
const SETUP_VIEW = { people: 2, alerts: { available: true, phones: 0, way: 'email' as const }, signIn: { email: null }, billing: { configured: false, exempt: false, status: 'none' }, dataWaiting: 0 };
const css = (): string => linkedCss(inScope(() => shell({ title: 'x', active: 'settings', locale: 'en', path: '/app/settings', bodyHtml: '' })));
/** The declarations of every rule whose selector list contains `sel` exactly. */
const rulesFor = (sheet: string, sel: string): string[] =>
  [...sheet.replace(/\/\*[^]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]!);

describe('w4-today-setup-24 · w4-whole-08 · a menu value takes the page\'s direction; its words are isolated', () => {
  it('the value\'s cell carries no direction of its own: in Arabic it is right to left, its mark where reading starts', () => {
    const row = menuRow({ href: '/x', label: 'البدء', value: 'اكتملت 3 من 5 خطوات', tone: 'warn' });
    expect(row).toContain('<span class="sr-value warn"><bdi>اكتملت 3 من 5 خطوات</bdi></span>');
    expect(row).not.toMatch(/class="sr-value[^"]*"[^>]*dir=/);
  });
  for (const l of LOCALES) {
    it(`${l} · Settings and Setup draw every value that way`, () => {
      const html = inScope(() => renderSettingsHome(l, null) + renderSetup(SETUP_VIEW, l, null));
      expect(html).toContain('class="sr-value');
      expect(html).not.toMatch(/class="sr-value[^"]*" dir=/);
    });
  }
});

describe('w4-today-setup-23 · w4-whole-08 · a menu value is never cut; the name and the value share the row', () => {
  it('no menu rule cuts a value short or keeps it to one line', () => {
    const sheet = css();
    for (const sel of ['.sr-menu .sr-value', '.srow.sr-menu > .sr-value']) {
      for (const body of rulesFor(sheet, sel)) {
        expect(body, sel).not.toMatch(/text-overflow|white-space:\s*nowrap|overflow:\s*hidden/);
        expect(body, sel).not.toMatch(/max-width:\s*(?!100%)\d/);
      }
    }
  });
  it('the row is a grid of four, so the shorter of name and value stays whole and the longer wraps', () => {
    const grid = rulesFor(css(), '.srow.sr-menu').join(';');
    expect(grid).toMatch(/display:grid/);
    expect(grid).toMatch(/grid-template-columns:min-content minmax\(0, auto\) minmax\(0, max-content\) min-content/);
    expect(rulesFor(css(), '.srow.sr-menu > .sr-value').join(';')).toMatch(/overflow-wrap:break-word/);
  });
});

describe('w4-whole-16 · keyboard focus on a menu row is drawn inside the row, where the card cannot clip it', () => {
  it('the card still clips its rows to its corners, and a focused row\'s ring sits inside, rounded like the card', () => {
    const sheet = css();
    expect(rulesFor(sheet, '.scard').join(';')).toMatch(/overflow:hidden/);
    const focus = rulesFor(sheet, '.scard .srow:focus-visible').join(';');
    expect(focus).toMatch(/outline-offset:-2px/);
    expect(focus).toMatch(/border-radius:calc\(var\(--radius-card\) - 1px\)/);
  });
});


// ── Today ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-03T08:00:00Z');
const SNAP = (liveHere: boolean): OperationsSnapshot => ({
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: liveHere ? 'meta' : 'disabled', live: liveHere }, budget: null, hasAttention: false,
});
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const handledFaces = (names: readonly string[]): NonNullable<TodayData['handled']> => ({
  total: names.length,
  people: names.map((name, i) => ({ conversationId: uuid(100 + i), clientId: uuid(200 + i), name, photo: null, word: (['confirmed', 'quoted', 'handed', 'answered'] as const)[i % 4]! })),
});
const day = (over: Partial<TodayData> = {}): TodayData => ({ ...NOTHING_TODAY(NOW), sending: ['whatsapp'], ...over });
const today = (l: Locale, s: OperationsSnapshot, d: TodayData, over: Partial<RequestScope> = {}): string =>
  inScope(() => renderOperationsHome(s, l, d), { name: 'Lily', ...over });

describe('w4-whole-11 · w4-today-setup-21 · today-onboarding-missed-01 · Today answers "is anything connected?" as every page does', () => {
  for (const l of LOCALES) {
    it(`${l} · a channel connected where this installation sends nothing: never "nobody can reach", the day's faces, the installation's line quiet`, () => {
      const html = today(l, SNAP(false), day({ handled: handledFaces(['Carlos Mendes', 'Layla Mansour']) }));
      expect(html).not.toContain(esc(t(l, 'today.calm.notLive.title', { name: 'Lily' })));
      expect(html).toContain('class="face-link td-face"');
      expect(html).toContain(`<p class="muted notlive"><span class="dot todo" aria-hidden="true">○</span> ${esc(t(l, 'ops.system.notLive'))}</p>`);
      expect(html).not.toContain(`<span class="dot warn" aria-hidden="true">○</span> ${esc(t(l, 'ops.system.notLive'))}`);
    });
    it(`${l} · nothing connected: said once, at a heading's size, with the setup step's own door`, () => {
      const html = today(l, SNAP(true), day({ sending: [] }));
      expect(html).toContain(`<h2 id="today-done" class="td-head is-plain">${esc(t(l, 'today.calm.notLive.title', { name: 'Lily' }))}</h2>`);
      expect(html).toContain(`href="${STEP_LINK.channels}"`);
      expect(html).not.toContain('href="/app/business/ready"');
      // and it is never "all caught up"
      expect(html).not.toContain(esc(t(l, 'today.calm.title')));
    });
  }
  it('the one definition: Setup\'s step, Before going live and Ready read `connectedChannels`, and so does Today (through `loadToday`)', () => {
    const read = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
    for (const f of ['db/setup.ts', 'api/web/pilot.ts', 'api/web/ready.ts', 'api/web/today.ts']) expect(read(f), f).toContain('connectedChannels(tx,');
    expect(read('api/web/operations.ts')).toContain('const reachable = today.sending.length > 0;');
  });
});

describe('w4-today-setup-03 · -08 · -02 · under each face the customer\'s name, then one word of what happened', () => {
  for (const l of LOCALES) {
    it(`${l} · the first word of the name, in its own direction, then the word`, () => {
      const html = today(l, SNAP(true), day({ handled: handledFaces(['Aisha Bello', 'Amina Diallo', '王芳', 'محمد علي']) }));
      for (const n of ['Aisha', 'Amina', '王芳', 'محمد']) expect(html, n).toContain(`<span class="td-name" dir="auto">${n}</span>`);
      expect(html).toContain(`<span class="td-word">${esc(t(l, 'today.word.confirmed'))}</span>`);
      // two customers drawn as the same initial "A" are told apart by name
      expect(html).toContain('aria-label="Aisha Bello');
    });
    it(`${l} · each word is one word, the same kind of word as in every other language`, () => {
      for (const w of ['answered', 'quoted', 'confirmed', 'handed'] as const) expect(t(l, `today.word.${w}`), w).not.toMatch(/\s/);
    });
  }
  it('zh says an order the way the figures below say it', () => {
    expect(t('zh', 'today.tally.orders.other')).toContain(t('zh', 'today.word.confirmed'));
  });
  it('neither line under a face breaks inside a word', () => {
    const sheet = css();
    const rules = rulesFor(sheet, '.td-word').concat(rulesFor(sheet, '.td-name')).join(';');
    expect(rules).toMatch(/white-space:nowrap/);
    expect(rules).not.toMatch(/overflow-wrap:anywhere/);
    expect(shortName('  Carlos   Mendes ')).toBe('Carlos');
  });
});

describe('w4-today-setup-04 · past sixty faces, the last tile says how many more and opens nothing', () => {
  it('no door to a list where the others are not singled out', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Customer ${i + 1}`);
    const html = today('en', SNAP(true), day({ handled: { ...handledFaces(names), total: 200 } }));
    expect(html).toContain('<span class="td-more"><span class="td-plus"><bdi>+140</bdi></span>');
    expect(html).not.toMatch(/<a class="td-more"/);
  });
});

describe('w4-today-setup-05 · a line about one customer leads with their face, at the band\'s size', () => {
  const insight = { insights: [{ key: 'insight.quotedNoReply' as const, params: { buyer: 'Omar Haddad' }, action: { kind: 'follow_up' as const, href: '/app/inbox/c1#latest', buyer: 'Omar Haddad' }, who: { clientId: uuid(9), name: 'Omar Haddad', photo: null } }], monthChange: null };
  for (const l of LOCALES) {
    it(`${l} · the face opens the card; the door opens the conversation`, () => {
      const html = inScope(() => renderInsights(insight, l, { bare: true }));
      expect(html).toContain('<div class="row has-face"><a class="face-link tw-face" href="/app/customers/');
      expect(html).toContain('href="/app/inbox/c1#latest"');
    });
  }
  it('off Today the line has no face; on Today it is said at the size of the band\'s own lines', () => {
    expect(inScope(() => renderInsights(insight, 'en'))).not.toContain('tw-face');
    expect(rulesFor(css(), '.today-worth .grow').join(';')).toMatch(/font-size:var\(--font-size-small\)/);
  });
});

describe('w4-today-setup-06 · -07 · -09 · -27 · setting up is a chore under the band, said one way; the calm state said once', () => {
  const setup = setupFrom({ profile: true, products: true, name: false, channels: true, first_success: false });
  for (const l of LOCALES) {
    it(`${l} · a calm day with setting up left: the calm panel holds no chore; the chore carries the to-do ○`, () => {
      const html = today(l, SNAP(true), day(), { setup });
      const band = html.slice(html.indexOf('aria-labelledby="today-now"'), html.indexOf('</section>', html.indexOf('aria-labelledby="today-now"')));
      expect(band).toContain(esc(t(l, 'today.calm.title')));
      expect(band).not.toContain('today-foot setup');
      expect(band).not.toContain(esc(t(l, 'today.needs.none')));
      expect(html).toContain(`<div class="today-foot setup"><p><span class="dot todo" aria-hidden="true">○</span>`);
      expect(html).not.toContain(`<span class="dot warn" aria-hidden="true">○</span> <span class="muted">${esc(t(l, 'today.setup.line', { done: 3, total: 5 }))}`);
    });
    it(`${l} · Today's line and Setup's row phrase the count the same way`, () => {
      expect(t(l, 'today.setup.line', { done: 3, total: 5 })).toContain(t(l, 'nav.setup.progress', { done: 3, total: 5 }));
    });
  }
});

describe('w4-today-setup-28 · Settings\' My business row does not repeat the name printed above it', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = inScope(() => renderSettingsHome(l, null));
      const row = /<a class="srow sr-menu" href="\/app\/business">[^]*?<\/a>/.exec(html)![0];
      expect(row).not.toContain('sr-value');
      expect(row).not.toContain('义乌宏发日用品厂');
    });
  }
});

describe('V1-011 · V1-109 · "customers answered" and the fifth step count replies that went out', () => {
  const read = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
  it('the assistant\'s "customers answered" reads the sent rows Today\'s hero reads, not processed turns', () => {
    const ops = read('api/web/operations.ts');
    const handled = ops.slice(ops.indexOf('select count(distinct o.conversation_id)::int from outbound_messages o'), ops.indexOf('as handled,'));
    expect(handled).toMatch(/o\.origin = 'employee'/);
    expect(handled).toMatch(/o\.status in \('sent', 'delivered', 'read'\)/);
    expect(ops).not.toMatch(/from turns where business_id = \$\{B\} and created_at >= \$\{cutoff\}/);
  });
  it('Getting started\'s fifth step is done when the assistant\'s reply went out, not when a draft was approved', () => {
    const setupSql = read('db/setup.ts');
    const step = setupSql.slice(setupSql.indexOf('exists(select 1 from outbound_messages o'), setupSql.indexOf('as first_success_done'));
    expect(step).toMatch(/o\.origin = 'employee'/);
    expect(step).toMatch(/o\.status in \('sent', 'delivered', 'read'\)/);
    expect(setupSql).not.toMatch(/d\.status in \('approved','edited'\)/);
  });
});

// ── the checklist (was "Before going live"), its two screens, Ready, the guide ──

const PR: PilotReadiness = {
  detected: { profile: true, products: true, priceRules: false, knowledge: false, claims: false, sandbox: false, channel: true },
  attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: null },
  validation: { at: null, pass: null, total: null }, backupVerifiedAt: null, readyToLaunch: false, assistantName: 'Lily',
};
const RB: PilotRunbook = {
  readiness: PR, operations: SNAP(true),
  rehearsal: { available: true, done: { takeover: true, ownerReply: false, resume: false, knowledgeCorrection: false, validationPassed: false }, completed: 1, total: 5 },
  reliability: { stuckOutbound: 0, oldestQueuedAt: null, sent: 3 },
};
const FB: PilotFeedback = { range: 'month', handoffReasons: [], ownerActions: [], conversationsNeedingYou: 0, lastActivityAt: null, hasActivity: false };

describe('w4-today-setup-15 · the checklist is the owner\'s chores; what followed it is two screens a tap down', () => {
  for (const l of LOCALES) {
    it(`${l} · no week of counts, no delivery, no practice list, no history on the checklist — two rows to them`, () => {
      const html = inScope(() => renderPilotRunbook(RB, l, null, FB));
      for (const k of ['runbook.during.week', 'ops.health.title', 'feedback.title', 'runbook.after.title'] as const) expect(html, k).not.toContain(esc(t(l, k)));
      expect(html).not.toContain('<ol class="rbsteps">');
      expect(html).toContain(`<a class="srow sr-menu" href="${PILOT_SCREEN_PATH.practice}">`);
      expect(html).toContain(`<a class="srow sr-menu" href="${PILOT_SCREEN_PATH.activity}">`);
      expect(html.replace(/[\u2066-\u2069]/g, '')).toContain(`<span class="sr-value warn"><bdi>${esc(t(l, 'runbook.practice.count', { done: 1, total: 5 }))}</bdi></span>`);
    });
    it(`${l} · the two screens carry what left it`, () => {
      const practice = inScope(() => renderPilotScreen('practice', RB, l));
      const activity = inScope(() => renderPilotScreen('activity', RB, l, FB));
      expect(practice).toContain(`<h1 class="page">${esc(t(l, 'runbook.practice.title'))}</h1>`);
      expect(activity).toContain(`<h1 class="page">${esc(t(l, 'runbook.during.title'))}</h1>`);
      for (const k of ['runbook.during.week', 'ops.health.title', 'feedback.title', 'runbook.after.title'] as const) expect(activity, k).toContain(esc(t(l, k)));
    });
  }
  it('each screen has its address, lights Setup\'s hub and leads back to the checklist', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('for (const which of PILOT_SCREENS) {');
    expect(app).toContain('app.get(PILOT_SCREEN_PATH[which],');
    for (const p of Object.values(PILOT_SCREEN_PATH)) expect(BACK_TO[p]).toEqual({ href: '/app/onboarding', label: 'nav.onboarding' });
  });
});

describe('V1-120 · w4-today-setup-17 · -18 · V1-124 · what to try in Practice is said as tasks, one list, every item with its mark', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = inScope(() => renderPilotRunbook(RB, l, null, FB) + renderPilotScreen('practice', RB, l) + renderPilotScreen('activity', RB, l, FB));
      const rows = [...html.matchAll(/<div class="pr (done|todo)"><span class="mk[^"]*">([✓○])<\/span> <span class="lbl">([^<]+)<\/span><\/div>/g)];
      const tasks = (['runbook.step.takeover', 'runbook.step.reply', 'runbook.step.resume', 'runbook.step.teach', 'pilot.validate'] as const).map((k) => esc(inScope(() => t(l, k))));
      expect(rows.map((m) => m[3]).filter((x) => tasks.includes(x!))).toEqual(tasks);
      expect(rows.find((m) => m[3] === tasks[0])![2]).toBe('✓');
    });
  }
  it('the words that read as done while open, and the inside words, are gone from every catalogue', () => {
    for (const l of LOCALES) {
      const all = Object.entries(messages[l]);
      expect(all.filter(([k]) => k.startsWith('runbook.rehearse.')), l).toEqual([]);
    }
    const en = Object.values(messages.en).join('\n');
    for (const w of ['Trust validation passed', 'Knowledge taught', 'Delivery health', 'Take-over practiced', 'Owner reply practiced', 'Hand-back practiced'])
      expect(en, w).not.toContain(w);
    const ar = Object.values(messages.ar).join('\n');
    for (const w of ['اجتاز التحقق من الثقة', 'رد المالك']) expect(ar, w).not.toContain(w);
  });
  it('a workspace that signed itself up is not asked for the standard test conversations', () => {
    const own = practiceTasks({ ...RB, readiness: { ...PR, selfServe: true } });
    expect(own.map((x) => x.step)).toEqual(['takeover', 'ownerReply', 'resume', 'knowledgeCorrection']);
  });
});

describe('V1-122 · "What happened so far" says nothing that the counts above contradict', () => {
  it('the empty state names this month and what did not happen — not "once customers start talking"', () => {
    expect(t('en', 'feedback.none')).toMatch(/this month/);
    expect(t('en', 'feedback.none')).not.toMatch(/start talking/);
    expect(t('zh', 'feedback.none')).toContain('本月');
    expect(t('ar', 'feedback.none')).toContain('هذا الشهر');
    expect(t('es', 'feedback.none')).toContain('este mes');
    expect(t('fr', 'feedback.none')).toContain('ce mois-ci');
  });
});

describe('w4-today-setup-19 · the checklist says where it stands under its intro', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = inScope(() => renderPilotReadiness(PR, l, null));
      expect(html.indexOf('class="verdict"')).toBeGreaterThan(html.indexOf(esc(t(l, 'pilot.intro'))));
      expect(html.indexOf('class="verdict"')).toBeLessThan(html.indexOf(`<h2>${esc(t(l, 'pilot.setup'))}</h2>`));
    });
  }
  it('clear of the first section', () => {
    expect(rulesFor(css(), '.muted + .verdict').join(';')).toMatch(/margin:var\(--space-8\) 0 var\(--space-24\)/);
  });
});

describe('w4-whole-14 · V1-153 · w4-today-setup-22 · -26 · names: the checklist, the Practice checklist, Setup\'s card', () => {
  for (const l of LOCALES) {
    it(`${l} · Setup's row is named as the page it opens, and not as My business's "Going live"`, () => {
      expect(t(l, 'nav.onboarding')).toBe(t(l, 'pilot.title'));
      const live = t(l, 'business.row.live');
      expect(t(l, 'nav.onboarding').includes(live) || live.includes(t(l, 'nav.onboarding')), live).toBe(false);
      // the Practice checklist claims no readiness, and is the door's own name
      expect(t(l, 'ready.title')).toBe(t(l, 'pilot.item.ready'));
      expect(t(l, 'ready.title')).not.toBe(t(l, 'ready.done'));
      // Setup's first card carries no third name for setting up
      expect(inScope(() => renderSetup(SETUP_VIEW, l, null))).not.toContain(esc(t(l, 'setup.group.start')));
    });
  }
  it('en, es: "Ready for customers" and "Antes de empezar" are gone', () => {
    expect(t('en', 'ready.title')).not.toMatch(/Ready for/);
    expect(t('es', 'nav.onboarding')).not.toMatch(/Antes de empezar/);
  });
});

describe('V1-111 · -14 · the guide\'s captions name rows that exist, by their own names', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const cap = (k: string) => t(l, k as never);
      const has = (k: string, labels: readonly string[]) => { for (const x of labels) expect(cap(k), `${k} ∋ ${x}`).toContain(t(l, x as never)); };
      has('guide.profile.cap.1', ['nav.settings', 'nav.factory', 'settings.profile.title']);
      has('guide.products.cap.1', ['nav.settings', 'nav.factory', 'nav.products', 'product.teach']);
      has('guide.name.cap.1', ['nav.settings', 'nav.setup', 'pilot.title']);
      has('guide.channels.cap.1', ['nav.settings', 'nav.factory', 'factory.reach.title']);
      // (Arabic's الإعداد is inside الإعدادات, so Settings' name is taken out first.)
      expect(cap('guide.profile.cap.1').replace(t(l, 'nav.settings'), '')).not.toContain(t(l, 'nav.setup'));
      // the step's door does not reuse the page's own name
      expect(t(l, 'guide.do')).not.toContain(t(l, 'guide.title'));
    });
  }
});

describe('V1-006 · w4-today-setup-20 · the machine room says who sees it; its way back is above its heading', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = inScope(() => renderPilotTechnical(l, {}));
      expect(html).not.toContain('class="back"');
      expect(BACK_TO['/app/onboarding/technical']).toEqual({ href: '/app/onboarding', label: 'nav.onboarding' });
    });
  }
  it('it is served only to the installation\'s own workspace, and says so', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toMatch(/if \(s && s\.businessId !== deps\.businessId\) return reply\.callNotFound\(\);/);
    expect(t('en', 'pilot.technical.intro')).not.toMatch(/whoever/);
    expect(t('en', 'pilot.technical.intro')).toMatch(/Only this installation’s own workspace sees this page/);
  });
});

describe('w4-today-setup-25 · Setup\'s Notifications row says when the way in force cannot reach this reader', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = inScope(() => renderSetup({ ...SETUP_VIEW, alerts: { available: true, phones: 0, way: 'email', unreachable: true } }, l, null));
      expect(html).toContain(`<span class="sr-value warn"><bdi>${esc(t(l, 'setup.value.unreachable'))}</bdi></span>`);
      expect(inScope(() => renderSetup(SETUP_VIEW, l, null))).not.toContain(esc(t(l, 'setup.value.unreachable')));
    });
  }
});

describe('w4-today-setup-29 · the language screen: five rows, the one in force said in words and to a screen reader', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = renderLanguage(l);
      expect(html.match(/<a class="srow sr-menu" href="\/locale\?set=/g)).toHaveLength(5);
      expect(html.match(/aria-current="true"/g)).toHaveLength(1);
      expect(html).toContain(`hreflang="${l}" aria-current="true"`);
      expect(html).toContain(`<span class="sr-value ok"><bdi>${esc(t(l, 'settings.language.inUse'))}</bdi></span>`);
      expect(html).not.toContain('class="langsw"');
    });
  }
});

describe('w4-today-setup-30 · a mistyped address: no Today tile raised, no dashed box', () => {
  it('the message is a calm line with its door', () => {
    for (const l of LOCALES) {
      const html = notFoundInside(l);
      expect(html).not.toContain('class="empty"');
      expect(html).toContain('href="/app"');
    }
    expect(readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8')).toContain("title: t(locale, 'error.notfound.title'), active: 'none',");
  });
});

describe('w4-today-setup-06 · what Nomi\'s team does is not the owner\'s chore: a dash, not a ○', () => {
  it('the row says who does it, with no mark that asks anything', () => {
    for (const l of LOCALES) {
      const html = inScope(() => renderPilotReadiness(PR, l, null));
      const row = html.slice(html.lastIndexOf('<div class="pr', html.indexOf(esc(t(l, 'pilot.nomiChecks')))), html.indexOf(esc(t(l, 'pilot.nomiChecks.todo'))));
      expect(row).toContain('<span class="mk">—</span>');
      expect(row).not.toContain('○');
    }
  });
});
