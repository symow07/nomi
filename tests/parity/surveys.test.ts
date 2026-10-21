import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SURVEY_LOCALES, SURVEY_SIGNED, freeToAsk, surveyFor, surveyScore, surveyText } from '../../src/core/conversation/survey.js';
import { renderSurveys } from '../../src/api/web/surveys.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * S6 (Phase 5, item 20) — how did we do?, the pure parts and the wiring: what counts as an answer, which languages may
 * be asked (signed sentences only — none today), where asking is free, the page in five languages, and where the three
 * pieces sit: due when the order is confirmed, asked by the minute's sweep, answered before any turn — after the hold,
 * so a stopped assistant's buyer still reaches a person. Over Postgres and the worker: tests/integration/surveys.test.ts.
 */
const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');
const at = (h: number) => new Date(Date.UTC(2026, 9, 22, h));

describe('S6 · only a score is an answer', () => {
  it('a number from 1 to 5, in any of the digits buyers type, with at most "/5", 分 or the word for stars; or 1 to 5 stars', () => {
    for (const [t, n] of [['5', 5], [' 4 ', 4], ['3/5', 3], ['５', 5], ['٥', 5], ['۴', 4], ['五', 5], ['4分', 4], ['5 stars', 5], ['1 star', 1],
      ['4 étoiles', 4], ['5 نجوم', 5], ['⭐⭐⭐', 3], ['★★★★★', 5], ['5!', 5], ['2.', 2]] as const) expect(surveyScore(t), t).toBe(n);
  });
  it('anything more is a message: a quantity, a second figure, a sentence, six stars, nothing', () => {
    for (const t of ['5 more pieces please', '50', '1.5', '5000', '3/10', '0', '6', 'five', 'ok', '⭐⭐⭐⭐⭐⭐', '', '5 bags', '4 or 5']) {
      expect(surveyScore(t), t).toBeNull();
    }
  });
});

describe('S6 · asked only in a signed sentence, only where free', () => {
  it('NOBODY HAS SIGNED A SENTENCE YET: until a reader does, in this file, no buyer is asked anything', () => {
    expect(SURVEY_SIGNED).toEqual({});
    for (const l of SURVEY_LOCALES) expect(surveyFor(l, 'Atlas Bags'), l).toBeNull();
  });
  it('a signed sentence is asked in the buyer\'s own language, with the business named; another language is not', () => {
    const signed = { en: surveyText('en'), ar: surveyText('ar') };
    expect(surveyFor('en-GB', ' Atlas  Bags ', signed)).toEqual({ locale: 'en', text: surveyText('en').replace('{business}', 'Atlas Bags') });
    expect(surveyFor('ar', 'Atlas', signed)?.locale).toBe('ar');
    expect(surveyFor('zh', 'Atlas', signed)).toBeNull();
    expect(surveyFor('de', 'Atlas', signed)).toBeNull();
    expect(surveyFor(null, 'Atlas', signed)).toBeNull();
    expect(surveyFor('en', '  ', signed)).toBeNull();
    for (const l of SURVEY_LOCALES) expect(surveyText(l), l).toContain('{business}');
  });
  it('free: a chat channel, inside the buyer\'s 24 hours with an hour to spare; never e-mail, never once the window is shut', () => {
    expect(freeToAsk('whatsapp', at(0), at(22))).toBe(true);
    expect(freeToAsk('instagram', at(0), at(23))).toBe(true);
    expect(freeToAsk('messenger', at(0), new Date(at(23).getTime() + 1))).toBe(false);
    expect(freeToAsk('whatsapp', at(0), at(25))).toBe(false);
    expect(freeToAsk('whatsapp', null, at(1))).toBe(false);
    expect(freeToAsk('email', at(0), at(1))).toBe(false);
  });
});

describe('S6 · the page, and where it is wired', () => {
  const facts = { on: true, business: 'Atlas Bags', asked: 4, answered: 3, average: 4.3 };
  const answers = [{ conversationId: '00000000-0000-4000-8000-000000000001', buyer: 'Amal', score: 5, answeredAt: at(9) }];
  it('in every language: the owner\'s switch, the languages none of which is ready, the answers; staff see, never switch', () => {
    for (const l of LOCALES) {
      const own = renderSurveys(l, facts, answers, { isOwner: true }, at(12));
      expect(own, l).toContain('action="/app/surveys"');
      expect(own, l).toContain('<bdi>Amal</bdi>');
      expect(own, l).toContain('Atlas Bags');
      expect(own, l).not.toContain('{business}');
      const theirs = renderSurveys(l, facts, answers, { isOwner: false }, at(12));
      expect(theirs, l).not.toContain('<form');
    }
  });
  it('the switch is the owner\'s (going live: it lets the assistant write to buyers alone)', () => {
    const route = src('api/web/app.ts').slice(src('api/web/app.ts').indexOf("app.post('/app/surveys'"));
    expect(route.slice(0, 160)).toContain("ownerOnly(req, reply, 'messaging_activation'");
  });
  it('due when the order is confirmed; asked by the minute\'s sweep; answered before any turn, after the hold', () => {
    expect(src('pipeline/orderProposal.ts')).toMatch(/repos\.conversations\.close\(cid\);[\s\S]{0,200}noteSurveyDue\(tx, input\.businessId, input\.conversationId, now\)/);
    const sweep = /boss\.work<SequenceSweepJob>[\s\S]*?\n {2}\}\);/.exec(src('main.ts'))?.[0] ?? '';
    expect(sweep).toContain('sendDueSurveys(tx, b.value, new Date(), overrides?.surveySigned)');
    const worker = src('worker/main.ts');
    const hold = worker.indexOf('turnHold(tx, businessId.value, conversationId.value)');
    const answer = worker.indexOf('recordSurveyAnswer(tx, businessId.value, conversationId.value');
    const heard = worker.indexOf('const heard = job.data.messageType');
    expect(hold).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(hold);
    expect(heard).toBeGreaterThan(answer);
    // what the sweep queues is automated: the send gate's follow-up rules hold it (never a template, never while stopped)
    expect(src('db/channels.ts')).toMatch(/exists \(select 1 from survey_asks sa where sa\.outbound_id = outbound_messages\.id\)\) as automated/);
  });
});
