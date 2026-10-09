import { describe, it, expect } from 'vitest';
import { validateProfile, renderProfile, type ProfileInput, type BusinessProfile } from '../../src/api/web/settings.js';
import { renderPrivacy } from '../../src/api/web/legal.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, messages } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * PRE-LAUNCH item 3 (0133) — the business's postal address, written once by the owner on Settings, is what every
 * first e-mail and follow-up carries (outbound/worker.ts `marketingFooter`; refused `no_postal_address` without it).
 * Here: the field, its help and its "needed" line in five languages; an absent field leaves the stored one alone;
 * and the privacy page says what each e-mail carries — and that a reply carries neither. The send itself:
 * tests/parity/c4a-email.test.ts and tests/integration/email-replies.test.ts.
 */

const input: ProfileInput = {
  name: 'Acme', description: '', location: '', workingHours: '', contactEmail: '', contactPhone: '', languagesServed: ['en'],
};
const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  name: 'Reply Factory', description: null, location: null, workingHours: null, contactEmail: null, contactPhone: null,
  languagesServed: [], outreachArea: true, postalAddress: null, ...over,
});
const ADDRESS = '7 Canal Street, Yiwu, Zhejiang, China';

describe('0133 · the postal address on Settings', () => {
  for (const l of LOCALES) {
    it(`${l} · the field, what it is for, and — while it is empty and e-mail can go first — that it is needed`, () => {
      const empty = withoutIsolates(renderProfile(profile(), l, null));
      expect(empty).toContain(esc(t(l, 'settings.field.postalAddress')));
      expect(empty).toContain(esc(t(l, 'settings.desc.postalAddress')));
      expect(empty).toMatch(/<textarea id="pf-postal" name="postal_address" rows="3" maxlength="400" dir="auto"><\/textarea>/);
      expect(empty).toContain(esc(t(l, 'settings.need.postalAddress')));

      const filled = withoutIsolates(renderProfile(profile({ postalAddress: ADDRESS }), l, null));
      expect(filled).toContain(`>${esc(ADDRESS)}</textarea>`);
      expect(filled).not.toContain(esc(t(l, 'settings.need.postalAddress')));
      // nothing is written first without the outreach area, so nothing is needed
      expect(withoutIsolates(renderProfile(profile({ outreachArea: false }), l, null))).not.toContain(esc(t(l, 'settings.need.postalAddress')));
    });
  }

  it('the help says whose duty it is: the business sends, Nomi sends on its behalf and adds the address and the link', () => {
    const en = t('en', 'settings.desc.postalAddress');
    expect(en).toMatch(/Your business is the sender/);
    expect(en).toMatch(/your business's duty/);
    expect(en).toMatch(/on your behalf, from your own mailbox/);
    expect(en).toMatch(/none is sent while this is empty/);
    for (const l of LOCALES) expect(t(l, 'settings.desc.postalAddress'), l).toContain('Nomi');
  });

  it('a form without the field leaves the stored address alone; an empty one clears it; over 400 is refused', () => {
    const absent = validateProfile(input);
    expect(absent.ok && 'postalAddress' in absent.value).toBe(false);
    const cleared = validateProfile({ ...input, postalAddress: '   ' });
    expect(cleared.ok && cleared.value.postalAddress).toBe(null);
    const kept = validateProfile({ ...input, postalAddress: `  ${ADDRESS}  ` });
    expect(kept.ok && kept.value.postalAddress).toBe(ADDRESS);
    const long = validateProfile({ ...input, postalAddress: 'x'.repeat(401) });
    expect(long.ok).toBe(false);
    expect(!long.ok && long.errors.postalAddress).toBe('tooLong');
  });
});

describe('0133 · the privacy page says what each first e-mail and follow-up carries, and that a reply carries neither', () => {
  const said: Record<string, readonly RegExp[]> = {
    en: [/Every first e-mail and follow-up/, /postal address/, /A reply to an e-mail you wrote first carries neither/],
    zh: [/每封首次邮件和跟进邮件/, /邮寄地址/, /回复你先发来的邮件时，这两项都不附/],
    ar: [/وكل رسالة بريد أولى وكل رسالة متابعة/, /العنوان البريدي/, /ولا يحمل الردُّ على رسالة وردت منك أولًا أيًّا منهما/],
    es: [/Cada primer correo y cada seguimiento/, /dirección postal/, /Una respuesta a un correo que escribiste tú primero no lleva ninguno de los dos/],
    fr: [/Chaque premier e-mail et chaque relance/, /adresse postale/, /Une réponse à un e-mail que vous avez écrit en premier ne porte ni l’un ni l’autre/],
  };
  for (const l of LOCALES) {
    it(`${l} · on the page, in the business's choices`, () => {
      const body = messages[l]['legal.privacy.choices.body'];
      for (const re of said[l]!) expect(body, String(re)).toMatch(re);
      const page = withoutIsolates(renderPrivacy(l, null, { processor: DEFAULT_PROCESSOR, hosting: HOSTING }));
      expect(page).toContain(esc(t(l, 'legal.privacy.choices.body', { deletion: '\u0000' })).split('\u0000')[1]!);
    });
  }
});
