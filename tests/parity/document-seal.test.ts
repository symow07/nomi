import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { documentKeyFrom, openDocument, sealDocument } from '../../src/security/documentSeal.js';
import { documentStoresFrom } from '../../src/db/documents.js';
import { deriveKey } from '../../src/security/credentials.js';

/**
 * A4 (0174) — a document at rest is sealed, bound to its workspace and its id; where it lives is a parameter that
 * is read once, at boot, and refused there if it cannot be.
 */
const KEY = deriveKey('a'.repeat(64));
const k1 = documentKeyFrom(KEY, 1);
const BIZ = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const BYTES = Buffer.from('%PDF-1.7 Facture F-2026-0001 Atlas Textiles SARL 1200.50 MAD', 'utf8');

describe('A4 · the seal', () => {
  it('round trip; the sealed bytes do not contain the document', () => {
    const sealed = sealDocument(BYTES, k1, BIZ, DOC);
    expect(sealed.includes(Buffer.from('Atlas Textiles'))).toBe(false);
    expect(sealed.includes(Buffer.from('1200.50'))).toBe(false);
    expect(openDocument(sealed, [k1], BIZ, DOC).equals(BYTES)).toBe(true);
    // a fresh iv each time: the same document never seals to the same bytes
    expect(sealDocument(BYTES, k1, BIZ, DOC).equals(sealed)).toBe(false);
  });
  it('another workspace, another document, a changed byte, another key — each fails to open', () => {
    const sealed = sealDocument(BYTES, k1, BIZ, DOC);
    expect(() => openDocument(sealed, [k1], '33333333-3333-4333-8333-333333333333', DOC)).toThrow();
    expect(() => openDocument(sealed, [k1], BIZ, '44444444-4444-4444-8444-444444444444')).toThrow();
    const tampered = Buffer.from(sealed); tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 1, tampered.length - 1);
    expect(() => openDocument(tampered, [k1], BIZ, DOC)).toThrow();
    expect(() => openDocument(sealed, [documentKeyFrom(deriveKey('b'.repeat(64)), 1)], BIZ, DOC)).toThrow();
    expect(() => openDocument(sealed, [documentKeyFrom(KEY, 2)], BIZ, DOC)).toThrow(/key version 1/);
    expect(() => openDocument(Buffer.from('plain text'), [k1], BIZ, DOC)).toThrow(/not a sealed document/);
  });
  it('the document key is not the credential key', () => {
    expect(k1.key.equals(KEY)).toBe(false);
    expect(documentKeyFrom(KEY, 2).key.equals(k1.key)).toBe(false);
    expect(openDocument(sealDocument(randomBytes(4096), k1, BIZ, DOC), [k1], BIZ, DOC)).toHaveLength(4096);
  });
});

describe('A4 · DOCUMENT_STORES is read at boot, and refused there', () => {
  it('unset: every workspace in this database', () => {
    expect(() => documentStoresFrom({}, KEY)).not.toThrow();
  });
  it('a map that cannot be read stops the boot, by name', () => {
    expect(() => documentStoresFrom({ DOCUMENT_STORES: 'database' }, KEY)).toThrow(/not JSON/);
    expect(() => documentStoresFrom({ DOCUMENT_STORES: '{"Default":"database"}' }, KEY)).toThrow(/"Default" is not a residency name/);
    expect(() => documentStoresFrom({ DOCUMENT_STORES: '{"ma":"s3://bucket"}' }, KEY)).toThrow(/"ma" is "database" or "directory:<absolute path>"/);
    expect(() => documentStoresFrom({ DOCUMENT_STORES: '{"ma":"directory:data/ma"}' }, KEY)).toThrow(/absolute path/);
    expect(() => documentStoresFrom({ DOCUMENT_STORES: '{}' }, KEY)).toThrow(/names no store/);
    expect(() => documentStoresFrom({ DOCUMENT_STORES: '{"default":"database","ma":"directory:/data/ma"}' }, KEY)).not.toThrow();
  });
});
