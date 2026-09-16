import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { proofUrl, mintToken } from '../../src/db/proofs.js';
import { validateEnv } from '../../src/main.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { usd } from '../../src/core/types/money.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * G11 — every quote carries a working link. The turn's side is
 * tests/pipeline/proof-link.test.ts; the buyer's page and the owner's row are
 * proven against Postgres in tests/integration/proof-owner.test.ts.
 */

const src = (rel: string) => readFile(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const NOW = new Date('2026-09-11T08:00:00Z');

describe('G11 · the link is whole, or there is none', () => {
  it('a host and the token — trailing slashes and all', () => {
    expect(proofUrl('https://nomi.example.com', 'abc')).toBe('https://nomi.example.com/p/abc');
    expect(proofUrl('https://nomi.example.com/', 'abc')).toBe('https://nomi.example.com/p/abc');
    expect(proofUrl('https://nomi.example.com///', 'abc')).toBe('https://nomi.example.com/p/abc');
  });

  it('no address is a real state, and it is null — never a bare path', () => {
    for (const base of [null, undefined, '']) expect(proofUrl(base, 'abc')).toBeNull();
  });

  it('the token is 32 unguessable bytes — the page has no other protection', () => {
    const a = mintToken(); const b = mintToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('G11 · the address is checked at boot, not at the first quote', () => {
  const base = {
    DATABASE_URL: 'postgres://x', ANTHROPIC_API_KEY: 'k'.repeat(24),
    WEBHOOK_VERIFY_TOKEN: 'v'.repeat(20), CREDENTIAL_KEY: 'a'.repeat(64),
  };
  const problems = (v: string | undefined) => {
    const r = validateEnv({ ...base, ...(v === undefined ? {} : { PUBLIC_BASE_URL: v }) });
    return r.ok ? [] : r.problems;
  };

  it('https only: a link a buyer forwards must not travel in the clear', () => {
    expect(problems('https://nomi.example.com')).toEqual([]);
    expect(problems('https://nomi.example.com/base')).toEqual([]);
    for (const bad of ['http://nomi.example.com', 'nomi.example.com', 'https://has a space']) {
      expect(problems(bad), bad).toContain('PUBLIC_BASE_URL: invalid shape');
    }
  });

  it('absent is fine — the pilot ran without one, and says so instead of guessing', () => {
    expect(problems(undefined)).toEqual([]);
    const r = validateEnv(base);
    expect(r.ok && r.cfg.PUBLIC_BASE_URL).toBeUndefined();
  });
});

describe('G11 · the owner’s row', () => {
  const detail = (proof: ConversationDetail['proof']): ConversationDetail => ({
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'handled',
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000,
    quote: { unitPrice: usd(0.45), total: usd(2250), quantity: 5000 },
    order: null, messages: [], pendingDraft: null, ownership: 'AI', refusals: [], uncertainSends: [],
    handoffReasons: [], unheardReason: null, lastHumanAction: null, knowledgeUsed: [],
    rate: null, leadTimeBlocked: null, sampleAsked: null, proof,
  });

  it('shows the whole link when there is an address', () => {
    const html = renderConversationDetail(
      detail({ quoteId: 'q1', token: 'tok', url: 'https://nomi.example.com/p/tok' }), 'en', NOW, null);
    expect(html).toContain('https://nomi.example.com/p/tok');
  });

  it('says why there is none, in every locale — never half a link', () => {
    for (const l of LOCALES) {
      const html = renderConversationDetail(detail({ quoteId: 'q1', token: 'tok', url: null }), l, NOW, null);
      expect(html, l).toContain(esc(t(l, 'proof.owner.noAddress')));
      expect(html, l).not.toContain('/p/tok');
    }
  });

  it('the row has styles of its own — it used to inherit none', async () => {
    const inbox = await src('src/api/web/inbox.ts');
    expect(inbox).toMatch(/\.proofrow \{[^}]*gap:/);
    expect(inbox).toMatch(/\.prooflink \{[^}]*overflow-wrap:anywhere/);
  });
});
