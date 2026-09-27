import { describe, it, expect } from 'vitest';
import { asksForDeletion, promisesDeletion } from '../../src/core/safety/deletion.js';
import { REQUESTS, NOT_REQUESTS, PROMISES, NOT_PROMISES } from './deletion-corpus.js';

/**
 * A buyer who asks for their data to be deleted is answered by a person; a
 * buyer who merely mentions deleting something is answered as usual
 * (src/core/safety/deletion.ts, decided by the owner 2026-09-27).
 *
 * The NOT lists are the point of this file: the owner asked for them to be
 * reported. Each is a real way a buyer uses a deletion word without asking for
 * their data to go — a line, a logo, an item, an order, a photo sent by
 * mistake, an address typed wrong — and each must reach the assistant as a
 * normal message. The traps the patterns were narrowed for are marked.
 */

describe('layer 1 — a buyer asking for their data to be deleted', () => {
  for (const [lang, list] of Object.entries(REQUESTS)) {
    for (const text of list) {
      it(`${lang}: hands off — ${JSON.stringify(text)}`, () => {
        expect(asksForDeletion(text), text).not.toBeNull();
      });
    }
  }
});

describe('layer 1 — a passing mention does NOT hand off', () => {
  for (const [lang, list] of Object.entries(NOT_REQUESTS)) {
    for (const text of list) {
      it(`${lang}: answered as usual — ${JSON.stringify(text)}`, () => {
        expect(asksForDeletion(text), `${text} → matched ${asksForDeletion(text)}`).toBeNull();
      });
    }
  }
});

describe('layer 2 — a reply that promises a deletion is caught', () => {
  for (const reply of PROMISES) {
    it(`caught — ${JSON.stringify(reply)}`, () => {
      expect(promisesDeletion(reply), reply).not.toBeNull();
    });
  }
  for (const reply of NOT_PROMISES) {
    it(`passes — ${JSON.stringify(reply)}`, () => {
      expect(promisesDeletion(reply), `${reply} → matched ${promisesDeletion(reply)}`).toBeNull();
    });
  }
});

describe('the corpus covers what the owner asked for', () => {
  it('each of the owner\'s three languages has requests and passing mentions', () => {
    for (const lang of ['en', 'zh', 'ar']) {
      expect(REQUESTS[lang]!.length, lang).toBeGreaterThanOrEqual(8);
      expect(NOT_REQUESTS[lang]!.length, lang).toBeGreaterThanOrEqual(8);
    }
  });
});
