import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { countryCodes } from '../../src/core/owner/business.js';
import { callingCode } from '../../src/core/channel/callingCodes.js';
import { phonePlaceholder } from '../../src/api/web/channels.js';
import { renderPilotRunbook, type PilotRunbook } from '../../src/api/web/pilot.js';
import { hubFor, CONTEXTUAL_ROUTES_BY_HUB } from '../../src/api/web/layout.js';

/**
 * Phase 4b — first run without WhatsApp: the parts a renderer and the
 * catalogue can prove without a database (the rest is
 * tests/integration/phase4-first-run.test.ts).
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const entries = (l: (typeof LOCALES)[number]) => Object.entries(messages[l]) as [MessageKey, string][];

describe('F3 · one word for practising: the nav word, in every locale', () => {
  // The practice room is "Practice" / 练习 / تدريب in the nav; Getting ready
  // called the same thing "Sandbox check" twice on one page.
  const OTHER_NAMES: Record<(typeof LOCALES)[number], RegExp> = {
    en: /sandbox/i,
    zh: /沙盒|沙箱/,
    ar: /بيئة التجربة/,
  };

  it('no owner sentence names it anything else', () => {
    for (const l of LOCALES) {
      const bad = entries(l).filter(([, v]) => OTHER_NAMES[l].test(v)).map(([k, v]) => `${l}/${k}: ${v}`);
      expect(bad, bad.join('\n')).toEqual([]);
    }
  });

  it('the check on Getting ready carries the nav word', () => {
    expect(t('en', 'pilot.item.sandbox')).toContain(t('en', 'nav.sandbox'));
    expect(t('zh', 'pilot.item.sandbox')).toContain(t('zh', 'nav.sandbox'));
    expect(t('ar', 'pilot.item.sandbox')).toContain(t('ar', 'nav.sandbox'));
  });
});

describe('A4 · the words no longer assume WhatsApp is the only channel', () => {
  const WA = /whatsapp|واتساب/i;

  it('the setup step, its blocker door, Getting ready’s item and the page title are channel-neutral', () => {
    for (const l of LOCALES) {
      for (const k of ['factory.next.channels', 'pilot.item.channel', 'nav.channels'] as const)
        expect(WA.test(t(l, k)), `${l}/${k}: ${t(l, k)}`).toBe(false);
      // the blocker names WhatsApp only as one of the four
      const blocker = t(l, 'pilot.blocker.channel');
      expect(/instagram|إنستغرام/i.test(blocker), `${l}: ${blocker}`).toBe(true);
    }
  });

  it('the refusal names no channel — the same verdict covers an Instagram thread', () => {
    for (const l of LOCALES) {
      const said = t(l, 'inbox.blocked.not_connected');
      expect(WA.test(said), `${l}: ${said}`).toBe(false);
    }
  });
});

describe('CC-15 · a phone example from her own country', () => {
  it('the catalogue fallback is a sentence, never somebody’s phone number', () => {
    for (const l of LOCALES) {
      const ph = t(l, 'settings.alerts.placeholder');
      expect(/\+?\d[\d\s-]{5,}/.test(ph), `${l}: ${ph}`).toBe(false);
    }
  });

  it('every country the sign-up form offers has its calling code, unless it has none', () => {
    // Uninhabited: Antarctica, Bouvet, South Georgia, Heard & McDonald, the
    // French Southern Territories, the U.S. Outlying Islands.
    const NONE = new Set(['AQ', 'BV', 'GS', 'HM', 'TF', 'UM']);
    const missing = countryCodes().filter((c) => callingCode(c) === null && !NONE.has(c));
    expect(missing).toEqual([]);
    for (const c of NONE) expect(callingCode(c), c).toBeNull();
    for (const code of countryCodes().map(callingCode).filter((x): x is string => x !== null))
      expect(code).toMatch(/^[1-9]\d{0,2}$/);
  });

  it('the example follows the country; an unknown one gets the neutral sentence', () => {
    expect(callingCode('MA')).toBe('212');
    expect(callingCode('cn')).toBe('86');
    expect(callingCode('AE')).toBe('971');
    expect(callingCode('UK')).toBe('44');           // a superseded code a workspace may hold
    expect(callingCode('ZZ')).toBeNull();
    expect(callingCode(null)).toBeNull();
    expect(phonePlaceholder('en', 'MA')).toBe('+212 …');
    expect(phonePlaceholder('ar', 'EG')).toBe('+20 …');
    for (const l of LOCALES) expect(phonePlaceholder(l, null)).toBe(t(l, 'settings.alerts.placeholder'));
  });
});

describe('CC-27 · the WhatsApp article describes the page that exists', () => {
  const kb = read('docs/kb/02-connect-whatsapp.md');

  it('no pasted connection code, no typed number, no automatic test message', () => {
    for (const promise of ['连接码', '粘贴', '测试消息', '输入接待客户的号码', '自动发'])
      expect(kb.includes(promise), promise).toBe(false);
  });

  it('names the real buttons, by the words the page shows', () => {
    for (const key of ['channel.action.connectNumber', 'channel.action.test', 'channel.action.reconnect', 'nav.channels'] as const)
      expect(kb, key).toContain(t('zh', key));
  });

  it('and the in-app guide no longer promises a test message either', () => {
    for (const l of LOCALES) expect(t(l, 'channel.connect.step3')).not.toMatch(/test message|测试消息|رسالة اختبار واحدة/);
  });
});

describe('F2 / F4 · Getting ready is the checklist; the machine room is one door away', () => {
  const rb: PilotRunbook = {
    readiness: {
      detected: { profile: true, products: true, priceRules: true, knowledge: true, claims: true, sandbox: false, channel: true },
      attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: null },
      validation: { at: null, pass: null, total: null }, backupVerifiedAt: null, readyToLaunch: false, assistantName: 'Lily',
    },
    operations: {
      range: 'week', attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
      activity: { handled: 0, draftsCreated: 0, corrections: 0 },
      knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
      budget: null, channel: { status: 'not_connected', provider: 'disabled' }, hasAttention: false,
    } as PilotRunbook['operations'],
    rehearsal: { available: true, done: { takeover: false, ownerReply: false, resume: false, knowledgeCorrection: false, validationPassed: false }, completed: 0, total: 5 },
    reliability: { stuckOutbound: 0, oldestQueuedAt: null },
  };

  it('no credential names on the owner’s page, in any locale; the door is there', () => {
    for (const l of LOCALES) {
      const html = renderPilotRunbook(rb, l, null);
      for (const k of ['meta.cred.accessToken', 'meta.cred.appSecret', 'meta.cred.verifyToken', 'meta.title', 'runbook.deploy.title', 'runbook.engine.title'] as const)
        expect(html.includes(t(l, k)), `${l}/${k}`).toBe(false);
      expect(html).toContain('<a class="deeper" href="/app/onboarding/technical">');
      // the checklist and practice stay
      expect(html).toContain(t(l, 'pilot.prelaunch'));
      expect(html).toContain(t(l, 'runbook.practice.title'));
    }
  });

  it('the technical page lights Setup, through Getting ready', () => {
    expect(CONTEXTUAL_ROUTES_BY_HUB.find((g) => g.hub === '/app/onboarding')?.routes).toContain('/app/onboarding/technical');
    expect(hubFor('/app/onboarding/technical', 'x')).toBe('settings');
  });
});
