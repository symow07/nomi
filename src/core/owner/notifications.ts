import { STATUS, TERM } from './vocabulary.js';

/**
 * M1 — Notification strategy. Spec: push for "needs review", ONE evening
 * digest for everything else. No spam — noise kills trust faster than errors.
 */

export type OwnerEvent =
  | { kind: 'draft_waiting'; buyerName: string; whatZh: string }   // needs review
  | { kind: 'handoff'; buyerName: string }                          // needs a human NOW
  | { kind: 'quote_approval'; buyerName: string }                   // discount over authority
  | { kind: 'message_handled' }
  | { kind: 'night_activity' }
  | { kind: 'hot_lead' }        // informational — the draft itself already pushes
  | { kind: 'learning_note' }
  | { kind: 'order_created' };  // owner tapped the confirmation — he already knows

export type NotifyRoute = 'push_now' | 'evening_digest';

/** The whole policy. Deliberately tiny: if in doubt, it goes in the digest. */
export function notifyRoute(e: OwnerEvent): NotifyRoute {
  switch (e.kind) {
    case 'draft_waiting':
    case 'handoff':
    case 'quote_approval':
      return 'push_now';
    default:
      return 'evening_digest';
  }
}

/** Push copy — short enough to read on a lock screen. */
export function renderPush(e: OwnerEvent, employeeName: string): string | null {
  switch (e.kind) {
    case 'draft_waiting':
      return `${e.buyerName} ${e.whatZh}，${STATUS.waitingForYou}`;
    case 'quote_approval':
      return `${e.buyerName} 的${TERM.quote}折扣超了你定的权限，${STATUS.waitingForYou}`;
    case 'handoff':
      return `${e.buyerName} 想找真人谈，${employeeName}已暂停回复，等你接手`;
    default:
      return null; // digest-only events never render a push
  }
}

/**
 * Owner-facing problem copy (errors, in software terms — but never in
 * software language). Pattern: what happened → what the employee is doing →
 * what the owner should do (often: nothing).
 */
export const OWNER_PROBLEM = {
  whatsappReconnect: (employeeName: string) =>
    `WhatsApp 需要重新登录。${employeeName}收不到新消息了——点这里重新连接，两分钟搞定。`,
  sendDelayed: (buyerName: string) =>
    `给 ${buyerName} 的消息暂时没发出去，正在自动重试。不用你操作，发出去了会告诉你。`,
  needManualReply: (buyerName: string, employeeName: string) =>
    `${employeeName}暂时没法回复 ${buyerName}，建议你先手动回一句，稍后它会恢复正常。`,
} as const;
