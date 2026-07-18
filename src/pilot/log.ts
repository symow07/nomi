import { z } from 'zod';

/**
 * M5 — The Gate A pilot log: every confusion, hesitation, correction,
 * surprise, and trust moment from the first real owner, captured as
 * structured entries and triaged into fixes. Deliberately small — a schema,
 * a sort, a template, a triage view. Not an analytics platform.
 */

export const PILOT_EVENT_KINDS = [
  'did_not_understand_message',
  'asked_term_meaning',
  'could_not_find_action',
  'hesitated_before_approval',
  'rejected_draft',
  'edited_draft',
  'took_over_conversation',
  'misunderstood_authority',
  'expected_missing_behavior',
  'positive_surprise',
  'expressed_trust',
  'asked_for_more_autonomy',
  'asked_about_price',
  'wanted_to_show_someone',
  'felt_too_technical',
  'unnatural_chinese',
  'mobile_layout_issue',
  'unnecessary_notification',
  'missed_important_notification',
] as const;

export const PilotEntry = z.object({
  at: z.coerce.date(),
  owner: z.string().min(1),                       // pilot owner label
  surface: z.string().min(1),                     // 审批卡 / 今日总结 / 对话回看 / 连接 …
  kind: z.enum(PILOT_EVENT_KINDS),
  event: z.string().min(3),                       // exactly what happened
  ownerExpected: z.string().default(''),
  whatHappened: z.string().default(''),
  ownerQuote: z.string().default(''),             // verbatim words when available
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),   // 3 = worst
  trustImpact: z.number().int().min(-2).max(2),   // -2 broke trust … +2 built trust
  suggestedFix: z.string().default(''),
  blocksLaunch: z.boolean().default(false),
  status: z.enum(['new', 'triaged', 'fixing', 'fixed', 'wont_fix']).default('new'),
  linkedTask: z.string().nullable().default(null),
});
export type PilotEntryT = z.infer<typeof PilotEntry>;

/** Triage order: launch blockers → severity → trust damage → oldest first. */
export function triageOrder(entries: readonly PilotEntryT[]): readonly PilotEntryT[] {
  return [...entries].sort((a, b) =>
    Number(b.blocksLaunch) - Number(a.blocksLaunch) ||
    b.severity - a.severity ||
    a.trustImpact - b.trustImpact ||
    a.at.getTime() - b.at.getTime());
}

/** Developer triage view — ops-facing, so English + dense is right here. */
export function renderTriage(entries: readonly PilotEntryT[]): string {
  const open = triageOrder(entries.filter((e) => e.status !== 'fixed' && e.status !== 'wont_fix'));
  const lines = open.map((e) =>
    `${e.blocksLaunch ? '[BLOCKER] ' : ''}S${e.severity} trust:${e.trustImpact >= 0 ? '+' : ''}${e.trustImpact} ` +
    `${e.kind} @ ${e.surface} — ${e.event}` +
    (e.suggestedFix ? ` → ${e.suggestedFix}` : '') +
    (e.linkedTask ? ` (${e.linkedTask})` : ''));
  return [
    `PILOT TRIAGE — ${open.length} open / ${entries.length} total`,
    ...lines,
  ].join('\n');
}

/**
 * The shadowing template — what whoever sits with the owner writes down,
 * fast, in the moment. Chinese because the observer is bilingual and the
 * owner's words must be captured verbatim.
 */
export const OBSERVATION_TEMPLATE_ZH = [
  '【试用观察记录】每条 30 秒内记完：',
  '几点几分 ｜ 在哪个界面',
  '老板做了什么 / 说了什么（原话）',
  '他以为会怎样 ｜ 实际怎样',
  '卡住了吗（几秒）｜ 找人帮忙了吗',
  '情绪：困惑 / 犹豫 / 惊喜 / 信任 / 烦',
  '——不解释、不辩护、不教他，只记录。',
].join('\n');
