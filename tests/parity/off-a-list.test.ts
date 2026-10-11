import { describe, it, expect } from 'vitest';
import { asksOnlyOffAList, asksToStop, OPT_OUT_REPLIES } from '../../src/core/safety/optOut.js';
import { readOptOut } from '../../src/core/scoring/detect.js';
import { asksForDeletion, promisesDeletion } from '../../src/core/safety/deletion.js';
import { OFF_A_LIST, STOP_AND_DELETE, OPT_OUTS, NEITHER } from './opt-out-corpus.js';
import { REQUESTS, NOT_REQUESTS } from './deletion-corpus.js';

/**
 * D3 (the owner, 2026-10-11) — "'remove me from your list' gets the STOP
 * confirmation line, not deletion silence."
 *
 *   · OFF_A_LIST: each is a stop; each the deletion check reads is read as
 *     ONLY off a list, in all six languages.
 *   · STOP_AND_DELETE: a stop that also asks for the buyer's data to go, or
 *     names where it is kept: a deletion still, so the silence stands.
 *   · The line itself promises nothing about the buyer's data.
 */

describe('D3 · off a list: a stop, and only off a list', () => {
  for (const [lang, list] of Object.entries(OFF_A_LIST)) {
    for (const text of list) {
      it(`${lang}: ${JSON.stringify(text)}`, () => {
        expect(asksToStop(text), text).not.toBeNull();
        expect(readOptOut(text)?.kind, text).toBe('opt_out');
        if (asksForDeletion(text)) expect(asksOnlyOffAList(text), text).toBe(true);
      });
    }
  }
  it('every language has one the deletion check also reads, so the line is earned there, not given', () => {
    for (const [lang, list] of Object.entries(OFF_A_LIST)) {
      expect(list.some((t) => asksForDeletion(t) !== null && asksOnlyOffAList(t)), lang).toBe(true);
    }
  });
});

describe('D3 · a stop that asks for the data to go: still a deletion', () => {
  for (const [lang, list] of Object.entries(STOP_AND_DELETE)) {
    for (const text of list) {
      it(`${lang}: ${JSON.stringify(text)}`, () => {
        expect(readOptOut(text)?.kind, text).toBe('opt_out');
        expect(asksForDeletion(text), text).not.toBeNull();
        expect(asksOnlyOffAList(text), text).toBe(false);
      });
    }
  }
});

describe('D3 · nothing else moves', () => {
  it('a message the deletion check does not read is never "only off a list"', () => {
    const others = [...Object.values(NOT_REQUESTS).flat(), ...Object.values(NEITHER).flat().map(([t]) => t)];
    for (const text of others) expect(asksOnlyOffAList(text), text).toBe(false);
  });
  it('a deletion request that is not a stop is never "only off a list"', () => {
    for (const text of Object.values(REQUESTS).flat()) {
      if (asksToStop(text) === null) expect(asksOnlyOffAList(text), text).toBe(false);
    }
  });
  it('the opt-out corpus\'s own "remove me from your list" and «retirez-moi de votre liste» are only off a list', () => {
    const read = Object.values(OPT_OUTS).flat().filter((t) => asksForDeletion(t) !== null);
    expect(read).toEqual(['remove me from your list', 'retirez-moi de votre liste']);
    for (const text of read) expect(asksOnlyOffAList(text), text).toBe(true);
  });
  it('the line promises nothing about the buyer\'s data, in any language', () => {
    for (const [lang, line] of Object.entries(OPT_OUT_REPLIES)) expect(promisesDeletion(line), lang).toBeNull();
  });
});
