import type { VisionDescriber } from '../llm/ports.js';
import type { RetrievedProduct, Retriever } from '../retrieval/ports.js';
import type { MediaFetcher } from '../channels/whatsapp/media.js';
import { computeQuote } from '../core/commerce/quote.js';
import type { NegotiationRule, PriceTier, PricingPolicy, Product, Quote } from '../core/types/commerce.js';
import type { ProductId } from '../core/types/ids.js';

/**
 * M4 — Wow #1: buyer photo → catalog match → quote draft, in seconds.
 *
 * Containment holds for photos exactly as for text: the vision model only
 * DESCRIBES what it sees; the match can only be a product retrieval returned
 * from the tenant's own catalog; every number in the quote comes from
 * computeQuote over SQL rows. Uncertainty degrades honestly: ambiguous →
 * ask the buyer which one; nothing close → ask for details; media broken →
 * ask for a resend. All drafts — the owner approves before anything sends.
 */

/** Match confidence: strong top hit with clear daylight to the runner-up. */
export const MATCH_MIN_RELEVANCE = 0.45;
export const MATCH_MIN_MARGIN = 0.12;

export type ImageInquiryResult =
  | {
      readonly kind: 'matched';
      readonly product: RetrievedProduct;
      readonly quote: Quote | null;            // null: quote engine refused (floor/authority)
      readonly quantityFromCaption: boolean;   // false = assumed MOQ
      readonly visionAttributes: readonly string[];
      readonly usage: Usage;
    }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly RetrievedProduct[]; readonly usage: Usage }
  | { readonly kind: 'no_match'; readonly searchText: string; readonly usage: Usage }
  | { readonly kind: 'media_failed'; readonly retryable: boolean; readonly usage: Usage };

type Usage = { llmCalls: number; inputTokens: number; outputTokens: number };

/** "5000 pcs" / "5k" / "2万个" in a caption → quantity. Deterministic. */
export function parseCaptionQuantity(caption: string | null): number | null {
  if (!caption) return null;
  const wan = caption.match(/([\d.]+)\s*万/);
  if (wan?.[1]) return Math.round(Number(wan[1]) * 10_000) || null;
  const k = caption.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (k?.[1]) return Math.round(Number(k[1]) * 1_000) || null;
  const plain = caption.match(/(\d[\d,]{1,8})\s*(?:pcs?|pieces?|units?|个|件|只|套)/i);
  if (plain?.[1]) return Number(plain[1].replace(/,/g, '')) || null;
  return null;
}

export type ImageTurnDeps = {
  readonly media: MediaFetcher;
  readonly vision: VisionDescriber;
  readonly retriever: Pick<Retriever, 'byImageDescription'>;
  /** SQL-backed quote inputs for one product — null when catalog incomplete. */
  loadQuoteInputs(productId: ProductId): Promise<{
    product: Product; tiers: readonly PriceTier[];
    policy: PricingPolicy; rules: readonly NegotiationRule[];
  } | null>;
};

export async function computeImageInquiry(
  deps: ImageTurnDeps,
  input: { readonly mediaId: string; readonly caption: string | null },
): Promise<ImageInquiryResult> {
  const usage: Usage = { llmCalls: 0, inputTokens: 0, outputTokens: 0 };

  const media = await deps.media(input.mediaId);
  if (!media.ok) return { kind: 'media_failed', retryable: media.retryable, usage };

  const seen = await deps.vision.describe({
    imageBase64: media.base64, mediaType: media.mediaType, caption: input.caption,
  });
  usage.llmCalls += 1;
  usage.inputTokens += seen.usage.inputTokens;
  usage.outputTokens += seen.usage.outputTokens;
  if (!seen.searchText) return { kind: 'media_failed', retryable: false, usage };

  const query = [seen.searchText, input.caption ?? ''].join(' ').trim();
  const candidates = await deps.retriever.byImageDescription(query, 5);
  if (candidates.length === 0) {
    return { kind: 'no_match', searchText: seen.searchText, usage };
  }

  const [top, second] = candidates;
  const confident =
    top!.relevance >= MATCH_MIN_RELEVANCE &&
    (second === undefined || top!.relevance - second.relevance >= MATCH_MIN_MARGIN);
  if (!confident) {
    return { kind: 'ambiguous', candidates: candidates.slice(0, 2), usage };
  }

  const inputs = await deps.loadQuoteInputs(top!.productId);
  const captionQty = parseCaptionQuantity(input.caption);
  let quote: Quote | null = null;
  if (inputs) {
    const r = computeQuote({
      product: inputs.product, tiers: inputs.tiers, policy: inputs.policy,
      rules: inputs.rules, quantity: captionQty ?? inputs.product.moq,
    });
    quote = r.ok ? r.value : null;
  }
  return {
    kind: 'matched', product: top!, quote,
    quantityFromCaption: captionQty !== null,
    visionAttributes: seen.attributes, usage,
  };
}
