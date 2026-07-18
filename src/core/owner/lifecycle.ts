import { TERM } from './vocabulary.js';
import type { ArcBeat } from '../ops/arc.js';

/**
 * M8 — The 30-day onboarding sequence (WeChat-first, email fallback).
 * Every message is TRIGGERED by a real arc beat or its absence — nothing
 * fires on a blind timer while the product has nothing to show. If the
 * owner cancels or goes past_due, the sequence stops (tested).
 */

export type LifecycleTrigger =
  | { readonly kind: 'beat_reached'; readonly beat: ArcBeat }
  | { readonly kind: 'beat_missing'; readonly beat: ArcBeat; readonly afterDays: number };

export type LifecycleMessage = {
  readonly id: string;
  readonly trigger: LifecycleTrigger;
  readonly channel: 'wechat' | 'email';
  readonly copyZh: string;              // short, one purpose, no marketing voice
};

export const ONBOARDING_SEQUENCE: readonly LifecycleMessage[] = [
  {
    id: 'welcome', channel: 'wechat',
    trigger: { kind: 'beat_reached', beat: 'minute10_first_draft' },
    copyZh: '第一条就发出去了，好兆头。\n这周让她多练，改她的稿就是在教她。',
  },
  {
    id: 'stalled_setup', channel: 'wechat',
    trigger: { kind: 'beat_missing', beat: 'minute10_first_draft', afterDays: 1 },
    copyZh: '看到你注册了还没走完。\n卡在哪一步了？回我一句，帮你弄好。',
  },
  {
    id: 'first_real_buyer', channel: 'wechat',
    trigger: { kind: 'beat_reached', beat: 'day1_first_real_buyer' },
    copyZh: `第一个真${TERM.buyer}来了。\n她起草，你${TERM.approval}——就照常用。`,
  },
  {
    id: 'no_buyers_yet', channel: 'wechat',
    trigger: { kind: 'beat_missing', beat: 'day1_first_real_buyer', afterDays: 3 },
    copyZh: '还没有买家进来。\n把 WhatsApp 号放到店铺和名片上，来了她就接。',
  },
  {
    id: 'week1_trust', channel: 'wechat',
    trigger: { kind: 'beat_reached', beat: 'week1_trust' },
    copyZh: `第一次${TERM.spotCheck}过了，你的改法也记住了。\n${TERM.jobSheet}里能看到她现在会什么。`,
  },
  {
    id: 'week2_promotion', channel: 'wechat',
    trigger: { kind: 'beat_reached', beat: 'week2_letting_go' },
    copyZh: `有一项工作她做到晋升标准了。\n放不放权你定，随时${TERM.revoke}。`,
  },
  {
    id: 'week2_no_promotion', channel: 'wechat',
    trigger: { kind: 'beat_missing', beat: 'week2_letting_go', afterDays: 18 },
    copyZh: '两周了还没到晋升标准，正常。\n多改几次稿，她学得会快一些。',
  },
  {
    id: 'month1_review', channel: 'wechat',
    trigger: { kind: 'beat_reached', beat: 'month1_renewal_obvious' },
    copyZh: `第一份${TERM.monthlyReview}出来了：\n省了多少时间、学会了多少，都在里面。\n觉得值，就继续。`,
  },
];

export type LifecycleContext = {
  readonly reachedBeats: readonly ArcBeat[];
  readonly daysSinceSignup: number;
  readonly subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled';
  readonly alreadySent: readonly string[];
};

/** Which messages are due now. Canceled/past_due owners hear nothing. */
export function dueLifecycleMessages(ctx: LifecycleContext): readonly LifecycleMessage[] {
  if (ctx.subscriptionStatus === 'canceled' || ctx.subscriptionStatus === 'past_due') return [];
  return ONBOARDING_SEQUENCE.filter((m) => {
    if (ctx.alreadySent.includes(m.id)) return false;
    if (m.trigger.kind === 'beat_reached') return ctx.reachedBeats.includes(m.trigger.beat);
    return !ctx.reachedBeats.includes(m.trigger.beat) && ctx.daysSinceSignup >= m.trigger.afterDays;
  });
}
