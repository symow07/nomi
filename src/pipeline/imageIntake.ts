import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { hybridRetriever } from '../retrieval/hybrid.js';
import type { MediaFetcher } from '../channels/whatsapp/media.js';
import type { VisionDescriber } from '../llm/ports.js';
import type { BusinessId } from '../core/types/ids.js';
import { computeImageInquiry, type ImageTurnDeps, type ImageInquiryResult } from './imageTurn.js';

/**
 * M4.5 — the wiring M4 never got.
 *
 * `imageTurn.ts` was written in M4, tested thoroughly, and imported by nothing
 * but its own test. A buyer sent a photo and she answered from the caption, or
 * from nothing — silently and confidently. That is exactly what M34 stopped for
 * voice notes, still live for pictures; and M26 shipped OUTBOUND photos on top
 * of an inbound path that never ran.
 *
 * This file is the join, in the shape `voiceTurn.ts` established: the pure
 * matching stays in `imageTurn.ts` untouched, and this decides what happens to
 * its verdict. Nothing about `computeImageInquiry` is redesigned — it was never
 * wrong, only unreachable.
 *
 * THE OUTCOMES, and why each lands where it does:
 *
 *   media_failed  REFUSE. The bytes never arrived or the model saw nothing in
 *                 them. There is no third option: an unreadable photo answered
 *                 from its caption is a confident reply to a question we did
 *                 not see.
 *   ambiguous     REFUSE. Two catalogue products are within a hair of each
 *                 other. `MATCH_MIN_MARGIN` exists precisely so she does not
 *                 pick one, and a second retrieval pass downstream must not be
 *                 allowed to overrule the first.
 *   no_match      FORWARD as words. Retrieval found nothing close, so there is
 *                 no product to quote and nothing to invent — she can honestly
 *                 say she does not recognise it, through the ordinary guards.
 *   matched       FORWARD as words. The normal pipeline takes it from here:
 *                 same analyzer, same price rules, same gate.
 *
 * WHAT THE FORWARDED TEXT MAY SAY. The vision model DESCRIBES; it never names a
 * catalogue product (`ports.ts`), and this file must not put words in the
 * buyer's mouth either. So the text carries his caption as his, and the
 * description as a description — marked as a photo, never as something he said.
 */

export type ImageIntakeOutcome =
  | { readonly kind: 'words'; readonly text: string; readonly description: string }
  /** She could not tell what it was. The owner is told; no reply is drafted. */
  | { readonly kind: 'refused'; readonly reason: 'media_failed' | 'ambiguous'; readonly retryable: boolean };

/** How a photo is spoken about in the turn text. Not owner-facing copy. */
const photoLine = (description: string): string => `[photo: ${description}]`;

/**
 * Production `ImageTurnDeps`, assembled so that NO database transaction is held
 * across the network.
 *
 * `computeImageInquiry` needs tenant-scoped retrieval, and retrieval needs a
 * transaction — so the naive wiring would hold one open across a media download
 * and a vision call, which is the very thing M34 was careful to avoid. Instead
 * each database call opens its OWN short transaction: the download and the
 * vision call run with no transaction at all, and retrieval borrows a
 * connection for milliseconds afterwards.
 *
 * This is why `imageTurn.ts` needed no changes. It asked for ports; it never
 * said they had to share a transaction.
 */
export function productionImageDeps(args: {
  readonly media: MediaFetcher;
  readonly vision: VisionDescriber;
  readonly db: Db;
  readonly businessId: BusinessId;
}): ImageTurnDeps {
  const { db, businessId } = args;
  return {
    media: args.media,
    vision: args.vision,
    retriever: {
      byImageDescription: (query, k) =>
        withTenantTx(db, businessId, (tx) => hybridRetriever(tx, businessId).byImageDescription(query, k)),
    },
    loadQuoteInputs: (productId) =>
      withTenantTx(db, businessId, async (tx) => {
        const catalog = tenantRepos(tx, businessId).catalog;
        const product = await catalog.product(productId);
        if (!product) return null;
        const [tiers, policy, rules] = await Promise.all([
          catalog.priceTiers(productId),
          catalog.pricingPolicy(productId),
          catalog.negotiationRules(),
        ]);
        // M29 — no pricing policy means the owner has not stated her rules for
        // this product. Absence is "not answered", never a default, so there is
        // nothing to quote from and the photo match stands on its own.
        if (!policy) return null;
        return { product, tiers, policy, rules };
      }),
  };
}

export function decideImageIntake(
  result: ImageInquiryResult,
  caption: string | null,
): ImageIntakeOutcome {
  switch (result.kind) {
    case 'media_failed':
      return { kind: 'refused', reason: 'media_failed', retryable: result.retryable };
    case 'ambiguous':
      return { kind: 'refused', reason: 'ambiguous', retryable: false };
    case 'no_match': {
      const text = [caption ?? '', photoLine(result.searchText)].filter(Boolean).join('\n').trim();
      return { kind: 'words', text, description: result.searchText };
    }
    case 'matched': {
      // The DESCRIPTION, never the matched product's name: naming it here would
      // hand the model a conclusion the containment rule says retrieval owns.
      const description = result.visionAttributes.join(', ');
      const text = [caption ?? '', photoLine(description)].filter(Boolean).join('\n').trim();
      return { kind: 'words', text, description };
    }
  }
}

/**
 * Fetch, look, decide. Outside the tenant transaction by design — a download
 * and a vision call are seconds of network, and holding a conversation lock
 * across them would serialise every other buyer behind one slow provider.
 */
export async function seeImage(
  deps: { readonly image?: ImageTurnDeps | undefined },
  input: { readonly mediaId: string | null | undefined; readonly caption: string | null },
): Promise<ImageIntakeOutcome> {
  // No vision configured, or a photo with no media id: she cannot see it, and
  // saying nothing about that is the defect. Same posture as `not_configured`
  // for voice notes.
  if (!deps.image || !input.mediaId) {
    return { kind: 'refused', reason: 'media_failed', retryable: false };
  }
  const result = await computeImageInquiry(deps.image, { mediaId: input.mediaId, caption: input.caption });
  return decideImageIntake(result, input.caption);
}

/**
 * The inbound row for a photo. Written either way — a photo she could not read
 * is still a thing the buyer sent, and a row that only exists on success makes
 * "she could not see it" indistinguishable from "he sent nothing".
 */
export async function recordImageMessage(
  tx: Tx,
  conversationId: string,
  messageId: string,
  caption: string | null,
  outcome: ImageIntakeOutcome,
): Promise<void> {
  const seen = outcome.kind === 'words';
  await sql`
    insert into messages
      (conversation_id, external_id, direction, input_type, text_content, ai_analysis, sent_at)
    values
      (${conversationId}, ${messageId}, 'inbound',
       ${caption ? 'image_text' : 'image'},
       ${caption},
       ${seen ? JSON.stringify({ photoDescription: outcome.description }) : null}::jsonb,
       clock_timestamp())
    on conflict do nothing
  `.execute(tx);
}
