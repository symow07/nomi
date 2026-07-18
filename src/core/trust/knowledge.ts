/**
 * M7 — The knowledge counter: accumulation made visible. Counts come from
 * real tables (products, clients, training_examples, learned rules) — the
 * counter can only grow by the employee actually learning something.
 */

export type Knowledge = {
  readonly products: number;
  readonly buyers: number;
  readonly corrections: number;      // owner edits recorded as training
  readonly rules: number;            // scoped rules (product/style/policy)
};

/** 小雅现在认识 340 个产品、85 位买家，记住了你的 210 条改法 */
export function knowledgeLineZh(employeeName: string, k: Knowledge): string {
  const bits = [
    `${k.products} 个产品`,
    `${k.buyers} 位买家`,
  ].join('、');
  const learned = [
    k.corrections > 0 ? `你的 ${k.corrections} 条改法` : null,
    k.rules > 0 ? `${k.rules} 条规矩` : null,
  ].filter(Boolean).join(' 和 ');
  // Two lines on purpose — counts, then what was learned. Phones wrap ugly.
  return `${employeeName}现在认识 ${bits}` + (learned ? `\n记住了${learned}` : '');
}

/** Month-over-month delta — growth is the retention story. */
export function knowledgeDeltaZh(current: Knowledge, previous: Knowledge): string | null {
  const parts = [
    current.products - previous.products > 0 ? `新认识 ${current.products - previous.products} 个产品` : null,
    current.buyers - previous.buyers > 0 ? `${current.buyers - previous.buyers} 位买家` : null,
    current.corrections - previous.corrections > 0 ? `新记住 ${current.corrections - previous.corrections} 条改法` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `这个月：${parts.join('、')}` : null;
}
