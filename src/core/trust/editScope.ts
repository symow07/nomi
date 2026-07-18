/**
 * M5 — Edit learning with honest scope. An owner edit teaches the employee —
 * but only as far as the evidence supports. Nothing generalizes globally by
 * itself: scope is decided by deterministic rules, and anything ambiguous
 * requires the owner's one-tap confirmation before widening.
 *
 * The acknowledgment never overclaims: a one-time edit gets 已按你的修改发送
 * and NOTHING about learning, because nothing was learned.
 */

export type EditScope =
  | 'one_time'          // sent as edited; not remembered
  | 'buyer_specific'    // remembered for THIS buyer only
  | 'product_specific'  // remembered for THIS product
  | 'style'             // phrasing/tone — global, low risk
  | 'policy'            // payment terms, lead time, discounts — needs owner confirm
  | 'global_candidate'; // repeated pattern — proposed global, needs owner confirm

export type EditSignals = {
  /** Owner explicitly scoped it (只对他 / 都这样改 / 以后都用这个说法). */
  readonly ownerMarkedBuyerOnly: boolean;
  readonly ownerMarkedGlobal: boolean;
  /** The edit touched commercially binding content (prices, payment, lead time). */
  readonly touchedCommercialTerms: boolean;
  /** The edit only rephrased — numbers and commitments identical. */
  readonly phrasingOnly: boolean;
  /** The draft concerned one identified product. */
  readonly productBound: boolean;
  /** Same correction seen before (distinct buyers), including this one. */
  readonly timesSeenAcrossBuyers: number;
};

export type EditScopeDecision = {
  readonly scope: EditScope;
  /** Widening beyond the deterministic evidence requires the owner to agree. */
  readonly needsOwnerConfirm: boolean;
};

export function classifyEditScope(s: EditSignals): EditScopeDecision {
  if (s.ownerMarkedBuyerOnly) return { scope: 'buyer_specific', needsOwnerConfirm: false };
  if (s.ownerMarkedGlobal) {
    // Owner said "always" — commercial content still gets one explicit confirm.
    return { scope: s.touchedCommercialTerms ? 'policy' : 'style', needsOwnerConfirm: s.touchedCommercialTerms };
  }
  if (s.touchedCommercialTerms) return { scope: 'policy', needsOwnerConfirm: true };
  if (s.timesSeenAcrossBuyers >= 3) return { scope: 'global_candidate', needsOwnerConfirm: true };
  if (s.phrasingOnly && s.timesSeenAcrossBuyers >= 2) return { scope: 'style', needsOwnerConfirm: false };
  if (s.productBound && s.timesSeenAcrossBuyers >= 2) return { scope: 'product_specific', needsOwnerConfirm: false };
  return { scope: 'one_time', needsOwnerConfirm: false };
}

/** The owner-facing acknowledgment — truthful per scope. */
export function learningAck(
  d: EditScopeDecision,
  ctx: { readonly employeeName: string; readonly buyerName: string | null },
): string {
  const sent = '已按你的修改发送。';
  if (d.needsOwnerConfirm) {
    return `${sent}\n以后都按这个改法吗？回复「都这样」或「就这次」。`;
  }
  switch (d.scope) {
    case 'one_time':
      return sent;   // nothing was learned; say nothing about learning
    case 'buyer_specific':
      return `${sent}\n这次修改只用于${ctx.buyerName ?? '这位买家'}，不影响其他买家。`;
    case 'product_specific':
      return `${sent}\n这个产品的说法已加入培训，下次先用你的表达。`;
    case 'style':
      return `${sent}\n这个说法已加入培训，下次遇到相同情况，${ctx.employeeName}会先用你的表达。`;
    case 'policy':
      return `${sent}\n付款和交期的处理规则已更新。`;
    case 'global_candidate':
      return sent;   // unreachable without confirm, but never overclaim
  }
}
