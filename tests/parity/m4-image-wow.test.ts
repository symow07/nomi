import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import {
  computeImageInquiry, parseCaptionQuantity, MATCH_MIN_RELEVANCE,
  type ImageTurnDeps,
} from '../../src/pipeline/imageTurn.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { renderDemoScript, demoSeedSql, DEMO_PRODUCTS, DEMO_BUYERS, DEMO_CONVERSATIONS } from '../../src/demo/factory.js';
import { whatsappSimulator } from '../../src/channels/whatsapp/simulator.js';
import { whatsappMediaFetcher } from '../../src/channels/whatsapp/media.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';
import { BUDGET } from '../../src/core/owner/tokens.js';
import { product, tiers, policy } from './fixtures.js';
import type { RetrievedProduct } from '../../src/retrieval/ports.js';
import type { ProductId } from '../../src/core/types/ids.js';

/* ── Fixtures ────────────────────────────────────────────────────────────── */
const PID = product().id;
const retrieved = (over: Partial<RetrievedProduct> = {}): RetrievedProduct => ({
  productId: PID, sku: 'ZX-100', name: 'Canvas Tote Bag', category: 'bags',
  moq: 1000, relevance: 0.7, matchedVia: 'both', ...over,
});

const okMedia = async () => ({ ok: true as const, base64: 'aGVsbG8=', mediaType: 'image/jpeg' as const });
const okVision = {
  describe: async () => ({
    searchText: 'canvas tote bag natural cotton', attributes: ['fabric', 'natural color'],
    promptVersion: 'v', modelId: 'm', usage: { inputTokens: 100, outputTokens: 20 },
  }),
};

const deps = (over: Partial<ImageTurnDeps> = {}): ImageTurnDeps => ({
  media: okMedia,
  vision: okVision,
  retriever: { byImageDescription: async () => [retrieved()] },
  loadQuoteInputs: async (_id: ProductId) =>
    ({ product: product(), tiers: tiers(), policy: policy(), rules: [] }),
  ...over,
});

/* ── Caption quantity parsing (deterministic — no LLM) ───────────────────── */
describe('M4 · caption quantity', () => {
  it.each([
    ['need 5000 pcs like this', 5000],
    ['5,000 pieces', 5000],
    ['can you do 5k', 5000],
    ['要2万个', 20000],
    ['1.5万 件', 15000],
    ['500 units please', 500],
    ['how much?', null],
    [null, null],
  ])('%s → %s', (caption, want) => {
    expect(parseCaptionQuantity(caption)).toBe(want);
  });
});

/* ── The wow pipeline: photo → match → quote ─────────────────────────────── */
describe('M4 · image inquiry decisions', () => {
  it('confident match + caption quantity → quote from SQL, one vision call', async () => {
    const r = await computeImageInquiry(deps(), { mediaId: 'm1', caption: 'need 5000 pcs' });
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.product.sku).toBe('ZX-100');
      expect(r.quantityFromCaption).toBe(true);
      expect(r.quote?.quantity.value).toBe(5000);
      expect(r.usage.llmCalls).toBe(1);          // vision only — everything else is SQL
    }
  });

  it('no caption quantity → quotes at MOQ and says so', async () => {
    const r = await computeImageInquiry(deps(), { mediaId: 'm1', caption: null });
    if (r.kind === 'matched') {
      expect(r.quantityFromCaption).toBe(false);
      expect(r.quote?.quantity.value).toBe(product().moq);
    } else expect.unreachable();
  });

  it('close scores → ambiguous with BOTH candidates from retrieval (never guesses)', async () => {
    const r = await computeImageInquiry(deps({
      retriever: { byImageDescription: async () => [
        retrieved({ relevance: 0.5 }), retrieved({ sku: 'ZX-800', relevance: 0.45 }),
      ] },
    }), { mediaId: 'm1', caption: null });
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.map((c) => c.sku)).toEqual(['ZX-100', 'ZX-800']);
  });

  it('weak top score → ambiguous even alone; empty retrieval → no_match', async () => {
    const weak = await computeImageInquiry(deps({
      retriever: { byImageDescription: async () => [retrieved({ relevance: MATCH_MIN_RELEVANCE - 0.01 })] },
    }), { mediaId: 'm1', caption: null });
    expect(weak.kind).toBe('ambiguous');

    const none = await computeImageInquiry(deps({
      retriever: { byImageDescription: async () => [] },
    }), { mediaId: 'm1', caption: null });
    expect(none.kind).toBe('no_match');
  });

  it('media failure and unusable image degrade honestly', async () => {
    const broken = await computeImageInquiry(deps({
      media: async () => ({ ok: false, retryable: true, error: 'x' }),
    }), { mediaId: 'm1', caption: null });
    expect(broken).toMatchObject({ kind: 'media_failed', retryable: true });

    const blurry = await computeImageInquiry(deps({
      vision: { describe: async () => ({ searchText: '', attributes: [], promptVersion: 'v', modelId: 'm', usage: { inputTokens: 1, outputTokens: 1 } }) },
    }), { mediaId: 'm1', caption: null });
    expect(blurry).toMatchObject({ kind: 'media_failed', retryable: false });
  });

  it('quote engine refusal (below floor) still matches — owner decides', async () => {
    const r = await computeImageInquiry(deps({
      loadQuoteInputs: async () => ({
        product: product(), tiers: [{ ...tiers()[0]!, unitPrice: usd(0.01) }], policy: policy(), rules: [],
      }),
    }), { mediaId: 'm1', caption: null });
    if (r.kind === 'matched') expect(r.quote).toBeNull();
    else expect.unreachable();
  });
});

/*
 * M34.8 — the 'image approval card' block was deleted with
 * src/core/owner/imageMatch.js, the M4 text card. The live owner surface for a
 * photo inquiry is api/web/inbox.ts, which renders the draft and its refusal
 * from stored rows; its rules are asserted in refusals.test.ts and
 * owner-language.test.ts against what that page actually renders.
 */

/* ── Media fetcher against the wire shape ────────────────────────────────── */
describe('M4 · media download', () => {
  const fetcher = (metaStatus: number, mime = 'image/jpeg', binStatus = 200) =>
    whatsappMediaFetcher({
      baseUrl: 'https://sim', apiKey: 'k',
      fetchImpl: async (url: string) => {
        if (url === 'https://sim/media123') {
          return { status: metaStatus, text: async () => JSON.stringify({ url: 'https://sim/bin', mime_type: mime }) };
        }
        return { status: binStatus, text: async () => '',
          arrayBuffer: async () => new TextEncoder().encode('IMG').buffer as ArrayBuffer };
      },
    });

  it('two-step fetch → base64 + media type', async () => {
    const r = await fetcher(200)('media123');
    expect(r).toEqual({ ok: true, base64: Buffer.from('IMG').toString('base64'), mediaType: 'image/jpeg' });
  });

  it('expired media (404) is permanent; 5xx retryable; unsupported mime permanent', async () => {
    expect(await fetcher(404)('media123')).toMatchObject({ ok: false, retryable: false });
    expect(await fetcher(500)('media123')).toMatchObject({ ok: false, retryable: true });
    expect(await fetcher(200, 'video/mp4')('media123')).toMatchObject({ ok: false, retryable: false });
  });

  it('simulator image webhook carries the media id end to end', () => {
    const sim = whatsappSimulator();
    const w = sim.inboundImage({ caption: 'need 5000 pcs' });
    const events = sim.adapter.parseWebhook(w.payload);
    expect(events[0]).toMatchObject({ kind: 'message', messageType: 'image', text: 'need 5000 pcs' });
    if (events[0]!.kind === 'message') expect(events[0]!.mediaId).toMatch(/^sim_media_/);
  });
});

/* ── Demo factory ────────────────────────────────────────────────────────── */
describe('M4 · demo factory', () => {
  it('is deterministic and fully populated', () => {
    expect(demoSeedSql()).toBe(demoSeedSql());
    expect(DEMO_PRODUCTS).toHaveLength(12);
    expect(DEMO_BUYERS).toHaveLength(6);
    expect(DEMO_CONVERSATIONS).toHaveLength(5);
    for (const p of DEMO_PRODUCTS) {
      expect(p.tiers.length).toBeGreaterThanOrEqual(3);
      expect(p.floor.amount).toBeLessThan(p.tiers.at(-1)![1]);   // floor below best tier
      expect(p.aliases.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('seed SQL is idempotent by construction and references consistent skus', () => {
    const sql = demoSeedSql();
    const inserts = sql.split('\n').filter((l) => l.startsWith('insert into'));
    expect(inserts.length).toBeGreaterThan(50);
    expect(sql.match(/on conflict/g)!.length).toBeGreaterThanOrEqual(inserts.length);
    for (const c of DEMO_CONVERSATIONS) {
      if (c.productSku) expect(DEMO_PRODUCTS.some((p) => p.sku === c.productSku), c.productSku).toBe(true);
    }
  });

  it('no real-looking secrets in seed or script', () => {
    expect(demoSeedSql()).not.toMatch(/D360|api[_-]?key|Bearer/i);
    expect(renderDemoScript()).toContain('演示');
  });
});
