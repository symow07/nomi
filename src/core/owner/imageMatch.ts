import { MARK } from './tokens.js';
import { actionBar, buyerHeader, joinLines, joinSections, labeled } from './components.js';

/**
 * M4 — The wow moment, owner side: 买家发图 → 认出了产品 → 报价卡 → 一键发送.
 * Composes the M2 kit and the existing quote card; adds only what a photo
 * inquiry needs. Confidence renders in owner words (很像 / 拿不准), never as
 * a number.
 */

export type ImageApprovalInput = {
  readonly buyerName: string | null;
  readonly buyerCountryHint: string | null;
  readonly isReturning: boolean;
  readonly caption: string | null;
  readonly captionZh: string | null;          // back-translation when caption exists
  readonly matchedNameZh: string;             // product name as the owner knows it
  readonly matchedSku: string;
  readonly quantityFromCaption: boolean;      // false → we assumed MOQ
  readonly draft: string;                     // proposed buyer reply (en/ar)
  readonly draftZh: string;                   // 他看不懂就不能批
  readonly quoteCard: string | null;          // renderQuoteCard output
};

export function renderImageApprovalCard(c: ImageApprovalInput): string {
  const caption = c.caption
    ? joinLines([
        labeled('买家发来一张产品图，写着', c.caption),
        c.captionZh ? `${MARK.translation}${c.captionZh}` : null,
      ])
    : '买家发来一张产品图，没写字';

  const why = joinLines([
    labeled('为什么', '按图认的产品，价格按你的价格表算的'),
    c.quantityFromCaption ? null : `${MARK.warn} 买家没说数量，先按最低起订量报的`,
  ]);

  return joinSections([
    buyerHeader({
      name: c.buyerName,
      countryZh: c.buyerCountryHint,
      tag: c.isReturning ? '老询盘' : '新询盘',
    }),
    caption,
    labeled('认出了', `${c.matchedNameZh}（${c.matchedSku}）`),
    joinLines([
      labeled('我想回', c.draft),
      `${MARK.meaning}${c.draftZh}`,
    ]),
    c.quoteCard,
    why,
    actionBar(),
  ]);
}

/** Buyer-facing drafts for the honest-degradation paths (drafts — owner approves). */
export const IMAGE_FALLBACK_REPLY = {
  /** ambiguous: ask which one — names come from retrieval, never invented. */
  whichOne: (a: string, b: string) =>
    `Thanks for the photo! Is it closer to our ${a} or our ${b}? A quick word and I'll send the exact price.`,
  /** no match in catalog */
  noMatch: () =>
    `Thanks for the photo! Could you tell me a bit more about the size and material you need? I'll check what we can do.`,
  /** media failed */
  resend: () =>
    `Sorry — the photo didn't come through. Could you send it again?`,
} as const;
