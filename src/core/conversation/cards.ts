import type { Quote } from '../types/commerce.js';

/**
 * Owner-facing cards, rendered in Chinese. Pure text (WhatsApp/WeChat native).
 *
 * The calculator reframe (TRUST-PSYCHOLOGY correction #2): computed things
 * look like an INVOICE, composed things look like chat. A quote card must be
 * visually unmistakable as "arithmetic from your price table", never prose.
 */

const money = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 报价卡 — the invoice-style quote card. */
export function renderQuoteCard(q: Quote, productName: string): string {
  const lines = [
    '┌ 报价卡 ─────────────',
    `│ 产品：${productName}`,
    `│ 数量：${q.quantity.value.toLocaleString('en-US')} ${q.quantity.unit}`,
    `│ 单价：$${money(q.unitPriceUsd)} USD`,
    q.discountPct > 0 ? `│ 折扣：${q.discountPct}%（按你的规则）` : null,
    `│ 总价：$${money(q.totalUsd)} USD`,
    q.leadTimeDays !== null ? `│ 交期：${q.leadTimeDays} 天` : null,
    `│ 最低起订：${q.moq.toLocaleString('en-US')}`,
    '│ 地板价检查：✓ 通过',
    q.requiresHuman ? '│ ⚠️ 折扣超出授权，需要你批准' : null,
    '└──────────────────',
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export type ApprovalCardInput = {
  readonly buyerName: string | null;
  readonly buyerCountryHint: string | null;   // from phone prefix, e.g. '阿联酋'
  readonly isReturning: boolean;
  readonly buyerMessage: string;
  readonly buyerMessageZh: string;            // back-translation of buyer text
  readonly draft: string;                     // what we propose to send
  readonly draftZh: string;                   // back-translation — 他看不懂就不能批
  readonly whyLineZh: string;                 // one line. More is homework.
  readonly quoteCard: string | null;          // rendered by renderQuoteCard
};

/**
 * The approval card. Everything the owner needs to decide in ≤10 seconds,
 * in the language he reads. Replies: 发送 / 改：<内容或语音> / 不回
 */
export function renderApprovalCard(c: ApprovalCardInput): string {
  const who = [
    `👤 ${c.buyerName ?? '未知买家'}`,
    c.buyerCountryHint,
    c.isReturning ? '老询盘' : '新询盘',
  ].filter(Boolean).join(' · ');

  const parts = [
    who,
    '',
    `买家说：${c.buyerMessage}`,
    `〔翻译〕${c.buyerMessageZh}`,
    '',
    `我想回：${c.draft}`,
    `〔意思是〕${c.draftZh}`,
    c.quoteCard ? `\n${c.quoteCard}` : null,
    '',
    `为什么：${c.whyLineZh}`,
    '',
    '回复「发送」照发 ｜「改 + 内容」按你的改 ｜「不回」跳过',
  ];
  return parts.filter((p): p is string => p !== null).join('\n');
}

/** Owner reply → command. Deterministic; voice notes are transcribed upstream. */
export type OwnerCommand =
  | { readonly kind: 'approve' }
  | { readonly kind: 'edit'; readonly text: string }
  | { readonly kind: 'skip' }
  | { readonly kind: 'revoke' }               // 收回 — instant demotion
  | { readonly kind: 'unknown'; readonly raw: string };

export function parseOwnerReply(raw: string): OwnerCommand {
  const t = raw.trim();
  if (/^(发送|发|好|ok|OK|✅|同意)$/.test(t)) return { kind: 'approve' };
  if (/^(不回|跳过|算了|忽略)$/.test(t)) return { kind: 'skip' };
  if (/^(收回|停|全部收回|暂停)$/.test(t)) return { kind: 'revoke' };
  const edit = t.match(/^改[:：\s]*([\s\S]+)$/);
  if (edit?.[1]) return { kind: 'edit', text: edit[1].trim() };
  // Any other substantive text on a pending draft = an edit (the owner just
  // typed what he wants said — don't make him learn syntax).
  if (t.length >= 4) return { kind: 'edit', text: t };
  return { kind: 'unknown', raw: t };
}
