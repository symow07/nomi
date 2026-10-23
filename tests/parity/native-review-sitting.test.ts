import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { proposedSentences } from '../../src/core/conversation/strict.js';
import { greetingText } from '../../src/core/conversation/greeting.js';
import { surveyText, surveyThanksText } from '../../src/core/conversation/survey.js';
import { REEL_NATIVE_REVIEW } from '../../src/api/web/siteReel.js';

/**
 * ONE SITTING, FOUR GATES (the owner, 2026-10-23; docs/NATIVE-REVIEW-UI.md, the section of that date). The four sets
 * that wait on a native reader — the front page, strict mode's starters, the Telegram /start greeting, the survey's
 * question and thank-you — are shown side by side so one reader signs them in one pass. Presentation only: each set
 * keeps its own gate, and the customer-facing three stay word for word. What a reader signs there must be what is
 * sent, so the section quotes the code exactly; and the front page's flag is read by the front page alone.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const doc = readFileSync(`${ROOT}docs/NATIVE-REVIEW-UI.md`, 'utf8');
const SECTION = /## 2026-10-23 — ONE SITTING:[\s\S]*$/.exec(doc)?.[0] ?? '';
const part = (head: string): string => {
  const at = SECTION.indexOf(`\n### ${head}`);
  const next = SECTION.indexOf('\n### ', at + 5);
  return at < 0 ? '' : SECTION.slice(at, next < 0 ? undefined : next);
};
const lines = (s: string) => s.split('\n');
const customerFacing = (l: 'zh' | 'ar' | 'es' | 'fr' | 'en', text: string) => {
  proposedSentences(l).forEach((x, i) => expect(lines(text), `${l} starter ${i + 1}`).toContain(`${i + 1}. ${x}`));
  for (const x of [greetingText(l), surveyText(l), surveyThanksText(l)]) expect(lines(text), l).toContain(`> ${x}`);
};

describe('one sitting: the four sets side by side, each with its own gate', () => {
  it('the section exists, once, and says it merges no gate', () => {
    expect(SECTION).not.toBe('');
    expect(doc.match(/## 2026-10-23 — ONE SITTING:/g)).toHaveLength(1);
    expect(SECTION).toContain('It merges no gate and changes nothing that is');
    expect(SECTION).toMatch(/word for word/);
  });

  for (const l of ['zh', 'ar', 'es', 'fr'] as const) {
    it(`${l}: every front-page line and every customer-facing sentence, exactly as the code has it`, () => {
      const text = part(`${l} — `);
      expect(text, l).not.toBe('');
      const reel = Object.entries(messages[l]).filter(([k]) => k.startsWith('site.reel.'));
      expect(reel.length).toBeGreaterThan(0);
      for (const [k, v] of reel) expect(lines(text), `${l} ${k}`).toContain(`| \`${k}\` | ${v} |`);
      expect(text.match(/^\| `site\.reel\./gm) ?? []).toHaveLength(reel.length);
      expect(text).toContain(`\`REEL_NATIVE_REVIEW.${l}\` = ${REEL_NATIVE_REVIEW[l] ? 'yes' : 'no'}`);
      customerFacing(l, text);
      expect(text).toMatch(new RegExp(`Reviewer \\(${l}\\): ______`));
    });
  }

  it('English: the front page\'s yes is said NOT to cover the customer-facing sentences, which are listed unsigned', () => {
    expect(REEL_NATIVE_REVIEW.en).toBe(true);
    expect(SECTION).toContain('the front page\'s yes does NOT cover the English customer-facing sentences');
    expect(SECTION).toContain('**still unsigned**');
    customerFacing('en', part('en — '));
  });

  it('nothing but the front page reads REEL_NATIVE_REVIEW', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = `${dir}/${f}`;
      return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
    });
    const readers = files(`${ROOT}src`).filter((f) => /REEL_NATIVE_REVIEW|reelReady/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length)).sort();
    expect(readers).toEqual(['src/api/web/app.ts', 'src/api/web/siteReel.ts']);
    const app = readFileSync(`${ROOT}src/api/web/app.ts`, 'utf8');
    expect(app.match(/reelReady\(\)/g)).toHaveLength(1);
  });
});
