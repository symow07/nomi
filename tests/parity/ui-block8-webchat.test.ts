import { describe, it, expect } from 'vitest';
import { renderChatPage } from '../../src/api/web/webChat.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * UI correction Block 8 · F43 — the public chat page (inventory 141). The thread is one stable container the script
 * swaps on its own (never the form, so a draft and the cursor stay); a message shows as sending, sent, or not sent
 * with a Try again that posts the same fields (the same `n`); the composer stays in reach at the foot of the screen;
 * the page is in the public frame. With the script off it is the same plain form it always was: method, action, the
 * hidden `n` (and `v` when embedded), `text`, one submit. Fails at cfc71dca; passes on head.
 */
const KEY = 'k_abcdefghijklmnop';
const now = new Date('2026-11-24T10:00:00Z');
const lines = [
  { id: '1', mine: true, text: 'Do you ship to Lyon?', at: new Date('2026-11-24T09:00:00Z') },
  { id: '2', mine: false, text: 'Yes, in three days.', at: new Date('2026-11-24T09:01:00Z') },
];
const page = (l: (typeof LOCALES)[number], extra: Partial<Parameters<typeof renderChatPage>[0]> = {}) =>
  renderChatPage({ locale: l, key: KEY, business: 'Atlas Bags', lines, mark: '42', now, ...extra });

describe('Block 8 · F43: the chat page', () => {
  it('the thread is one container the script swaps, and the page is in the public frame', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain('<body class="pub"');
      expect(html, l).toMatch(/<div class="chat-thread" id="chat-thread" data-mark="42"><ol class="chat-lines">[\s\S]*?<\/ol><\/div>/);
      expect(html, l).toMatch(/<p class="chat-status" id="chat-status" role="status" aria-live="polite"><\/p>/);
      // the empty thread is the same container
      expect(page(l, { lines: [] }), l).toMatch(/<div class="chat-thread" id="chat-thread" data-mark="42"><p class="chat-empty">/);
      // the form is outside the thread: swapping the thread never touches a draft
      const thread = html.slice(html.indexOf('id="chat-thread"'), html.indexOf('</div>', html.indexOf('id="chat-thread"')));
      expect(thread, l).not.toContain('<textarea');
    }
  });

  it('the script swaps only the thread, shows sending / sent / not sent with a retry, and leaves no-script alone', () => {
    for (const l of LOCALES) {
      const html = page(l);
      const js = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));
      expect(js, l).toContain("getElementById('chat-thread')");
      expect(js, l).toContain('th.innerHTML=nt.innerHTML');
      expect(js, l).not.toMatch(/location\.(reload|href\s*=|assign|replace)|document\.body\.innerHTML/);
      expect(js, l).toContain('e.preventDefault()');
      expect(js, l).toContain("className='chat-retry'");
      expect(js, l).toContain("'chat-line mine pending'");
      // the retry posts the same fields (the same n); the next message gets a fresh one
      expect(js, l).toContain('body:p.body');
      expect(js, l).toContain("f.querySelector('input[name=n]').value=fresh()");
      // the browser without fetch / DOMParser / crypto keeps the plain post
      expect(js, l).toMatch(/if\(!x\|\|!window\.fetch\|\|!window\.DOMParser\|\|!window\.crypto\)return;/);
      for (const k of ['chat.sending', 'chat.sent', 'chat.failed', 'chat.retry'] as const) {
        expect(t(l, k), `${l} ${k}`).not.toBe('');
        expect(js, `${l} ${k}`).toContain(JSON.stringify(t(l, k)).replace(/</g, '\\u003c'));
      }
      expect(js, l).toContain(JSON.stringify(t(l, 'chat.fresh', { business: 'Atlas Bags' })));
      if (l !== 'en') expect(t(l, 'chat.failed'), l).not.toBe(t('en', 'chat.failed'));
    }
  });

  it('the composer stays in reach, its targets are 44 px, and a refusal is read inside the form', () => {
    const html = page('en', { notice: 'tooLong' });
    expect(html).toMatch(/\.chat-form \{ position:sticky; inset-block-end:0;/);
    expect(html).toMatch(/\.chat-form button \{ min-height:44px;/);
    expect(html).toMatch(/\.chat-retry \{ min-height:44px;/);
    expect(html).toMatch(/<form class="chat-form" method="post" action="\/chat\/k_abcdefghijklmnop">\s*<p role="alert">/);
  });

  it('with the script off the form is the plain form it was: n, text, v when embedded, one submit', () => {
    for (const embed of [null, 'vis_0123456789abcdef']) {
      const html = page('en', { embed });
      const form = html.slice(html.indexOf('<form class="chat-form"'), html.indexOf('</form>'));
      expect(form).toContain('method="post" action="/chat/k_abcdefghijklmnop"');
      expect(form).toMatch(/<input type="hidden" name="n" value="[^"]+" \/>/);
      expect(form.includes('<input type="hidden" name="v" value="vis_0123456789abcdef" />')).toBe(embed !== null);
      expect(form).toContain('<textarea id="chat-text" name="text" required maxlength="2000" dir="auto"></textarea>');
      expect(form.match(/<button/g)?.length).toBe(1);
      expect(form).toContain('<button type="submit">');
      expect(form.match(/name="/g)?.length).toBe(embed ? 3 : 2);
      expect(html).toContain(`href="/chat/k_abcdefghijklmnop${embed ? `?v=${embed}` : ''}#latest"`);
    }
  });
});
