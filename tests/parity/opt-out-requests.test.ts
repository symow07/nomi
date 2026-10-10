import { describe, it, expect } from 'vitest';
import { readOptOut, asksForPerson, detectSignals } from '../../src/core/scoring/detect.js';
import { asksToStop, OPT_OUT_REPLIES } from '../../src/core/safety/optOut.js';
import { emptyState } from './fixtures.js';
import { OPT_OUTS, PERSON_REQUESTS, STOP_AND_PERSON, UNSURE, NEITHER, HELD_OUT_OPT_OUTS, HELD_OUT_NEITHER, type Lang } from './opt-out-corpus.js';
import * as person from '../person/person-corpus.js';
import * as deletion from './deletion-corpus.js';

/**
 * 0135 — "stop messaging me" is an opt-out; "let me talk to a person" is a
 * hand-off; anything that blurs the two goes to a person. The corpus is
 * tests/parity/opt-out-corpus.ts; this reads it per group, per language.
 */

const LANGS: readonly Lang[] = ['en', 'zh', 'ar', 'es', 'fr', 'pt'];
const signalsOf = (text: string) => detectSignals({ text, state: emptyState(), analysis: null, unitPrice: null }).map((s) => s.kind);

describe('0135 · opt-outs are caught, in all six languages', () => {
  for (const lang of LANGS) {
    it(`${lang}: every opt-out reads as one, and is the opted_out signal`, () => {
      const missed = OPT_OUTS[lang].filter((t) => readOptOut(t)?.kind !== 'opt_out');
      expect(missed, `missed (${lang})`).toEqual([]);
      for (const t of OPT_OUTS[lang]) expect(signalsOf(t), t).toContain('opted_out');
    });
  }
  it('the held-out rounds stay caught', () => {
    expect(HELD_OUT_OPT_OUTS.filter((t) => readOptOut(t)?.kind !== 'opt_out')).toEqual([]);
  });
  it('the corpus is not thin: informal and dialect forms are there', () => {
    expect(OPT_OUTS.ar.length).toBeGreaterThanOrEqual(40);
    for (const lang of LANGS) expect(OPT_OUTS[lang].length, lang).toBeGreaterThanOrEqual(12);
  });
});

describe('0135 · a request for a person is a hand-off, never an opt-out', () => {
  for (const lang of LANGS) {
    it(`${lang}: "let me talk to a person" hands off at layer 1 and records nothing`, () => {
      for (const t of PERSON_REQUESTS[lang]) {
        expect(readOptOut(t)?.kind, t).not.toBe('opt_out');
        expect(asksForPerson(t), t).toBe(true);
        const kinds = signalsOf(t);
        expect(kinds, t).toContain('human_requested');
        expect(kinds, t).not.toContain('opted_out');
      }
    });
    it(`${lang}: a stop that asks for or names a person, or the machine, goes to a person`, () => {
      for (const [t, why] of STOP_AND_PERSON[lang]) {
        expect(readOptOut(t), `${t} — ${why}`).toEqual(expect.objectContaining({ kind: 'person' }));
        const kinds = signalsOf(t);
        expect(kinds, t).toContain('human_requested');
        expect(kinds, t).not.toContain('opted_out');
      }
    });
  }
  it('a bare word that may mean an order goes to a person', () => {
    for (const [t, why] of UNSURE) {
      expect(readOptOut(t), `${t} — ${why}`).toEqual(expect.objectContaining({ kind: 'person' }));
      expect(signalsOf(t), t).not.toContain('opted_out');
    }
  });
});

describe('0135 · the words, meaning something else, are left alone', () => {
  for (const lang of LANGS) {
    it(`${lang}: nothing is recorded and this check hands nothing over`, () => {
      for (const [t, why] of NEITHER[lang]) {
        expect(asksToStop(t), `${t} — ${why}`).toBeNull();
        expect(signalsOf(t), t).not.toContain('opted_out');
      }
    });
  }

  it("the held-out rounds' ordinary lines stay unread", () => {
    expect(HELD_OUT_NEITHER.filter((t) => asksToStop(t) !== null)).toEqual([]);
  });

  it("no line of the person corpus reads as an opt-out", () => {
    const lines = [
      ...Object.values(person.REQUESTS).flat(),
      ...Object.values(person.OTHER_MEANINGS).flat().map(([t]) => t),
      ...Object.values(person.OWN_SIDE).flat().map(([t]) => t),
      ...Object.values(person.PASSING).flat(),
      ...Object.values(person.DECLINED).flat(),
      ...Object.values(person.ABOUT_THE_ASSISTANT).flat(),
      ...Object.values(person.OPENERS).flat().map(([t]) => t),
    ];
    expect(lines.length).toBeGreaterThan(200);
    expect(lines.filter((t) => readOptOut(t)?.kind === 'opt_out')).toEqual([]);
  });

  it("no passing mention of deleting something reads as an opt-out", () => {
    const lines = Object.values(deletion.NOT_REQUESTS).flat();
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.filter((t) => readOptOut(t)?.kind === 'opt_out')).toEqual([]);
  });
});

describe('0135 · the one line', () => {
  it('is written in all six languages, promises only what is built, and names nobody', () => {
    for (const lang of LANGS) {
      const s = OPT_OUT_REPLIES[lang];
      expect(s.length, lang).toBeGreaterThan(20);
      expect(s, lang).not.toMatch(/\{|\}/);
    }
    // Arabic addresses nobody in a gender: no imperative, no ـكَ / ـكِ agreement words.
    expect(OPT_OUT_REPLIES.ar).not.toMatch(/(?:راسلنا|اكتب|اكتبي|عليك|إليك|لك)(?![ء-ي])/);
  });
});
