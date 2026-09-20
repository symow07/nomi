import { describe, it, expect } from 'vitest';
import { renderPrivacy, renderDataDeletion, renderLegalTerms, type LegalFacts } from '../../src/api/web/legal.js';
import { DEFAULT_PROCESSOR, HOSTING, aiProcessor, processorLabel } from '../../src/core/legal/processors.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { LOCALES, dirOf } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * The legal pages — what a stranger may read about what is kept, and how to
 * have it removed. Meta fetches both before an app may go live, so a page
 * that failed to render, or rendered behind a login, would keep Instagram
 * messages from ever arriving. The wording itself is bound by the catalogue
 * scan in owner-language.test.ts, like every other string.
 */

const TITLE = {
  privacy: 'legal.privacy.title', 'data-deletion': 'legal.deletion.title', terms: 'legal.terms.title',
} as const;
const FACTS: LegalFacts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
const pages = (email: string | null, facts: LegalFacts = FACTS) => [
  ['privacy', (l: (typeof LOCALES)[number]) => renderPrivacy(l, email, facts)] as const,
  ['data-deletion', (l: (typeof LOCALES)[number]) => renderDataDeletion(l, email)] as const,
  ['terms', (l: (typeof LOCALES)[number]) => renderLegalTerms(l, email)] as const,
].map(([name, html]) => ({ name, html }));

describe('Legal pages · what a stranger may read', () => {
  it('ALL THREE ARE DECLARED PUBLIC — Meta reads them before the app may go live', () => {
    const gets = PUBLIC_ROUTES.filter((r) => r.method === 'GET').map((r) => r.url);
    expect(gets).toEqual(expect.arrayContaining(['/privacy', '/data-deletion', '/terms']));
  });

  it('render in all three locales, in the right direction, with no script and nothing fetched', () => {
    for (const { name, html } of pages(null)) {
      for (const l of LOCALES) {
        const h = html(l);
        expect(h, `${name} ${l}`).toContain(`<html lang="${l}" dir="${dirOf(l)}">`);
        expect(h).toContain(esc(t(l, TITLE[name])));
        expect(h).not.toContain('<script');
        expect(h).not.toContain('<link');
        // Indexable, unlike the proof and unsubscribe pages: a policy nobody
        // can find is not one.
        expect(h).not.toContain('noindex');
      }
    }
    expect(renderPrivacy('ar', null, FACTS)).toContain('dir="rtl"');
  });

  it('the address is the installation\'s, and its absence is not a blank', () => {
    for (const { html } of pages('privacy@nomidoes.test')) {
      expect(html('en')).toContain('href="mailto:privacy@nomidoes.test"');
    }
    for (const { html } of pages(null)) {
      const h = html('en');
      expect(h).not.toContain('mailto:');
      expect(h).toContain(esc(t('en', 'legal.contact.same')));
    }
  });

  it('each page links to the others, and each says when it was last changed', () => {
    expect(renderPrivacy('zh', null, FACTS)).toContain('href="/data-deletion"');
    expect(renderPrivacy('zh', null, FACTS)).toContain('href="/terms"');
    expect(renderDataDeletion('zh', null)).toContain('href="/privacy"');
    expect(renderLegalTerms('zh', null)).toContain('href="/privacy"');
    for (const { html } of pages(null)) expect(html('en')).toContain(esc(t('en', 'legal.updated')));
  });

  it('the terms are the business\'s, and say the people who write in are not bound by them', () => {
    expect(renderLegalTerms('en', null)).toContain(esc(t('en', 'legal.terms.intro')));
    expect(t('en', 'legal.terms.intro')).toContain('privacy page');
  });

  it('what is promised is what the operator can keep: a PERSON, by hand, within thirty days', () => {
    // This used to pin the SENTENCE ("30 days") and nothing else, which read as
    // assurance that the promise was covered. It was not: the app role holds no
    // DELETE on any table (migration 0005 and seven `revoke delete` since), so
    // nothing in the product can remove a record. What the page may promise is
    // therefore what a person does — and it must say so out loud.
    for (const l of LOCALES) {
      expect(t(l, 'legal.deletion.step2'), `${l} must keep the window`).toContain('30');
    }
    expect(t('en', 'legal.deletion.step2')).toMatch(/person|by hand/i);
    expect(t('en', 'legal.deletion.step2')).toContain('this product deletes nothing on its own');
    // …and must not say the product does it, in any language.
    expect(t('en', 'legal.deletion.step2')).not.toMatch(/are removed from Nomi/i);
    expect(t('zh', 'legal.deletion.step2')).toContain('手动');
    expect(t('zh', 'legal.deletion.step2')).toContain('产品本身不会自己删掉');
    expect(t('ar', 'legal.deletion.step2')).toContain('يدويًا');
  });
});

/**
 * PR 1 — the page names the company that actually reads the message.
 *
 * It said "Anthropic" in three hard-coded sentences, and went on saying it
 * after this installation moved to DeepSeek — with "Nobody else." underneath.
 * These bind the sentence to the configuration, in all three languages.
 */
describe('Legal pages · who processes a buyer\'s words', () => {
  const deepseek: LegalFacts = { processor: aiProcessor('https://api.deepseek.com/anthropic'), hosting: HOSTING };

  it('the processor comes from the address the model client is pointed at', () => {
    expect(aiProcessor(null)).toEqual({ name: 'Anthropic', country: 'US' });
    expect(aiProcessor('https://api.deepseek.com/anthropic')).toEqual({ name: 'DeepSeek', country: 'CN' });
    // A host this build cannot name is named by its domain and given NO country:
    // a page may say less, never guess which border a message crossed.
    expect(aiProcessor('https://llm.internal.test/v1')).toEqual({ name: 'llm.internal.test', country: null });
    expect(processorLabel({ name: 'X', country: null }, 'en')).toBe('X');
  });

  it('EVERY locale names the same company and the same host, each in ITS OWN words', () => {
    for (const locale of LOCALES) {
      const html = renderPrivacy(locale, null, deepseek);
      expect(html, `${locale} must name DeepSeek`).toContain('DeepSeek');
      expect(html, `${locale} must name the host`).toContain('Railway');
      // The COUNTRY is in the reader's language — "DeepSeek (China)" inside a
      // Chinese sentence is the product speaking two languages at once.
      expect(html, `${locale} must say where, in ${locale}`)
        .toContain(esc(processorLabel(deepseek.processor, locale)));
      expect(html, `${locale} must say where the records are, in ${locale}`)
        .toContain(esc(processorLabel(HOSTING, locale)));
      // …and must NOT name a company this installation does not use.
      expect(html, `${locale} still names Anthropic`).not.toContain('Anthropic');
    }
    // Chinese uses its own brackets; English does not borrow them.
    expect(processorLabel(deepseek.processor, 'zh')).toBe('DeepSeek（中国）');
    expect(processorLabel(deepseek.processor, 'en')).toBe('DeepSeek (China)');
    expect(processorLabel(deepseek.processor, 'ar')).toContain('الصين');
    expect(processorLabel({ name: 'llm.internal.test', country: null }, 'zh')).toBe('llm.internal.test');
  });

  it('switching the provider switches the page — no sentence is written twice', () => {
    const anthropic = renderPrivacy('en', null, FACTS);
    expect(anthropic).toContain('Anthropic');
    expect(anthropic).not.toContain('DeepSeek');
    expect(renderPrivacy('en', null, deepseek)).not.toContain('Anthropic');
  });

  it('the catalogue holds no hard-coded processor name in any locale', async () => {
    const { messages } = await import('../../src/core/owner/i18n/messages.js');
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        if (!key.startsWith('legal.')) continue;
        for (const company of ['Anthropic', 'DeepSeek', 'OpenAI', 'Supabase']) {
          expect(value, `${locale}/${key} names ${company} — it must come from the configuration`).not.toContain(company);
        }
      }
    }
  });
});

/**
 * PR 2 — SOMEWHERE TO WRITE. Both public pages tell a buyer to ask for their
 * data, and `/data-deletion` is the URL Meta requires. With the address unset
 * the contact block rendered NOTHING: a page that says "ask us" and offers no
 * way to ask. The boot refuses rather than serving that.
 */
describe('Legal pages · the address they promise', () => {
  const base = {
    WHATSAPP_PROVIDER: 'disabled',
    DATABASE_URL: 'postgres://u:p@h/db',
    ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key-but-long-enough',
    WEBHOOK_VERIFY_TOKEN: 'verify-token-of-length',
    CREDENTIAL_KEY: 'a'.repeat(64),
  };
  const problems = async (env: Record<string, string>) => {
    const { validateEnv } = await import('../../src/main.js');
    const v = validateEnv(env);
    return v.ok ? [] : v.problems;
  };

  it('missing: the boot refuses, and says why the pages need it', async () => {
    const p = await problems(base);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('LEGAL_CONTACT_EMAIL: missing');
    expect(p[0]).toMatch(/public|write to/i);
  });

  it('a display name or a mailto: is refused — the page puts it inside a mailto already', async () => {
    for (const bad of ['Privacy <privacy@nomidoes.com>', 'mailto:privacy@nomidoes.com', 'not-an-address']) {
      expect((await problems({ ...base, LEGAL_CONTACT_EMAIL: bad }))[0], bad).toContain('invalid shape');
    }
  });

  it('a plain address boots', async () => {
    expect(await problems({ ...base, LEGAL_CONTACT_EMAIL: 'privacy@nomidoes.com' })).toEqual([]);
  });

  it('and when it IS set, every page carries it as a link a buyer can press', () => {
    for (const { name, html } of pages('privacy@nomidoes.com')) {
      for (const l of LOCALES) {
        expect(html(l), `${name} ${l}`).toContain('mailto:privacy@nomidoes.com');
      }
    }
  });
});
