import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { metaReviewFrom } from '../../src/core/channel/metaReview.js';
import { renderMetaPanel } from '../../src/api/web/channels.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * CH4 — "Nomi and Meta": where Nomi stands with Meta, set by the operator in
 * one variable, said the same to every workspace, and holding nothing back.
 */

describe('CH4 · the operator\'s variable', () => {
  it('approved on a real date; anything else is "reviewing"', () => {
    expect(metaReviewFrom({ META_APP_REVIEW: 'approved:2026-11-20' })).toEqual({ state: 'approved', on: new Date(Date.UTC(2026, 10, 20)) });
    for (const v of [undefined, '', 'approved', 'approved:2026-13-01', 'approved:2026-02-30', 'yes', 'reviewing']) {
      expect(metaReviewFrom({ META_APP_REVIEW: v }), String(v)).toEqual({ state: 'reviewing' });
    }
  });
});

describe('CH4 · the panel, in every language', () => {
  for (const locale of LOCALES) {
    const l = locale as Locale;
    it(`${l} · both states, and the two channels' rules`, () => {
      // The page isolates each figure (U+2068 and U+2069 around the 24 in Arabic); the words are compared without the marks.
      const reviewing = renderMetaPanel({ state: 'reviewing' }, l).replace(/[\u2068\u2069]/g, '');
      expect(reviewing).toContain(esc(t(l, 'meta.panel.reviewing')));
      for (const k of ['meta.rules.window', 'meta.rules.first', 'meta.rules.media'] as const) expect(reviewing, k).toContain(esc(t(l, k)));
      const approved = renderMetaPanel({ state: 'approved', on: new Date(Date.UTC(2026, 10, 20)) }, l);
      expect(approved).not.toContain(esc(t(l, 'meta.panel.reviewing')));
      expect(approved).not.toMatch(/\{date\}|\bmeta\.[a-z.]+/);
    });
  }
  it('holds nothing back: Connect is offered whatever it says (the owner\'s instruction)', () => {
    const channels = readFileSync(new URL('../../src/api/web/channels.ts', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    for (const src of [channels, app]) expect(src).not.toMatch(/metaReview[\s\S]{0,80}(hidden|connect\b.*disabled)/);
    expect(channels).toContain('${metaReview ? renderMetaPanel(metaReview, locale) : \'\'}');
  });
});
