import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { renderPrivacy, renderLegalTerms, renderDataDeletion, type LegalFacts } from '../../src/api/web/legal.js';
import { aiProcessor, processorLabel, transcriberProcessor, providerLineKey, HOSTING, DEFAULT_PROCESSOR } from '../../src/core/legal/processors.js';
import { TERMS_KEYS } from '../../src/core/legal/terms.js';
import { registerWebApp } from '../../src/api/web/app.js';
import { BOT_CHECK_WIDGET, type BotCheck } from '../../src/api/web/botCheck.js';
import { COOKIES } from '../../src/api/web/thirdParty.js';
import { formatLifetime } from '../../src/core/owner/i18n/format.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE ADVISOR'S HISTORY ON THE PRIVACY PAGE, ITS COOKIES, AND THE TERMS
 * (docs/ADVISOR-MEMORY.md §9.3–9.5, D7; 2026-10-07). Nothing may be stored
 * before the privacy page describes it, so this ships before the history does:
 *   · "The advisor's history": what is kept, on what basis, where each
 *     question goes and what that provider keeps (one line per provider this
 *     build can describe; none, and no dangling colon, for any other), that
 *     nobody at Nomi reads it, and what a customer's deletion reaches;
 *   · the "who" list names the transcriber and the sign-up bot check exactly
 *     when each runs, and says Nomi keeps advisor conversations for whoever
 *     allows it;
 *   · "Cookies": the cookies, drawn from the registry the code is checked
 *     against (third-party-gate.test.ts), so the page and the code agree;
 *   · the terms: one sentence — Nomi keeps them as the business's processor.
 */

const DEEPSEEK: LegalFacts = { processor: aiProcessor('https://api.deepseek.com/anthropic'), hosting: HOSTING };
const page = (l: Locale, facts: LegalFacts = DEEPSEEK) => withoutIsolates(renderPrivacy(l, 'privacy@example.test', facts));
const p = (l: Locale, key: Parameters<typeof t>[1], params?: Record<string, string>) => `<p>${esc(t(l, key, params))}</p>`;
const STOP: Record<Locale, string> = { en: '.', zh: '。', ar: '.', es: '.', fr: '.' };

describe('the privacy page · the advisor\'s history, in every language', () => {
  for (const l of LOCALES) {
    it(`${l} · its own section, after "Your choices" and before "Cookies": what, why, where it goes, who reads it, a customer's deletion`, () => {
      const html = page(l);
      const at = (s: string) => html.indexOf(s);
      const choices = at(`<h2>${esc(t(l, 'legal.privacy.choices.title'))}</h2>`);
      const title = at(`<h2 id="advisor">${esc(t(l, 'legal.privacy.advisor.title'))}</h2>`);
      const cookies = at(`<h2 id="cookies">${esc(t(l, 'legal.privacy.cookies.title'))}</h2>`);
      expect(choices, l).toBeGreaterThan(-1);
      expect(title, l).toBeGreaterThan(choices);
      expect(cookies, l).toBeGreaterThan(title);
      const parts = [
        p(l, 'legal.privacy.advisor.what'), p(l, 'legal.privacy.advisor.basis'),
        `<p>${esc(t(l, 'legal.privacy.advisor.providers', { processors: processorLabel(DEEPSEEK.processor, l), providerLines: t(l, 'legal.privacy.provider.deepseek', { provider: 'DeepSeek' }) }))}</p>`,
        p(l, 'legal.privacy.advisor.nobody'), p(l, 'legal.privacy.advisor.customers'),
      ].map(at);
      for (const [i, n] of parts.entries()) expect(n, `${l}: paragraph ${i + 1}`).toBeGreaterThan(title);
      expect([...parts].sort((a, b) => a - b), `${l}: in order`).toEqual(parts);
      expect(parts.at(-1)!, l).toBeLessThan(cookies);
    });

    it(`${l} · the who list says Nomi keeps advisor conversations for whoever allows it, after the advisor's own line`, () => {
      const li = [...page(l).matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]!);
      const advisor = li.find((x) => x.startsWith(esc(t(l, 'legal.privacy.who.advisor', { processor: processorLabel(DEEPSEEK.processor, l) }))));
      expect(advisor, l).toBeDefined();
      expect(advisor!, l).toContain(`${l === 'zh' ? '' : ' '}${esc(t(l, 'legal.privacy.who.advisorKept'))}`);
      // Chinese runs one sentence into the next, with no space between.
      if (l === 'zh') expect(advisor!).toContain(`。${esc(t(l, 'legal.privacy.who.advisorKept'))}`);
    });
  }

  it('the provider sentence ends in a colon and the lines in every language, so a provider with no line is cut cleanly', () => {
    for (const l of LOCALES) expect(messages[l]['legal.privacy.advisor.providers'], l).toMatch(/[:：]\s?\{providerLines\}$/);
  });

  it('DeepSeek (production) and OpenAI each get their own line; Anthropic and a host this build cannot name get none, and no dangling colon', () => {
    expect(providerLineKey(DEEPSEEK.processor)).toBe('legal.privacy.provider.deepseek');
    expect(providerLineKey(aiProcessor('https://api.openai.com/v1'))).toBe('legal.privacy.provider.openai');
    expect(providerLineKey(DEFAULT_PROCESSOR), 'Anthropic: not named until its terms are checked').toBeNull();
    expect(providerLineKey(aiProcessor('https://llm.internal.test/v1'))).toBeNull();
    for (const l of LOCALES) {
      const openai = aiProcessor('https://api.openai.com/v1');
      expect(page(l, { processor: openai, hosting: HOSTING }), l).toContain(esc(t(l, 'legal.privacy.provider.openai', { provider: 'OpenAI' })));
      for (const processor of [DEFAULT_PROCESSOR, aiProcessor('https://llm.internal.test/v1')]) {
        const html = page(l, { processor, hosting: HOSTING });
        const said = t(l, 'legal.privacy.advisor.providers', { processors: processorLabel(processor, l), providerLines: '@@' });
        const expected = said.replace(/\s*[:：]\s*@@$/u, STOP[l]);
        expect(expected, l).not.toContain('@@');
        expect(html, `${l} ${processor.name}`).toContain(`<p>${esc(expected)}</p>`);
        for (const line of ['legal.privacy.provider.deepseek', 'legal.privacy.provider.openai'] as const) {
          expect(html, `${l} ${processor.name}`).not.toContain(esc(t(l, line, { provider: processor.name })));
        }
        expect(expected, `${l} ${processor.name}: ends in its own full stop, not a colon`).toMatch(/[^:：\s][.。]$/u);
      }
    }
  });

  it('an installation that keeps no advisor history (advisorHistory: false) says nothing of one; absent, the page describes it', () => {
    for (const l of LOCALES) {
      const none = page(l, { ...DEEPSEEK, advisorHistory: false });
      expect(none, l).not.toContain('id="advisor"');
      expect(none, l).not.toContain(esc(t(l, 'legal.privacy.who.advisorKept')));
      // The advisor's own line stays, as it was: the questions still go to the provider.
      expect(none, l).toContain(esc(t(l, 'legal.privacy.who.advisor', { processor: processorLabel(DEEPSEEK.processor, l) })));
      expect(page(l, { ...DEEPSEEK, advisorHistory: true }), l).toContain('id="advisor"');
    }
  });

  it('the plan\'s honest limits are in the words: at most 180 days in backups, 12 months unopened, nobody at Nomi reads it', () => {
    expect(t('en', 'legal.privacy.advisor.basis')).toMatch(/at most 180 days/);
    expect(t('en', 'legal.privacy.advisor.basis')).toMatch(/12 months/);
    expect(t('en', 'legal.privacy.advisor.nobody')).toMatch(/^No one at Nomi reads stored advisor conversations/);
    expect(t('en', 'legal.privacy.advisor.nobody')).toMatch(/not a technical impossibility/);
    for (const l of LOCALES) {
      expect(t(l, 'legal.privacy.advisor.basis'), l).toContain('180');
      expect(t(l, 'legal.privacy.advisor.basis'), l).toContain('12');
    }
  });
});

describe('the privacy page · who sees it: the transcriber and the bot check, exactly when each runs', () => {
  it('the transcriber is named from the two variables the media ports read: none without a key, OpenAI by default, else the host', () => {
    expect(transcriberProcessor({})).toBeNull();
    expect(transcriberProcessor({ TRANSCRIBE_API_KEY: '   ' })).toBeNull();
    expect(transcriberProcessor({ TRANSCRIBE_API_KEY: 'k'.repeat(24) })).toEqual({ name: 'OpenAI', country: 'US' });
    expect(transcriberProcessor({ TRANSCRIBE_API_KEY: 'k'.repeat(24), TRANSCRIBE_BASE_URL: 'https://stt.internal.test/v1' })).toEqual({ name: 'stt.internal.test', country: null });
  });

  for (const l of LOCALES) {
    it(`${l} · named when set, before "Nobody else"; nothing when unset`, () => {
      const transcriber = { name: 'OpenAI', country: 'US' };
      const botCheck = { name: BOT_CHECK_WIDGET.turnstile.name, country: null };
      const both = page(l, { ...DEEPSEEK, transcriber, botCheck });
      const nobody = both.indexOf(`<p>${esc(t(l, 'legal.privacy.who.nobody'))}</p>`);
      const tr = both.indexOf(`<li>${esc(t(l, 'legal.privacy.who.transcriber', { transcriber: processorLabel(transcriber, l) }))}</li>`);
      const bc = both.indexOf(`<li>${esc(t(l, 'legal.privacy.who.botCheck', { botCheck: 'Cloudflare Turnstile' }))}</li>`);
      expect(tr, l).toBeGreaterThan(-1);
      expect(bc, l).toBeGreaterThan(-1);
      expect(nobody, l).toBeGreaterThan(Math.max(tr, bc));
      expect(both, l).toContain(p(l, 'legal.privacy.cookies.botCheck', { provider: 'Cloudflare Turnstile' }));
      const neither = page(l);
      for (const key of ['legal.privacy.who.transcriber', 'legal.privacy.who.botCheck', 'legal.privacy.cookies.botCheck'] as const) {
        const fixed = esc(t(l, key, { transcriber: '\u0000', botCheck: '\u0000', provider: '\u0000' })).split('\u0000').sort((a, b) => b.length - a.length)[0]!;
        expect(neither.includes(fixed), `${l} ${key} without one configured`).toBe(false);
      }
    });
  }

  it('the app names the bot check its sign-up route uses, and only then', async () => {
    const make = async (botCheck: BotCheck | null) => {
      const app = Fastify({ logger: false });
      registerWebApp(app, {
        db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in',
        businessId: 'de300000-0000-4000-8000-0000000000b1', employeeName: 'Lily', avatar: '', provider: 'disabled',
        secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
        legalFacts: DEEPSEEK, ...(botCheck ? { botCheck } : {}),
      } as Parameters<typeof registerWebApp>[1]);
      const body = (await app.inject({ method: 'GET', url: '/privacy' })).body;
      await app.close();
      return body;
    };
    const hcaptcha = await make({ provider: 'hcaptcha', siteKey: 'site-key-for-tests', verify: async () => false });
    expect(hcaptcha).toContain(esc(t('en', 'legal.privacy.who.botCheck', { botCheck: 'hCaptcha' })));
    expect(hcaptcha).toContain(esc(t('en', 'legal.privacy.cookies.botCheck', { provider: 'hCaptcha' })));
    const none = await make(null);
    expect(none).not.toContain('hCaptcha');
    expect(none).not.toContain('Turnstile');
  });
});

describe('the privacy page · cookies, drawn from the registry the code is checked against', () => {
  for (const l of LOCALES) {
    it(`${l} · every cookie the registry lists, with its purpose and how long it lasts; no other`, () => {
      const html = page(l);
      const table = /<table class="cookies">[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
      expect(table, l).not.toBe('');
      const names = [...table.matchAll(/<code dir="ltr">([^<]+)<\/code>/g)].map((m) => m[1]!);
      expect(names.sort(), l).toEqual(COOKIES.map((c) => c.name).sort());
      for (const c of COOKIES) {
        const row = /<tr>[\s\S]*?<\/tr>/g;
        const mine = [...table.matchAll(row)].map((m) => m[0]).find((r) => r.includes(`<code dir="ltr">${c.name}</code>`))!;
        expect(mine, `${l} ${c.name}`).toContain(`<td>${esc(t(l, c.purpose))}</td>`);
        expect(mine, `${l} ${c.name}`).toContain(`<td>${esc(formatLifetime(l, c.lifetimeSec))}</td>`);
      }
      expect(table, l).toContain(`<th scope="col">${esc(t(l, 'legal.privacy.cookies.lifetime'))}</th>`);
      expect(html, l).toContain(p(l, 'legal.privacy.cookies.body'));
    });
  }

  it('the lifetimes read as a person says them, in each language', () => {
    // (Spanish and French keep the figure and its unit together with a no-break space, as ICU writes them.)
    const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
    expect(LOCALES.map((l) => plain(formatLifetime(l, 7 * 86_400)))).toEqual(['7 days', '7天', '7 أيام', '7 días', '7 jours']);
    expect(formatLifetime('en', 365 * 86_400)).toBe('1 year');
    expect(formatLifetime('en', 60)).toBe('1 minute');
    expect(plain(formatLifetime('fr', 3600))).toBe('1 heure');
    expect(formatLifetime('ar', 180 * 86_400)).toBe('180 يومًا');
  });

  it('no percent sign, and the bot check\'s own cookie is said only where a bot check runs', () => {
    for (const l of LOCALES) expect(page(l).replace(/<style[\s\S]*?<\/style>/g, ''), l).not.toContain('%');
  });
});

describe('the terms · one sentence: Nomi keeps the history as the business\'s processor', () => {
  for (const l of LOCALES) {
    it(`${l} · right after what Nomi does, and part of the version a sign-up agrees to`, () => {
      const html = renderLegalTerms(l, null);
      expect(html, l).toContain(`<p>${esc(t(l, 'legal.terms.service.body'))}</p>\n    <p>${esc(t(l, 'legal.terms.service.advisor'))}</p>`);
    });
  }
  it('the sentence is one of the terms\' keys, so the version moved with it; the dates moved with the pages that changed', () => {
    expect(TERMS_KEYS).toContain('legal.terms.service.advisor');
    expect(TERMS_KEYS.indexOf('legal.terms.service.advisor')).toBe(TERMS_KEYS.indexOf('legal.terms.service.body') + 1);
    expect(t('en', 'legal.terms.service.advisor')).toMatch(/as your processor/);
    // (both moved again on 8 October: the terms' age line, and the privacy page's age cookie; the privacy page
    // again on 9 October: what every first e-mail and follow-up carries)
    expect(t('en', 'legal.updated.terms')).toBe('Last updated 8 October 2026.');
    expect(t('en', 'legal.updated.privacy')).toBe('Last updated 9 October 2026.');
    // The deletion page did not change, so its date did not either.
    expect(renderDataDeletion('en', null)).toContain(esc(t('en', 'legal.updated.deletion')));
  });
});
