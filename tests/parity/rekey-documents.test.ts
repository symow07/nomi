import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { documentKeyFrom, openDocument, sealDocument } from '../../src/security/documentSeal.js';
// @ts-expect-error — a tool helper, plain JS on purpose (the integration job runs tools without a build).
import * as tool from '../../tools/lib/documentSeal.mjs';

/**
 * B0 — the document seal, in the app (src/security/documentSeal.ts) and in the rotation tool (tools/lib/
 * documentSeal.mjs, which runs without a build): each opens what the other sealed, and only with the right key,
 * workspace and document. And mid-rotation the app opens with the previous key, never seals with it.
 */
const bytes = Buffer.from('%PDF-1.7 Facture F-2026-0042 total 1200.50 MAD', 'utf8');
const biz = randomUUID();
const doc = randomUUID();
const keyOf = () => randomBytes(32);

describe('the app and the tool seal documents the same way', () => {
  it('the tool opens what the app sealed, and the app opens what the tool sealed', () => {
    const k = keyOf();
    const app = documentKeyFrom(k, 1);
    const theirs = tool.documentKey(k, 1);
    expect(Buffer.compare(app.key, theirs.key)).toBe(0);
    expect(tool.openDocument(sealDocument(bytes, app, biz, doc), theirs, biz, doc).equals(bytes)).toBe(true);
    expect(openDocument(tool.sealDocument(bytes, theirs, biz, doc), [app], biz, doc).equals(bytes)).toBe(true);
  });

  it('never with the wrong key, workspace or document', () => {
    const k = keyOf();
    const sealed = sealDocument(bytes, documentKeyFrom(k, 1), biz, doc);
    expect(tool.openDocument(sealed, tool.documentKey(keyOf(), 1), biz, doc)).toBeNull();
    expect(tool.openDocument(sealed, tool.documentKey(k, 1), randomUUID(), doc)).toBeNull();
    expect(tool.openDocument(sealed, tool.documentKey(k, 1), biz, randomUUID())).toBeNull();
    expect(tool.openDocument(Buffer.from('not sealed'), tool.documentKey(k, 1), biz, doc)).toBeNull();
  });

  it('mid-rotation the app opens with either key — the current first — and seals only with the one it is given', () => {
    const old = documentKeyFrom(keyOf(), 1);
    const now = documentKeyFrom(keyOf(), 1);
    const before = sealDocument(bytes, old, biz, doc);
    expect(() => openDocument(before, [now], biz, doc)).toThrow();
    expect(openDocument(before, [now, old], biz, doc).equals(bytes)).toBe(true);
    const after = sealDocument(bytes, now, biz, doc);
    expect(() => openDocument(after, [old], biz, doc)).toThrow();
    expect(openDocument(after, [now, old], biz, doc).equals(bytes)).toBe(true);
  });

  it('the tool reads DOCUMENT_STORES as the app does: only the directory stores, by residency', () => {
    expect([...tool.directoryStores(JSON.stringify({ default: 'database', ma: 'directory:/data/ma' }))]).toEqual([['ma', '/data/ma']]);
    expect(tool.directoryStores(undefined).size).toBe(0);
  });
});
