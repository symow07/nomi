import { describe, it, expect } from 'vitest';
import { renderFactory, renderBusinessScreen, BUSINESS_SCREEN_PATH, type FactoryView } from '../../src/api/web/factory.js';
import { renderChannelScreen, renderConnectGuide, type ChannelsData } from '../../src/api/web/channels.js';
import { renderEmployee, renderEmployeeScreen, type EmployeeProfile, type HerContext, type TalkAbout } from '../../src/api/web/employee.js';
import { renderQuestion, renderHub } from '../../src/api/web/howYouSell.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, withAssistantName, withWorkspace } from '../../src/api/web/say.js';
import { capabilityName } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';
import { shell } from '../../src/api/web/layout.js';
import { SET_UP, FIRST_DAY } from './business-view.js';
import { withoutIsolates } from './isolates.js';
import { CATALOGUE_QUESTIONS, type SellingState } from '../../src/core/owner/howYouSell.js';
import { profileOf } from '../../src/core/owner/sellingStyle.js';

/**
 * THE WARMTH RUN, phase 9 — the fix wave, section 7 (My business, the
 * assistant's page, channels): what each finding asked for, held in the five
 * languages where the words matter.
 */

const inScope = <T>(fn: () => T): T => withWorkspace({ name: 'Lily', several: false, outreach: false, setup: null }, fn);
const menu = (v: FactoryView, l: Locale) => inScope(() => renderFactory(v, l));
const screen = (s: Parameters<typeof renderBusinessScreen>[0], v: FactoryView, l: Locale) => inScope(() => renderBusinessScreen(s, v, l));
const h1 = (html: string): string => /<h1 class="page">([^<]*)<\/h1>/.exec(html)?.[1] ?? '';
const say = (l: Locale, k: Parameters<typeof t>[1], p?: Record<string, string | number>) => inScope(() => esc(t(l, k, p)));

describe('w4-whole-14 · w4-business-assistant-04 · a row says the name of the page it opens', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = menu(SET_UP, l);
      // Going live: the row and the screen's heading are the same words
      expect(html).toContain(`<span class="sr-label">${say(l, 'business.row.live')}</span>`);
      expect(h1(screen('ready', SET_UP, l))).toBe(say(l, 'business.row.live'));
      // the kind of business: a short form, the first words of the page's own name
      const kind = inScope(() => t(l, 'business.row.kind'));
      expect(html).toContain(`<span class="sr-label">${esc(kind)}</span>`);
      // How you sell's rows: the pages' own names
      const how = screen('how', SET_UP, l);
      expect(how).toContain(`<span class="sr-label">${say(l, 'terms.title')}</span>`);
      expect(how).toContain(`<span class="sr-label">${say(l, 'closures.title')}</span>`);
      // Going live's last door names the checklist it opens
      expect(screen('ready', SET_UP, l)).toContain(`href="/app/onboarding">${say(l, 'pilot.title')}`);
    });
  }
  it('the kind row is the start of the page\'s own name', () => {
    expect(t('en', 'business.kind.title').startsWith(t('en', 'business.row.kind'))).toBe(true);
    expect(t('es', 'business.kind.title').startsWith(t('es', 'business.row.kind'))).toBe(true);
    expect(t('fr', 'business.kind.title').startsWith(t('fr', 'business.row.kind'))).toBe(true);
    expect(t('zh', 'business.kind.title').startsWith(t('zh', 'business.row.kind'))).toBe(true);
    expect(t('ar', 'business.kind.title').startsWith(t('ar', 'business.row.kind'))).toBe(true);
  });
});

describe('w4-business-assistant-02 · the waiting colour is for customers who wait, never for a setting not finished', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const first = menu(FIRST_DAY, l) + screen('how', FIRST_DAY, l);
      expect(first, l).not.toContain('sr-value warn');
      // …and a customer waiting for a sample still is
      const waiting = screen('how', { ...SET_UP, menu: { ...SET_UP.menu!, samples: { price: null, waiting: 2 } } }, l);
      expect(waiting, l).toContain('sr-value warn');
      // the assistant: a name not confirmed is a setting; every kind of reply is a standing rule
      const e: EmployeeProfile = { ...ASSISTANT, assistantNamed: false };
      expect(inScope(() => renderEmployee(e, l, null))).not.toContain('sr-value warn');
      expect(inScope(() => renderEmployeeScreen('replies', e, l, null))).not.toContain('class="sig');
    });
  }
});

describe('w4-business-assistant-03 · one door per place on My business', () => {
  it('the next step is never a second door to one of the menu\'s rows', () => {
    for (const step of ['profile', 'products', 'channels'] as const) {
      expect(menu({ ...FIRST_DAY, nextStep: step }, 'en'), step).not.toContain('class="deeper next"');
    }
  });
});

describe('rule 13 · w4-business-assistant-12, -13 · the Stop says Stop; the pause is not said in the Stop\'s words', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const live: FactoryView = { ...SET_UP, readiness: { ...SET_UP.readiness, lifecycle: 'active', live: true } };
      const ready = screen('ready', live, l);
      expect(ready).toContain(`<h2 class="sub3" data-golive="every" id="stop">${say(l, 'assistant.stop.title', { name: 'Lily' })}</h2>`);
      // WhatsApp's own switch says how it differs from the Stop
      expect(ready).toContain(say(l, 'activation.stop.differs', { name: 'Lily' }));
      // while stopped, WhatsApp's switch is not a second red button beside "let it answer again"
      const stopped = screen('ready', { ...live, readiness: { ...live.readiness, assistantStop: { stoppedAt: new Date(), stoppedBy: null } } }, l);
      expect(stopped).toContain('action="/app/business/start-assistant"');
      expect(stopped).not.toMatch(/<button class="btn danger"[^>]*>[^<]*<\/button>\s*<\/form>\s*<\/div>\s*$/);
      expect(stopped.match(/class="btn danger"/g) ?? []).toHaveLength(0);
      // the operator's pause: the answer line names neither the owner's Stop nor "stopped"
      const paused = screen('ready', { ...live, readiness: { ...live.readiness, opsSilenced: true } }, l);
      expect(paused).toContain(say(l, 'factory.ready.answer.held', { name: 'Lily' }));
      expect(paused).toContain(say(l, 'assistant.silenced.note', { name: 'Lily' }));
    });
  }
  it('the answer line is the same for both holds, and says only that nothing goes out', () => {
    expect(t('en', 'factory.ready.answer.held')).not.toMatch(/stop/i);
    expect(t('zh', 'factory.ready.answer.held')).not.toContain('停止');
    expect(t('ar', 'factory.ready.answer.held')).not.toContain('متوقف');
    expect(t('es', 'factory.ready.answer.held')).not.toContain('detenido');
    expect(t('fr', 'factory.ready.answer.held')).not.toContain('arrêt');
  });
});

describe('w4-business-assistant-14 · nothing connected is said once, and never under the daily limit\'s heading', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const nothing: FactoryView = { ...FIRST_DAY, readiness: { ...FIRST_DAY.readiness, allowance: { pctUsed: null, used: false, renewsAt: new Date() } } };
      const html = screen('ready', nothing, l);
      expect(html).toContain(say(l, 'factory.ready.answer.nothing', { name: 'Lily' }));
      expect(html).not.toContain(say(l, 'golive.none', { name: 'Lily' }));
      expect(html.indexOf('data-golive="allowance"')).toBeGreaterThan(html.indexOf(`href="${BUSINESS_SCREEN_PATH.channels}"`));
    });
  }
});

describe('w4-whole-11 · connected by the one definition, on My business too', () => {
  const wired: FactoryView = { ...FIRST_DAY, connection: { ...FIRST_DAY.connection, connected: { whatsapp: true, instagram: false, messenger: false, email: false } } };
  for (const l of LOCALES) {
    it(`${l} · a number connected that this installation cannot carry is Connected, and its block is Nomi's team's, never "connect it"`, () => {
      const row = /href="\/app\/business\/channels">[\s\S]*?<\/a>/.exec(menu(wired, l))?.[0] ?? '';
      expect(row).toContain(`<span class="sr-value ok" dir="auto"><bdi>${say(l, 'reach.channel.whatsapp')}</bdi>`);
      const home = screen('channels', wired, l);
      expect(home).toContain(`<span class="sr-value ok" dir="auto"><bdi>${say(l, 'connect.state.connected')}</bdi>`);
      expect(home).toContain(say(l, 'golive.waNoProvider'));
      const ready = screen('ready', wired, l);
      expect(ready).toContain(say(l, 'golive.waNoProvider'));
      expect(ready).not.toContain(say(l, 'activation.blocker.no_channel', { name: 'Lily' }));
      expect(ready).not.toContain(say(l, 'factory.ready.answer.nothing', { name: 'Lily' }));
      // and WhatsApp's own screen says the same
      const wa = inScope(() => renderChannelScreen('whatsapp', { ...BARE, wiredOnly: true }, l, null));
      expect(wa).toContain(`<span class="pill ok">${say(l, 'channel.status.connected')}</span>`);
      expect(wa).toContain(say(l, 'golive.waNoProvider'));
      expect(wa).not.toContain('action="/app/channels/whatsapp/connect"');
    });
  }
});

describe('w4-business-assistant-17 · a channel\'s screen is one column', () => {
  it('its rules and ledes stop where its cards do', () => {
    const css = linkedCss(shell({ title: 'T', active: 'settings', locale: 'en', path: '/app/channels/whatsapp', bodyHtml: '' }));
    expect(css).toMatch(/\.ch-screen \{ max-width:var\(--measure-prose\); \}/);
    for (const s of ['whatsapp', 'meta', 'email', 'alerts'] as const) expect(inScope(() => renderChannelScreen(s, BARE, 'en', null))).toContain('<div class="ch-screen">');
  });
});

describe('w4-business-assistant-11, -19, -20 · the words say what is there', () => {
  it('Arabic step 1 promises no field to type into; the line under the list names the business\'s own number; nothing is "confirmed here"', () => {
    expect(t('ar', 'channel.connect.step1')).not.toMatch(/^إدخال/);
    expect(renderConnectGuide('ar', { canAsk: false, contact: 'hello@nomi.test' })).toContain(esc(t('ar', 'channel.connect.step1')));
    for (const l of LOCALES) expect(t(l, 'factory.reach.nextNot'), l).toContain(l === 'ar' ? 'واتساب' : 'WhatsApp');
    expect(t('en', 'factory.reach.nextNot')).not.toMatch(/this number/i);
    expect(t('en', 'factory.promise.never')).not.toMatch(/confirmed here/);
    expect(t('es', 'factory.promise.never')).not.toMatch(/confirmado aquí/);
  });
});

const STATE: SellingState = {
  quantityFirst: true, products: [], allowed: new Set(), terms: null, workingHours: null, closures: [], words: new Set(), told: {},
};
describe('w4-business-assistant-21, -22, -24, -25 · How you sell', () => {
  const view = { facts: { kind: 'manufacturer' as const, profile: profileOf('manufacturer'), pricesToOwner: false, zone: 'UTC' }, order: CATALOGUE_QUESTIONS, progress: {} };
  for (const l of LOCALES) {
    it(`${l} · the way back names "The questions"; the list is menu rows`, () => {
      const q = inScope(() => renderQuestion({ ...view, q: 'price', state: STATE }, l, null));
      expect(q).toContain(`<span class="go" aria-hidden="true">‹</span>${say(l, 'hs.questions.title')}</a>`);
      expect(inScope(() => renderHub(view, l, null))).toContain('<ul class="scard">');
      expect(screen('how', SET_UP, l)).not.toMatch(/<span class="sr-desc">/);
    });
  }
  it('the two choices sit one under another in every language', () => {
    const css = linkedCss(shell({ title: 'T', active: 'settings', locale: 'zh', path: '/app/business/selling/price', bodyHtml: '' }));
    expect(css).toMatch(/\.hs-choices \{ flex-direction:column; \}/);
  });
});

/* ── the assistant ───────────────────────────────────────────────────────── */

const ASSISTANT: EmployeeProfile = {
  knows: 0, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-07-09T00:00:00Z'), stage: 'partial',
  canDo: ['greet'], needConfirm: ['quote'],
  capabilities: [{ capability: 'greet', mode: 'auto', promotable: false }, { capability: 'quote', mode: 'draft', promotable: false }],
  growth: [], promoted: true, conditions: [], products: 3, words: 0, pendingName: 'Mona',
};
const QUIET: HerContext = { taughtRecently: 0, corrected: 0, handled: 3, draftsPrepared: 1, neededYou: 0, gaps: [] };
const lily = <T>(fn: () => T): T => withAssistantName('Lily', fn);

describe('V1-420 · the Name screen shows the name that waits, and confirms it there', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = inScope(() => renderEmployeeScreen('name', { ...ASSISTANT, assistantNamed: false }, l, null));
      expect(html).toContain('<p class="emp-called"><bdi>Mona</bdi></p>');
      expect(html).toContain('<input type="text" name="name" maxlength="40" required value="Mona"');
      expect(html).toContain('<input type="hidden" name="from" value="employee" />');
      // what it does, and since when — not a line saying every reply waits beside "answers your customers"
      expect(html).not.toContain(esc(t(l, 'employee.stage.probation')));
      expect(html).toContain(esc(t(l, 'employee.role.reception')));
    });
  }
});

describe('V1-423 · what customers asked, and what the assistant cannot answer yet, are two lists that point at each other', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = lily(() => renderEmployeeScreen('learning', ASSISTANT, l, null, QUIET));
      expect(html).toContain(esc(t(l, 'her.teach.none')));
      expect(html).toContain(`href="/app/business/ready#rehearsal">${esc(lily(() => t(l, 'factory.rehearsal.title', { name: 'Lily' })))}`);
      expect(screen('ready', { ...SET_UP, rehearsal: { ...SET_UP.rehearsal!, findings: [{ reason: 'nothing_taught', productName: 'Cup', probeId: null }] } }, l))
        .toContain('id="rehearsal"');
    });
  }
});

describe('w4-business-assistant-29 · each row says its own thing', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = lily(() => renderEmployee({ ...ASSISTANT, canDo: [], capabilities: [{ capability: 'greet', mode: 'draft', promotable: false }] }, l, null, QUIET));
      const line = (href: string) => {
        const row = new RegExp(`href="${href}">[\\s\\S]*?</a>`).exec(html)?.[0] ?? '';
        return /<span class="sr-(?:desc|value)[^>]*>([\s\S]*?)<\/span>/.exec(row.replace(/<span class="sr-label">[^<]*<\/span>/, ''))?.[1] ?? '';
      };
      expect(line('/app/employee/replies')).not.toBe(line('/app/employee/next'));
      expect(line('/app/employee/one-kind')).not.toBe('');
    });
  }
});

describe('w4-business-assistant-30 · zh: one name per kind of reply on one screen', () => {
  it('the level\'s note names the kinds as the kinds are named', () => {
    for (const c of ['greet', 'qualify', 'recommend']) expect(t('zh', 'autonomy.level.talks.note')).toContain(capabilityName('zh', c));
    expect(t('zh', 'autonomy.level.talks.note')).not.toContain('打招呼');
  });
});

describe('w4-business-assistant-31 · the assistant\'s "can talk about" rows are My business\'s', () => {
  const talk: TalkAbout = { business: 'Atlas', given: ['description'], selling: { answered: 0, total: 9 }, products: { total: 2, names: ['Cup'] }, finished: false };
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = lily(() => renderEmployeeScreen('talk', ASSISTANT, l, null, QUIET, undefined, { talk }));
      expect(html).toMatch(new RegExp(`href="/app/settings/profile">[\\s\\S]*?<span class="sr-value" dir="auto"><bdi>${esc(t(l, 'setup.state.toDo'))}</bdi>`));
      expect(html).toContain('href="/app/business/how-you-sell"');
      expect(html).not.toContain('href="/app/business/selling"');
      expect(menu({ ...SET_UP, profile: { ...SET_UP.profile, location: null } }, l)).toContain(`<bdi>${esc(t(l, 'setup.state.toDo'))}</bdi>`);
    });
  }
});

describe('w4-business-assistant-32, -33 · the screens a level down speak from where they are', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const oneKind = lily(() => renderEmployeeScreen('one-kind', { ...ASSISTANT, capabilities: [{ capability: 'greet', mode: 'auto', promotable: false }] }, l, null));
      expect(oneKind).toContain(esc(lily(() => t(l, 'employee.actions.more'))));
      // the three levels are on the assistant's page, not "above" on this one
      expect(lily(() => t(l, 'employee.actions.more'))).toContain('Lily');
      expect(t(l, 'employee.actions.more')).not.toMatch(/levels above|上面的档位|المستويات أعلاه|niveles de arriba|ci-dessus/);
      // "What {name} knows" is the landing's row; the screen does not repeat it as a heading
      const learning = lily(() => renderEmployeeScreen('learning', ASSISTANT, l, null, QUIET));
      expect(learning).not.toContain(`<h2>${esc(lily(() => t(l, 'her.knows.title')))}</h2>`);
      expect(learning.split('href="/app/knowledge"').length - 1).toBe(1);
    });
  }
});

describe('V1-404 · Spanish and French amounts with no country on record', () => {
  it('My business\'s range, in the language\'s own form', () => {
    const scope = { name: 'Lily', several: false, outreach: false, setup: null, country: null };
    for (const l of ['es', 'fr'] as const) {
      const html = withWorkspace(scope, () => renderBusinessScreen('promises', { ...SET_UP, promises: { ...SET_UP.promises, floorLow: { amount: 0.3, currency: 'USD' }, floorHigh: { amount: 2.4, currency: 'USD' } } }, l));
      expect(withoutIsolates(html), l).toContain('0,30 $');
      expect(withoutIsolates(html), l).not.toMatch(/\$0\.30/);
    }
  });
});

const BARE: ChannelsData = {
  whatsapp: { kind: 'whatsapp', connected: false, status: 'not_connected', healthOk: false, displayId: null, lastActivityAt: null, problem: null, activated: false },
  ownerPhone: null, templateState: 'none', outreach: new Map(), domain: null,
};

it('no software words or raw keys on any of the new screens', () => {
  for (const l of LOCALES) {
    const all = [
      ...(['whatsapp', 'meta', 'email', 'alerts'] as const).map((s) => inScope(() => renderChannelScreen(s, BARE, l, null))),
      screen('channels', SET_UP, l), screen('ready', SET_UP, l), lily(() => renderEmployeeScreen('alone', ASSISTANT, l, null)),
    ].join('');
    expect(all, l).not.toMatch(/\b(her|reach|channels|golive|factory|autonomy)\.[a-z]+\.[a-zA-Z.]+/);
  }
});

describe('w4-business-assistant-09, -16 · names whole, and in Arabic letters on the channels\' screens', () => {
  it('Arabic: Meta is ميتا where the channels\' screens and the help page say it', () => {
    for (const k of ['meta.panel.reviewing', 'accounts.lead', 'reach.inbound.attention', 'channel.wa.template.submit', 'help.meta.opensMeta'] as const) {
      expect(t('ar', k), k).not.toContain('Meta');
      expect(t('ar', k), k).toContain('ميتا');
    }
  });
  it('a name with its own brackets stays one unit in a right-to-left line', async () => {
    const { listOfNames } = await import('../../src/api/web/channels.js');
    const said = listOfNames('ar', 'connect.unavailable', ['Gmail (Google Workspace)', 'Outlook (Microsoft 365)']);
    expect(said).toContain('<bdi>Gmail (Google Workspace)</bdi>');
    expect(said).toContain('<bdi>Outlook (Microsoft 365)</bdi>');
  });
});
