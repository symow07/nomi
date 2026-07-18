/**
 * M6 — Onboarding as hiring: five steps, ten minutes, resumable. Pure state
 * machine; storage is one row (migration 0013). Step 5's first approved
 * draft IS the activation metric — instrumented as an event, not a feeling.
 */

export type OnboardStep =
  | 'name_employee'      // 1. name + avatar — instant emotional ownership
  | 'business_basics'    // 2. confirm smart Yiwu defaults, don't fill forms
  | 'catalog_import'     // 3. tolerant import — anything goes in, confirm out
  | 'connect_whatsapp'   // 4. the M3 connect flow
  | 'first_conversation' // 5. simulated buyer → draft → owner taps 发送
  | 'done';

export const ONBOARD_ORDER: readonly OnboardStep[] = [
  'name_employee', 'business_basics', 'catalog_import',
  'connect_whatsapp', 'first_conversation', 'done',
];

/** Smart Yiwu defaults — the owner confirms, never fills. */
export const YIWU_DEFAULTS = {
  currencyDomestic: 'CNY',
  currencyTrade: 'USD',
  timezone: 'Asia/Shanghai',
  incoterms: ['EXW', 'FOB'] as const,
  defaultPort: 'Ningbo',
  workingLanguages: ['zh', 'en', 'ar'] as const,
} as const;

export const EMPLOYEE_AVATARS = ['🧑‍💼', '👩‍💼', '🧕', '👨‍💼', '🦊', '🐼'] as const;

export type OnboardState = {
  readonly step: OnboardStep;
  readonly employeeName: string | null;
  readonly avatar: string | null;
  readonly signupAt: Date;
  readonly productsImported: number;
  readonly whatsappConnected: boolean;
  readonly firstDraftApprovedAt: Date | null;
};

export function initialOnboardState(signupAt: Date): OnboardState {
  return {
    step: 'name_employee', employeeName: null, avatar: null, signupAt,
    productsImported: 0, whatsappConnected: false, firstDraftApprovedAt: null,
  };
}

export type OnboardEvent =
  | { kind: 'named'; employeeName: string; avatar: string }
  | { kind: 'basics_confirmed' }
  | { kind: 'products_confirmed'; count: number }
  | { kind: 'whatsapp_connected' }
  | { kind: 'first_draft_approved'; at: Date };

/** Advance is strictly ordered and idempotent — replaying an event is a no-op. */
export function advanceOnboarding(s: OnboardState, e: OnboardEvent): OnboardState {
  switch (e.kind) {
    case 'named':
      if (s.step !== 'name_employee') return s;
      return { ...s, step: 'business_basics', employeeName: e.employeeName.trim() || null, avatar: e.avatar };
    case 'basics_confirmed':
      return s.step === 'business_basics' ? { ...s, step: 'catalog_import' } : s;
    case 'products_confirmed':
      if (s.step !== 'catalog_import' || e.count < 1) return s;   // no employee without a catalog
      return { ...s, step: 'connect_whatsapp', productsImported: e.count };
    case 'whatsapp_connected':
      return s.step === 'connect_whatsapp'
        ? { ...s, step: 'first_conversation', whatsappConnected: true } : s;
    case 'first_draft_approved':
      if (s.step !== 'first_conversation') return s;
      return { ...s, step: 'done', firstDraftApprovedAt: e.at };
  }
}

/** ── Activation: the minute-10 metric ───────────────────────────────────── */

export const ACTIVATION_TARGET_MS = 10 * 60_000;

export type ActivationStatus =
  | { readonly activated: true; readonly withinTarget: boolean; readonly minutes: number }
  | { readonly activated: false };

export function activationStatus(s: OnboardState): ActivationStatus {
  if (!s.firstDraftApprovedAt) return { activated: false };
  const ms = s.firstDraftApprovedAt.getTime() - s.signupAt.getTime();
  return { activated: true, withinTarget: ms <= ACTIVATION_TARGET_MS, minutes: Math.round(ms / 60_000) };
}

/**
 * Step 5's simulated buyer message — clearly marked simulated, deterministic,
 * uses the owner's own first imported product so the draft feels real.
 */
export function firstConversationScript(productName: string): {
  readonly buyerMessage: string;
  readonly buyerName: string;
} {
  return {
    buyerName: '测试买家',
    buyerMessage: `Hello! Do you make ${productName}? What's the price for 1000 pcs?`,
  };
}
