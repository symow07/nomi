import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { questionKey, suggestionsFrom } from '../../src/core/owner/answerSuggestions.js';
import { renderAnswerSuggestions } from '../../src/api/web/answerSuggestions.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * S5 (Phase 5, item 17) — answers people gave, the pure parts: what makes two questions the same (word matching, in
 * the scripts the buyers write), how they are grouped and ordered, what is never offered, and the page in five
 * languages — the owner decides, staff only see. Over Postgres and the routes: tests/integration/answer-suggestions.test.ts.
 */
const APP = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
const at = (min: number) => new Date(Date.UTC(2026, 9, 22, 9, min));

describe('S5 · the same question, by its words', () => {
  it('order, capitals, accents, punctuation, small words and a plural "s" make no difference', () => {
    const k = questionKey('Do you ship to Dubai?');
    expect(k).toBe('dubai ship');
    expect(questionKey('dubai — do you SHIP there??')).toBe(k);
    expect(questionKey('Ship to DUBAI, do you?')).toBe(k);
    expect(questionKey('Do you ship samples?')).toBe(questionKey('do you ship a sample'));
    expect(questionKey('Livrez-vous à Dubaï ?')).toBe(questionKey('livrez vous a dubai'));
    expect(questionKey('Do you ship to Doha?')).not.toBe(k);
  });

  it('Chinese by pairs of characters, its particles aside; Arabic without its marks, its alef forms one, its article aside', () => {
    expect(questionKey('你们发货到迪拜吗？')).toBe(questionKey('发货到迪拜吗'));
    expect(questionKey('发货到迪拜')).not.toBe(questionKey('发货到多哈'));
    expect(questionKey('هل تشحنون إلى دبي؟')).toBe(questionKey('هل تشحنون الى دبي'));
    expect(questionKey('هل تُشحن العينات؟')).toBe(questionKey('هل تشحن عينات'));
  });

  it('too little to tell is no question', () => {
    for (const q of ['Hi?', 'hello', 'Price?', '?', '谢谢', '']) expect(questionKey(q), q).toBeNull();
  });
});

describe('S5 · grouped, ordered, and what is never offered', () => {
  it('one per question: how many asked, the newest wording and answer; the most asked first, then the newest', () => {
    const s = suggestionsFrom([
      { question: 'Do you ship to Dubai?', answer: 'Yes, 25 days.', at: at(1) },
      { question: 'Can I pay by card?', answer: 'Yes.', at: at(5) },
      { question: 'dubai, do you ship?', answer: 'Yes, by sea, 25 days.', at: at(3) },
    ]);
    expect(s.map((x) => [x.question, x.answer, x.asks])).toEqual([
      ['dubai, do you ship?', 'Yes, by sea, 25 days.', 2],
      ['Can I pay by card?', 'Yes.', 1],
    ]);
  });

  it('never a request for a person or for the buyer\'s data to go, nor an answer promising it is gone, nor one too long', () => {
    expect(suggestionsFrom([
      { question: 'Can I talk to someone about pricing?', answer: 'Hi, this is Amal.', at: at(1) },
      { question: 'Please delete my data from your records.', answer: 'Of course.', at: at(2) },
      { question: 'Old phone number in my profile, can you fix it?', answer: 'Done, I deleted your data.', at: at(3) },
      { question: 'Do you ship to Dubai?', answer: 'x'.repeat(2001), at: at(4) },
      { question: `Do you ship ${'far '.repeat(80)}?`, answer: 'Yes.', at: at(5) },
    ])).toEqual([]);
  });
});

describe('S5 · the page: the owner decides, staff see', () => {
  const row = { key: 'dubai ship', question: 'Do you ship to Dubai?', answer: 'Yes, by sea.', asks: 2, lastAt: at(1) };
  it('in every language: the owner\'s two forms, setting aside asks first; staff see the answer and that the owner decides', () => {
    for (const l of LOCALES) {
      const own = renderAnswerSuggestions(l, [row], { isOwner: true }, at(30));
      expect(own, l).toContain('action="/app/knowledge/answers/teach"');
      expect(own, l).toMatch(/action="\/app\/knowledge\/answers\/dismiss"[\s\S]*data-confirm="[^"]+"/);
      expect(own, l).toContain('<textarea name="content" rows="3" required maxlength="2000" dir="auto">Yes, by sea.</textarea>');
      const theirs = renderAnswerSuggestions(l, [row], { isOwner: false }, at(30));
      expect(theirs, l).not.toContain('<form');
      expect(theirs, l).toContain('Yes, by sea.');
      expect(renderAnswerSuggestions(l, [], { isOwner: true }, at(30)), l).toContain('class="empty"');
    }
  });

  it('both decisions are the owner\'s alone', () => {
    for (const path of ['/app/knowledge/answers/teach', '/app/knowledge/answers/dismiss']) {
      const route = APP.slice(APP.indexOf(`app.post('${path}'`));
      expect(route.slice(0, 200), path).toContain("ownerOnly(req, reply, 'answers_given'");
    }
  });
});
