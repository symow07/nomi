/**
 * M6 — Commercial readiness: plans as data, subscription lifecycle as a
 * state machine, LLM cost arithmetic for the per-tenant caps and the
 * founder's cost-per-conversation view. Manual payment confirmation by
 * design (WeChat/Alipay/bank + manual invoicing) — no Stripe dependency.
 *
 * PRICE POINTS ARE LAUNCH DEFAULTS — adjust in this one file after the
 * pilot pricing conversation; nothing else hardcodes a number.
 */

export type PlanId = 'trial' | 'standard' | 'pro';

export type Plan = {
  readonly id: PlanId;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly monthlyCny: number;               // 0 = free
  readonly trialDays: number | null;
  readonly conversationsPerMonth: number;    // soft cap → budget throttle
  readonly featuresZh: readonly string[];
};

export const PLANS: readonly Plan[] = [
  {
    id: 'trial', nameZh: '试用期', nameEn: 'Trial',
    monthlyCny: 0, trialDays: 14, conversationsPerMonth: 200,
    featuresZh: ['全部功能', '一个 WhatsApp 号', '14天，不收钱，不绑卡'],
  },
  {
    id: 'standard', nameZh: '标准版', nameEn: 'Standard',
    monthlyCny: 399, trialDays: null, conversationsPerMonth: 1000,
    featuresZh: ['全部功能', '一个 WhatsApp 号', '每月 1000 个询盘', '按你的价格表报价', '夜班接待'],
  },
  {
    id: 'pro', nameZh: '专业版', nameEn: 'Pro',
    monthlyCny: 899, trialDays: null, conversationsPerMonth: 5000,
    featuresZh: ['标准版全部', '每月 5000 个询盘', '多个接待号', '优先支持'],
  },
];

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id)!;

/** ── Subscription lifecycle — small on purpose ──────────────────────────── */

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export type Subscription = {
  readonly planId: PlanId;
  readonly status: SubscriptionStatus;
  readonly startedAt: Date;
  readonly paidThrough: Date | null;         // null while trialing
  readonly trialEndsAt: Date | null;
};

export function startTrial(now: Date): Subscription {
  const trial = planById('trial');
  return {
    planId: 'trial', status: 'trialing', startedAt: now, paidThrough: null,
    trialEndsAt: new Date(now.getTime() + (trial.trialDays ?? 14) * 24 * 3600 * 1000),
  };
}

/** A manually confirmed payment activates one month from max(now, paidThrough). */
export function confirmPayment(s: Subscription, planId: PlanId, now: Date): Subscription {
  const from = s.paidThrough && s.paidThrough > now ? s.paidThrough : now;
  return {
    planId, status: 'active', startedAt: s.startedAt,
    paidThrough: new Date(from.getTime() + 30 * 24 * 3600 * 1000),
    trialEndsAt: s.trialEndsAt,
  };
}

/** Derived status at a point in time — grace period before past_due. */
export const PAYMENT_GRACE_DAYS = 5;

export function subscriptionStatus(s: Subscription, now: Date): SubscriptionStatus {
  if (s.status === 'canceled') return 'canceled';
  if (s.status === 'trialing') {
    return s.trialEndsAt && now > s.trialEndsAt ? 'past_due' : 'trialing';
  }
  if (s.paidThrough) {
    const grace = new Date(s.paidThrough.getTime() + PAYMENT_GRACE_DAYS * 24 * 3600 * 1000);
    return now > grace ? 'past_due' : 'active';
  }
  return s.status;
}

/** ── LLM cost arithmetic (founder view + per-tenant caps) ───────────────── */

/** USD per million tokens — claude-sonnet-4-6 list prices; one place to update. */
export const TOKEN_PRICE_USD = { inputPerM: 3, outputPerM: 15 } as const;

export type UsageRow = {
  readonly conversationId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export function computeCosts(rows: readonly UsageRow[]): {
  readonly totalUsd: number;
  readonly conversations: number;
  readonly usdPerConversation: number;
} {
  const totalUsd = rows.reduce((sum, r) =>
    sum + (r.inputTokens / 1e6) * TOKEN_PRICE_USD.inputPerM
        + (r.outputTokens / 1e6) * TOKEN_PRICE_USD.outputPerM, 0);
  const conversations = new Set(rows.map((r) => r.conversationId)).size;
  return {
    totalUsd,
    conversations,
    usdPerConversation: conversations === 0 ? 0 : totalUsd / conversations,
  };
}
