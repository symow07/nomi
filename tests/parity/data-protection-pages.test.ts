import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { renderDataDeletion } from '../../src/api/web/legal.js';
import { aiProcessor, HOSTING, type Processor } from '../../src/core/legal/processors.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE DATA-PROTECTION AUDIT (2026-10-12) — the public pages say what the code
 * does. Each item is held where the code and the words meet, so a change to
 * one without the other fails here.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');

describe('D8 · the pictures a buyer sends go to the language service, and the page says so', () => {
  it('the model client is handed images', () => {
    // The vision describer sends the photo itself, as an image block (src/llm/anthropic.ts).
    expect(read('src/llm/anthropic.ts')).toMatch(/type: 'image', source: \{ type: 'base64'/);
  });
  it('so the page names pictures beside the text, in every language', () => {
    const picture = { en: /\bpicture/, zh: /图片/, ar: /صور/, es: /imagen/, fr: /image/ } as const;
    for (const l of LOCALES) {
      const line = t(l, 'legal.privacy.who.ai', { processor: 'X' });
      expect(line, l).toMatch(picture[l]);
    }
    expect(t('en', 'legal.privacy.who.ai', { processor: 'X' })).not.toMatch(/from the text of the conversation/);
  });
});

describe('D6 · the deletion page names every copy no deletion inside Nomi reaches', () => {
  const DEEPSEEK: { processor: Processor; hosting: Processor; transcriber: Processor | null } =
    { processor: aiProcessor('https://api.deepseek.com/anthropic'), hosting: HOSTING, transcriber: null };
  const page = (l: (typeof LOCALES)[number], email: string | null, facts = DEEPSEEK) => withoutIsolates(renderDataDeletion(l, email, facts));
  const items = (html: string) => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);

  it('the language service by its configured name, with what its own terms say — in every language', () => {
    for (const l of LOCALES) {
      const html = page(l, 'privacy@nomi.test');
      const said = items(html).find((x) => x.startsWith(esc(t(l, 'legal.deletion.kept.processor', { processor: '@@' })).split('@@')[0]!) && x.includes('DeepSeek'));
      expect(said, l).toBeTruthy();
      expect(said!, l).toContain(esc(t(l, 'legal.privacy.provider.deepseek', { provider: 'DeepSeek' })));
    }
  });
  it('the host’s logs, by the host’s name; WhatsApp in the Meta line', () => {
    const html = page('en', 'privacy@nomi.test');
    expect(html).toContain(esc(t('en', 'legal.deletion.kept.logs', { hosting: 'Railway (USA)' })));
    // WhatsApp twice in every language: among Meta's own copies, and among the business's own inboxes.
    for (const l of LOCALES) {
      const name = l === 'ar' ? 'واتساب' : 'WhatsApp';
      expect(t(l, 'legal.deletion.kept.meta').split(name).length - 1, l).toBe(2);
    }
    expect(t('en', 'legal.deletion.kept.meta')).toMatch(/only the business can delete/);
  });
  it('the transcriber only where one runs; our mailbox only where the page gives an address', () => {
    const plain = page('en', 'privacy@nomi.test');
    expect(plain).not.toContain(esc(t('en', 'legal.deletion.kept.transcriber', { transcriber: '@@' })).split('@@')[1]!);
    const heard = page('en', 'privacy@nomi.test', { ...DEEPSEEK, transcriber: { name: 'OpenAI', country: 'US' } });
    expect(heard).toContain(esc(t('en', 'legal.deletion.kept.transcriber', { transcriber: 'OpenAI (USA)' })));
    expect(plain).toContain(esc(t('en', 'legal.deletion.kept.mailbox')));
    expect(page('en', null)).not.toContain(esc(t('en', 'legal.deletion.kept.mailbox')));
  });
  it('in the kept list, after what the business keeps and before the backups', () => {
    const html = page('en', 'privacy@nomi.test');
    const at = (needle: string) => html.indexOf(needle);
    const order = [esc(t('en', 'legal.deletion.kept.elsewhere')), 'DeepSeek', esc(t('en', 'legal.deletion.kept.mailbox')), esc(t('en', 'legal.deletion.kept.backups'))]
      .map(at);
    expect(order.every((p) => p > -1), JSON.stringify(order)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('the live page is drawn with the configured facts, not the defaults', () => {
    expect(read('src/api/web/app.ts')).toMatch(/renderDataDeletion\(localeOf\(req\), deps\.legalContact \?\? null, legalFacts,/);
  });
});


describe('D15 · the deletion page says what D3’s stop line does', () => {
  it('a stop said as "remove me from your list" is answered with the stop line (src/pipeline/turn.ts)', () => {
    expect(read('src/pipeline/turn.ts')).toMatch(/asksOnlyOffAList\(req\.text\)/);
  });
  it('so step 3 says nothing about the deletion is sent, and names the one fixed line that confirms a stop', () => {
    const en = t('en', 'legal.deletion.step3');
    expect(en).toMatch(/^Nomi sends you nothing about the deletion\./);
    expect(en).toMatch(/one fixed line confirms that, and nothing more/);
    expect(en).not.toMatch(/does not write to you about it/);
    const said = { zh: '一句固定的话', ar: 'جملة واحدة ثابتة', es: 'una única frase fija', fr: 'une seule phrase fixe' } as const;
    for (const l of ['zh', 'ar', 'es', 'fr'] as const) expect(t(l, 'legal.deletion.step3'), l).toContain(said[l]);
  });
});
