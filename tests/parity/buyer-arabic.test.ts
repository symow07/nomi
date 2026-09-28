import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { disclosureFor } from '../../src/core/conversation/disclosure.js';
import { AR_BANNED_FORMS } from './assistant-pronouns.lists.js';

/**
 * EVERY ARABIC WORD A BUYER READS addresses them in neither gender (rule 6),
 * and calls the assistant what it is — «مساعد آلي», never «ذكي» (swept
 * 2026-09-28, the owner's direction).
 *
 * What a buyer reads in Arabic, all of it: the buyer-facing pages of the
 * catalogue (`legal.*`, `unsub.*`, `proof.*`), the disclosure, and the fixed
 * replies of the fast path. The rest of the send path writes through the
 * model, whose words are its own; the rest of the catalogue is the owner's
 * (tests/parity/assistant-pronouns.test.ts holds that).
 *
 * The forms below are the ones that can only be a gendered address to the
 * reader: a masculine or feminine imperative, a second-person verb, a
 * vowel-marked suffix. The unvowelled ـك is not one (rule 6). Words are
 * compared exactly as written, like the owner catalogue's list.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const AR_W = /[ء-يً-ْ]+/g;

/** Second-person forms, either gender, that an address to a buyer would use. */
const BUYER_ADDRESS_FORMS = [
  'أخبرني', 'فأخبرني', 'أخبريني', 'فأخبريني', 'تحتاج', 'تحتاجين', 'تحتاجه', 'تريد', 'تريدين',
  'ترغب', 'ترغبين', 'تستطيع', 'تستطيعين', 'أردتَ', 'أردتِ', 'أنتَ', 'أنتِ', 'أرسلْ', 'أرسلي',
  'اكتب', 'اكتبي', 'تواصلي', 'اضغط', 'اضغطي', 'تفضل', 'تفضلي',
];

const fastPathArabic = (): string[] => {
  const src = readFileSync(`${ROOT}src/core/conversation/fastpath.ts`, 'utf8');
  const block = src.slice(src.indexOf('const REPLIES'), src.indexOf('function replyFor'));
  return [...block.matchAll(/^\s+ar: '([^']+)',$/gm)].map((m) => m[1]!);
};

const buyerArabic = (): [string, string][] => [
  ...(Object.entries(messages.ar) as [MessageKey, string][]).filter(([k]) => /^(legal|unsub|proof)\./.test(k)),
  ['disclosure', disclosureFor({ detected: 'ar', name: 'Lily', business: 'Westlake' })!],
  ...fastPathArabic().map((v, i) => [`fastpath#${i + 1}`, v] as [string, string]),
];

describe('buyer-facing Arabic addresses nobody in a gender', () => {
  it('reads every surface: the catalogue pages, the disclosure, the fixed replies', () => {
    const all = buyerArabic();
    expect(all.filter(([k]) => /^(legal|unsub|proof)\./.test(k)).length).toBeGreaterThan(90);
    expect(all.filter(([k]) => k.startsWith('fastpath#'))).toHaveLength(3);
    expect(all.find(([k]) => k === 'disclosure')?.[1]).toContain('مساعد آلي');
  });

  it('no gendered second-person form, and none the owner-side sweep removed', () => {
    const banned = new Set([...BUYER_ADDRESS_FORMS, ...AR_BANNED_FORMS]);
    const bad = buyerArabic().flatMap(([k, v]) =>
      (v.replace(/\{[a-zA-Z_]+\}/g, ' ').match(AR_W) ?? []).filter((w) => banned.has(w)).map((w) => `${k}: ${w}`));
    expect(bad).toEqual([]);
  });

  it('no vowel-marked address (كَ كِ تَ تِ at a word end)', () => {
    const bad = buyerArabic().filter(([, v]) => /(كَ|كِ|تَ|تِ)(?![ء-ي])/.test(v)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it('the assistant is «مساعد آلي» — a kind — never «ذكي», a compliment', () => {
    const bad = buyerArabic().filter(([, v]) => /(?<![ء-ي])(?:ال)?ذكي(?:ة)?(?![ء-ي])/.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
    expect(messages.ar['legal.privacy.ai' as MessageKey]).toContain('مساعد آلي');
  });
});
