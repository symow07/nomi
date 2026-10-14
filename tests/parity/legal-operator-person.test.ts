import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPrivacy, renderCookies, renderLegalTerms, renderRefunds, renderDataDeletion } from '../../src/api/web/legal.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { validateEnv } from '../../src/main.js';
import { HOSTING, aiProcessor } from '../../src/core/legal/processors.js';

/**
 * PHASE 4 GATE, DECISION 3 (the owner, 2026-10-14) — "name me, personally, with a contact address, on those four
 * pages before day 1": privacy, terms, refunds, cookies (and the deletion page, which says "we" too). Until the
 * company exists, "we" names a company that does not, and in the pilot real buyers' data passes through Nomi. So
 * each legal page says first who runs it — a person, named — and that "we" means them; the contact section carries
 * the address. The name comes from `OPERATOR_PERSON` (Railway), never from the repository: it is a person's name.
 * Names here are made up.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FACTS = { processor: aiProcessor(null), hosting: HOSTING };
const PERSON = 'Ada Example';
const pages = (l: (typeof LOCALES)[number], person: string | null) => ({
  privacy: renderPrivacy(l, 'privacy@example.com', FACTS, '/site', person),
  cookies: renderCookies(l, 'privacy@example.com', FACTS, '/site', person),
  terms: renderLegalTerms(l, 'privacy@example.com', '/site', person),
  refunds: renderRefunds(l, 'privacy@example.com', { trialDays: null }, '/site', person),
  deletion: renderDataDeletion(l, 'privacy@example.com', undefined, '/site', person),
});

describe('decision 3 · every legal page says who runs Nomi, first, and carries the address', () => {
  it('named: right under the title, in every language, with the contact address on the page', () => {
    for (const l of LOCALES) {
      for (const [name, html] of Object.entries(pages(l, PERSON))) {
        const line = `<p class="who-runs">${esc(t(l, 'legal.operator.person', { person: PERSON }))}</p>`;
        expect(html, `${l} ${name}`).toContain(line);
        expect(html.indexOf(line), `${l} ${name}: before anything else`).toBeLessThan(html.indexOf('</h1>') + 40);
        expect(html, `${l} ${name}: the address`).toContain('privacy@example.com');
      }
    }
  });

  it('not named (OPERATOR_PERSON unset): nothing stands in its place', () => {
    for (const l of LOCALES) for (const [name, html] of Object.entries(pages(l, null))) expect(html, `${l} ${name}`).not.toContain('who-runs');
  });

  it('the line genders nobody, and says "we" means the person', () => {
    const en = t('en', 'legal.operator.person', { person: PERSON });
    expect(en).not.toMatch(/\b(he|him|his|she|her|hers)\b/i);
    expect(en).toContain(`mean ${PERSON}`);
    for (const l of LOCALES) expect(t(l, 'legal.operator.person', { person: PERSON }).split(PERSON).length - 1, l).toBe(2);
  });
});

describe('decision 3 · the name comes from the deployment, never the repository', () => {
  const base = {
    DATABASE_URL: 'postgresql://x', WEBHOOK_VERIFY_TOKEN: 'v'.repeat(16), CREDENTIAL_KEY: 'c'.repeat(64),
    ANTHROPIC_API_KEY: 'sk-ant-test-not-real-0000', LEGAL_CONTACT_EMAIL: 'privacy@example.com', WHATSAPP_PROVIDER: 'disabled',
  };
  it('a name in any script is accepted; anything else refuses the boot', () => {
    for (const ok of ['Ada Example', 'José Núñez-Ortega', "Siobhán O'Neill", 'محمد العلي', '张伟']) {
      const v = validateEnv({ ...base, OPERATOR_PERSON: ok });
      expect(v.ok, ok).toBe(true);
      if (v.ok) expect(v.cfg.OPERATOR_PERSON).toBe(ok);
    }
    for (const bad of ['x', 'ada@example.com', '<b>Ada</b>', 'Ada; drop table', 'a'.repeat(90)]) expect(validateEnv({ ...base, OPERATOR_PERSON: bad }).ok, bad).toBe(false);
    expect(validateEnv(base).ok).toBe(true);   // absent is a real state: the pages name nobody, and the boot says so
  });

  it('every legal route hands the pages the name; the boot logs whether one is set, never the name', () => {
    const app = readFileSync(`${ROOT}src/api/web/app.ts`, 'utf8');
    for (const r of ['renderPrivacy', 'renderDataDeletion', 'renderLegalTerms', 'renderCookies', 'renderRefunds']) {
      expect(app, r).toMatch(new RegExp(`${r}\\([^\\n]*deps\\.operatorPerson \\?\\? null\\)`));
    }
    const main = readFileSync(`${ROOT}src/main.ts`, 'utf8');
    expect(main).toContain("operatorPerson: cfg.OPERATOR_PERSON?.trim() || null,");
    expect(main).toContain("'Legal pages name nobody as running Nomi: OPERATOR_PERSON is unset.'");
    expect(main).not.toMatch(/console\.\w+\([^)]*OPERATOR_PERSON\s*\)/);
  });
});
