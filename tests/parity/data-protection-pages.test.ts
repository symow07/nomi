import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

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
