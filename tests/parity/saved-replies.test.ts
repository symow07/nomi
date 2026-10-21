import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { boxWithSaved, savedReplyFor, savedReplyProblem, savedReplyTexts } from '../../src/core/owner/savedReplies.js';
import { renderSavedReplies, renderSavedReply } from '../../src/api/web/savedReplies.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * S1 (Phase 5, item 18) — saved replies, the pure parts: which words a buyer gets, how they join the box, what a
 * saved reply must be; the pages in five languages; and the one rule the whole item rests on — a saved reply never
 * sends: it is put in the box by a second button of the reply form, and goes only by that form's own reply.
 */
const APP = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
const INBOX = readFileSync(new URL('../../src/api/web/inbox.ts', import.meta.url), 'utf8');

describe('S1 · the words, the box, the shape', () => {
  it('the buyer\'s language when the reply has it; else the person\'s; else the first it has', () => {
    const texts = { en: 'Prices attached.', fr: 'Prix ci-joints.' };
    expect(savedReplyFor(texts, 'fr', 'en')).toEqual({ language: 'fr', text: 'Prix ci-joints.' });
    expect(savedReplyFor(texts, 'zh', 'en')).toEqual({ language: 'en', text: 'Prices attached.' });
    expect(savedReplyFor(texts, null, 'fr')).toEqual({ language: 'fr', text: 'Prix ci-joints.' });
    expect(savedReplyFor({ ar: 'الأسعار مرفقة.' }, 'de', 'zh')).toEqual({ language: 'ar', text: 'الأسعار مرفقة.' });
    expect(savedReplyFor({ en: '   ' }, 'en', 'en')).toBeNull();
  });

  it('put after what was typed — what was typed is never lost; an empty box takes the words alone', () => {
    expect(boxWithSaved('', 'Prices attached.')).toBe('Prices attached.');
    expect(boxWithSaved('  \n', 'Prices attached.')).toBe('Prices attached.');
    expect(boxWithSaved('Hello Amal,  \n', 'Prices attached.')).toBe('Hello Amal,\n\nPrices attached.');
  });

  it('a title of 1 to 80, words in at least one of the five languages, 2,000 at most each', () => {
    expect(savedReplyProblem('Prices', { en: 'x' })).toBeNull();
    expect(savedReplyProblem(' ', { en: 'x' })).toBe('title');
    expect(savedReplyProblem('x'.repeat(81), { en: 'x' })).toBe('title');
    expect(savedReplyProblem('Prices', {})).toBe('texts');
    expect(savedReplyProblem('Prices', { en: '  ' })).toBe('texts');
    expect(savedReplyProblem('Prices', { zh: 'x'.repeat(2001) })).toBe('too_long');
    expect(savedReplyTexts({ en: ' Hi ', zh: '', de: 'Hallo', fr: undefined })).toEqual({ en: 'Hi' });
  });
});

describe('S1 · a saved reply never sends', () => {
  it('the reply form\'s second button puts it in the box: same form (what was typed goes with it), no validation of an empty box', () => {
    const pick = INBOX.slice(INBOX.indexOf('function savedReplyPick'), INBOX.indexOf('function photoForm'));
    expect(pick).toContain('formaction="/app/inbox/${encodeURIComponent(d.conversationId)}/saved-reply" formnovalidate');
    expect(INBOX).toMatch(/<form method="post" action="\/app\/inbox\/\$\{cid\}\/reply" class="replyform">[\s\S]*?\$\{savedReplyPick\(d, locale\)\}\s*<button[^\n]*takeover\.action\.reply[^\n]*\n\s*<\/form>/);
  });

  it('the route only keeps the words in the box — it calls no send, enqueues nothing', () => {
    const route = APP.slice(APP.indexOf("app.post('/app/inbox/:conversationId/saved-reply'"), APP.indexOf('const savedForm'));
    expect(route).toContain('keepUnsentReply(tx, bid.value, cid, boxWithSaved(typed, words.text))');
    expect(route).not.toMatch(/ownerReply\(|enqueueOutboundRow|kickDrive|kickOutbound/);
  });

  it('the pages, in every language: a list, a form, archive asks first; none of them posts to a conversation', () => {
    const row = { id: '00000000-0000-4000-8000-000000000001', title: 'Prices', texts: { en: 'Prices attached.', ar: 'الأسعار مرفقة.' }, archived: false, updatedAt: '2026-10-22T09:00:00Z' };
    for (const l of LOCALES) {
      const list = renderSavedReplies(l, [row, { ...row, id: '00000000-0000-4000-8000-000000000002', title: 'Old', archived: true }]);
      expect(list, l).toContain('action="/app/replies"');
      expect(list, l).not.toMatch(/\/app\/inbox\//);
      const one = renderSavedReply(l, row);
      expect(one, l).toContain('data-confirm=');
      expect(one, l).toContain('name="text_ar" rows="3" maxlength="2000" lang="ar" dir="rtl"');
    }
  });
});
