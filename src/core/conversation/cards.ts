import type { Quote } from '../types/commerce.js';
import { unitZh } from '../owner/vocabulary.js';
import { formatQtyZh } from '../owner/format.js';
import { MARK } from '../owner/tokens.js';
import {
  actionBar, box, buyerHeader, joinLines, joinSections, labeled,
} from '../owner/components.js';

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

/*
 * M34.11 — `renderQuoteCard` and `renderApprovalCard` were deleted here.
 *
 * They were the M1 text cards: a boxed quote and the approval card that wrapped
 * it, both written for a chat interface. api/web/inbox.ts renders the live
 * equivalents from stored rows — the quote line (quantity · unit price · total)
 * in the conversation context, and the draft card with the 发送 / 不回 / 收回
 * actions that post to the one approval path. Neither renderer had a production
 * caller; only `parseOwnerReply` below does, and it is what reads those same
 * wire words back.
 */

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
