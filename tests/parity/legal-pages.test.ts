import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPrivacy, renderDataDeletion, renderLegalTerms, type LegalFacts } from '../../src/api/web/legal.js';
import { DEFAULT_PROCESSOR, HOSTING, aiProcessor, processorLabel } from '../../src/core/legal/processors.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { LOCALES, dirOf } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

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
    for (const { name, html } of pages(null)) {
      const h = html('en');
      expect(h).not.toContain('mailto:');
      // Phase 9 (V1-064) — the line for a person who wrote to a business is not the
      // terms' (they are the business's own): with no address, the terms have no section.
      if (name === 'terms') expect(h).not.toContain(esc(t('en', 'legal.contact.title')));
      else expect(h).toContain(esc(t('en', 'legal.contact.same')));
    }
    // Phase 9 (V1-059, V1-062, public-missed-22) — the address in the language's own
    // sentence and stop; the business line on privacy only, where it is not step 1 again.
    for (const l of LOCALES) {
      const write = esc(t(l, 'legal.contact.write', { email: '\u0000' })).replace('\u0000', '<a href="mailto:privacy@nomidoes.test">privacy@nomidoes.test</a>');
      for (const { name, html } of pages('privacy@nomidoes.test')) {
        expect(html(l), `${name} ${l}`).toContain(`<p>${write}</p>`);
        expect(html(l).includes(esc(t(l, 'legal.contact.same'))), `${name} ${l}`).toBe(name === 'privacy');
      }
    }
    expect(t('zh', 'legal.contact.write')).toBe('写信到 {email}。');
    for (const l of LOCALES) expect(t(l, 'legal.contact.same'), l).not.toMatch(/saying so|说明即可|بذلك|lo diga|en ce sens/);
  });

  it('each opens like the site: the mark and the name, a way to the site, the language switch back to the same page', () => {
    for (const { name, html } of pages('privacy@nomidoes.test')) {
      for (const l of LOCALES) {
        const h = html(l);
        expect(h, `${name} ${l}`).toMatch(/<main><header class="pub-top"><a class="pub-brand" href="\/site"><svg class="mark"[^>]*aria-hidden="true"/);
        expect(h, `${name} ${l}`).toContain(`href="/locale?set=${l === 'en' ? 'zh' : 'en'}&next=/${name}"`);
        expect(h, `${name} ${l}`).toMatch(/<h1>[^<]+<\/h1>/);
      }
    }
    expect(renderPrivacy('en', null, FACTS, '/')).toContain('<a class="pub-brand" href="/">');
    // The title reads as one: a size above the section heads (public-missed-16).
    expect(renderPrivacy('en', null, FACTS)).toMatch(/h1 \{ font-size:var\(--font-size-display\)/);
  });

  it('each page links to the others, and each says when it was last changed', () => {
    expect(renderPrivacy('zh', null, FACTS)).toContain('href="/data-deletion"');
    expect(renderPrivacy('zh', null, FACTS)).toContain('href="/terms"');
    expect(renderDataDeletion('zh', null)).toContain('href="/privacy"');
    expect(renderLegalTerms('zh', null)).toContain('href="/privacy"');
    // The terms keep their own date; privacy and deletion changed together
    // (CC-02a) and carry theirs — a date that moved with no change to the
    // terms would read as a change to them.
    // G1 — the terms changed (acceptable use) on their own date.
    expect(renderLegalTerms('en', null)).toContain(esc(t('en', 'legal.updated.terms')));
    for (const h of [renderPrivacy('en', null, FACTS), renderDataDeletion('en', null)]) {
      expect(h).toContain(esc(t('en', 'legal.updated.privacy')));
    }
  });

  it('the terms are the business\'s, and say the people who write in are not bound by them', () => {
    expect(renderLegalTerms('en', null)).toContain(esc(t('en', 'legal.terms.intro')));
    expect(t('en', 'legal.terms.intro')).toContain('privacy page');
  });

  it('what is promised is what the product does (0126): the business deletes, at once, and nothing is said to be by hand', () => {
    // Until 0126 this held "a PERSON, by hand, within thirty days": the app
    // role holds no DELETE on any table, so nothing in the product could remove
    // a record. Since 0126 the business's own act erases, through a definer
    // function the app may call (`erase_customer`) — the role still holds no
    // DELETE (tests/integration/grants.test.ts). The page now says exactly
    // that, and no longer promises an operator or a delay.
    // The whole page is held by tests/parity/deletion-page.test.ts.
    expect(t('en', 'legal.deletion.step2')).toMatch(/deletes your data there\. It is deleted at once: gone, not hidden/);
    for (const l of LOCALES) {
      expect(t(l, 'legal.deletion.step2'), l).not.toContain('30');
      expect(t(l, 'legal.deletion.step3'), l).not.toContain('30');
    }
    expect(t('en', 'legal.deletion.step3')).not.toMatch(/by hand/i);
    expect(t('zh', 'legal.deletion.step3')).not.toContain('手动');
    expect(t('ar', 'legal.deletion.step3')).not.toContain('يدويًا');
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

/**
 * w4-public-01, -02 (S1) — the warmth run started keeping Instagram and
 * Messenger customers' profile photos (0123 `client_faces`). The privacy page
 * listed what is kept and did not name them; the deletion page listed what is
 * erased and did not either, though erase-buyer erases them. Each page now
 * names the photo, and this ties the words to the code that keeps and erases
 * it: if the faces job starts asking another channel, or the erasure stops
 * taking the photo, this fails before the page says something untrue.
 */
describe('Legal pages · the customer\'s profile photo is said where it is kept and where it is erased', () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
  const WHATSAPP: Record<(typeof LOCALES)[number], string> = { en: 'WhatsApp', zh: 'WhatsApp', ar: 'واتساب', es: 'WhatsApp', fr: 'WhatsApp' };
  const NAMES: Record<(typeof LOCALES)[number], readonly string[]> = {
    en: ['Instagram', 'Messenger'], zh: ['Instagram', 'Messenger'], ar: ['إنستغرام', 'ماسنجر'],
    es: ['Instagram', 'Messenger'], fr: ['Instagram', 'Messenger'],
  };

  it('privacy: under "What is kept", after its list and before "Why", in every locale', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(renderPrivacy(l, 'privacy@nomidoes.test', FACTS));
      const kept = h.indexOf(`<h2>${esc(t(l, 'legal.privacy.kept.title'))}</h2><p>${esc(t(l, 'legal.privacy.kept.body'))}</p>`);
      const photo = h.indexOf(`<p>${esc(t(l, 'legal.privacy.kept.photo'))}</p>`);
      const why = h.indexOf(`<h2>${esc(t(l, 'legal.privacy.why.title'))}</h2>`);
      expect(kept, l).toBeGreaterThan(-1);
      expect(photo, `${l}: the photo is not said to be kept`).toBeGreaterThan(kept);
      expect(why, l).toBeGreaterThan(photo);
    }
  });

  it('deletion: the photo is among what is deleted, right after who you are on every channel', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(renderDataDeletion(l, 'privacy@nomidoes.test'));
      const li = (k: string) => `<li>${esc(t(l, k as Parameters<typeof t>[1]))}</li>`;
      expect(h, `${l}: the photo is not said to be deleted`).toContain(li('legal.deletion.erased.identity') + li('legal.deletion.erased.photo'));
    }
  });

  it('both lines name the two channels the photo comes from, and never WhatsApp, which gives none', () => {
    for (const l of LOCALES) {
      for (const key of ['legal.privacy.kept.photo', 'legal.deletion.erased.photo'] as const) {
        const s = t(l, key);
        for (const name of NAMES[l]) expect(s, `${l}/${key} names ${name}`).toContain(name);
        expect(s, `${l}/${key}`).not.toContain(WHATSAPP[l]);
      }
    }
  });

  it('…which is what the code does: only Instagram and Messenger are asked, and erasing a customer takes the photo', () => {
    const due = read('migrations/0123_client_faces.sql');
    expect(due).toMatch(/c\.channel in \('instagram', 'messenger'\)/);
    expect(read('src/db/faces.ts')).toMatch(/r\.channel === 'instagram' \|\| r\.channel === 'messenger'/);
    expect(read('tools/erase-buyer.mjs')).toMatch(/client_faces: \{ do: 'erase' \}/);
    // A customer erased has no channel identity left, so the job cannot ask for the photo again.
    expect(due).toMatch(/from client_channels c\s+where c\.client_id = cl\.id/);
    expect(read('tools/erase-buyer.mjs')).toMatch(/client_channels: \{ do: 'erase'/);
  });
});
