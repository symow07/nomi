import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DISCLOSURE_LOCALES, DISCLOSURE_NATIVE_REVIEW, disclosureFor, isSignedOff, signedBy,
} from '../../src/core/conversation/disclosure.js';

/**
 * 2026-10-11 — the owner: the live Arabic sentence, «للتحدث مع شخص من فريقنا يكفي
 * طلب ذلك، ويصل الرد في أقرب وقت ممكن.», is confirmed correct and natural by a
 * native speaker: "Set ar: true against this exact sentence … If signed text and
 * live text ever diverge again, flip back to ar: false automatically."
 */

const template = (l: (typeof DISCLOSURE_LOCALES)[number]) => disclosureFor({ detected: l, name: '{name}', business: '{business}' })!;
const CONFIRMED = 'للتحدث مع شخص من فريقنا يكفي طلب ذلك، ويصل الرد في أقرب وقت ممكن.';

describe('the disclosure is signed off against the exact sentence sent', () => {
  it('Arabic is signed, and what is sent is the sentence the native speaker confirmed, to the character', () => {
    expect(DISCLOSURE_NATIVE_REVIEW.ar).toBe(true);
    expect(template('ar').endsWith(` ${CONFIRMED}`)).toBe(true);
    expect(isSignedOff('ar', template('ar'))).toBe(true);
    expect(signedBy('ar')).toMatch(/native speaker/);
  });

  it('one letter changed, and the language is no longer signed off', () => {
    const live = template('ar');
    for (const changed of [
      live.replace('ممكن.', 'ممكنًا.'),                // a single case ending added
      live.replace('يكفي', 'يكفى'),                    // a dotless yā’ for the dotted
      live.replace('،', ','),                          // the Arabic comma for a Latin one
      `${live} `,                                      // a trailing space
    ]) {
      expect(changed).not.toBe(live);
      expect(isSignedOff('ar', changed), changed).toBe(false);
    }
  });

  it('every flag is that comparison, never a literal: en, zh and ar signed; es, fr and pt awaiting a reader', () => {
    for (const l of DISCLOSURE_LOCALES) expect(DISCLOSURE_NATIVE_REVIEW[l], l).toBe(isSignedOff(l, template(l)));
    expect(DISCLOSURE_NATIVE_REVIEW).toEqual({ en: true, zh: true, ar: true, es: false, fr: false, pt: false });
    const src = readFileSync(new URL('../../src/core/conversation/disclosure.ts', import.meta.url), 'utf8');
    expect(src).toContain('isSignedOff(l, TEXT[l])');
    expect(src).not.toMatch(/\bar:\s*(?:true|false)\s*,/);
  });
});
