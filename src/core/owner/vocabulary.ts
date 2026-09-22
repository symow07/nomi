/**
 * M1 — The locked product vocabulary. 简体中文, owner-facing.
 *
 * ONE canonical term per concept. No synonyms drifting across surfaces: every
 * owner-facing string imports from here; tests enforce that banned synonyms
 * and technical vocabulary never reach an owner surface.
 *
 * Register: a competent, respectful HR manager talking about an employee.
 * Never software talk. Never AI talk.
 */

/** Canonical terms — the glossary. Do not add synonyms; change here or nowhere. */
export const TERM = {
  employee: '员工',          // the assistant. Personalized with the owner's chosen name.
  approval: '审批',          // the act of reviewing a draft
  draft: '草稿',
  nightShift: '夜班',
  promotion: '晋升',
  demotion: '退回试用',      // demotion = back to probation, never "downgrade"
  spotCheck: '抽查',
  repair: '修复',
  revoke: '收回',
  inquiry: '询盘',
  quote: '报价',
  order: '订单',
  buyer: '买家',
  vip: '老客户',
  probation: '试用期',
  jobSheet: '工作职责表',
  personnelFile: '员工档案',
  dailySummary: '今日总结',
  weeklyReport: '员工周报',
  monthlyReview: '员工月报',
  handled: '已处理',
} as const;

/**
 * Status language — the five canonical states (spec M1). Everything an owner
 * sees about work-in-flight maps to exactly one of these.
 */
export const STATUS = {
  handled: '已处理',
  waitingForYou: '等你审批',
  learning: '学习中',        // capability in draft mode
  promoted: '已晋升',        // capability in auto mode
  onNightShift: '夜班中',    // auto right now via the night window
} as const;
export type OwnerStatus = keyof typeof STATUS;

/** Capability names as the owner reads them. */
export const CAPABILITY_ZH: Record<string, string> = {
  greet: '接待问候',
  qualify: '了解需求',
  recommend: '推荐产品',
  quote: '报价',
  negotiate: '谈价',
  confirm_order: '确认订单',
  follow_up: '跟进客户',
};

/** Units as the owner reads them (catalog stores trade units). */
export const UNIT_ZH: Record<string, string> = {
  pcs: '个',
  sets: '套',
  pairs: '双',
  boxes: '箱',
  cartons: '箱',
  meters: '米',
  kg: '公斤',
};
export const unitZh = (unit: string): string => UNIT_ZH[unit] ?? unit;

/**
 * Banned on every owner-facing surface (spec permanent rule 3 + M1).
 * Tests render every surface and assert none of these appear.
 */
export const BANNED_OWNER_TERMS: readonly string[] = [
  // technical vocabulary
  'model', 'token', 'prompt', 'API', 'webhook', 'LLM', 'AI', 'latency',
  'confidence', 'database', 'error code', 'null', 'undefined', 'timeout',
  'sync', 'server', 'endpoint', 'JSON', 'UUID',
  // zh technical equivalents
  '模型', '令牌', '提示词', '接口', '数据库', '服务器', '置信度', '人工智能',
  // synonym drift (the glossary's enemies)
  '审核',   // use 审批
  '升级',   // use 晋升
  '机器人', // it is an employee, never a bot
  '系统',   // "the system" is software talk; the employee has a name
];

/**
 * The strings that MUST say it, and why the ban does not reach them.
 *
 * `BANNED_OWNER_TERMS` bans "AI" because an owner should never be handed
 * software talk in place of a plain sentence about her own business. That rule
 * is about vocabulary. These strings are about a fact — and the fact is that a
 * machine drafted the reply, which the reader is entitled to know and which no
 * plainer word states. Two surfaces need it:
 *
 *   - the privacy page, which tells whoever reads it what is drafting the
 *     replies and that some may be sent without a person seeing them first;
 *   - the disclosure a buyer receives on the first message of a conversation
 *     that will be answered without anyone approving it.
 *
 * Both are read by a BUYER, not by the owner, which is what makes the ban
 * inapplicable rather than merely inconvenient. Nothing else is exempt: if a
 * new string needs to appear here, that is the moment to ask whether the owner
 * is being told about software when she asked about her business.
 *
 * A key is listed by its full name so the exemption cannot spread by prefix.
 */
export const HONEST_ABOUT_AI_KEYS: readonly string[] = [
  'legal.privacy.ai',
];

/** Map a capability's autonomy state to the canonical status the owner sees. */
export function capabilityStatus(
  mode: 'draft' | 'auto',
  onNightWindowNow: boolean,
): (typeof STATUS)[OwnerStatus] {
  if (mode === 'draft') return STATUS.learning;
  return onNightWindowNow ? STATUS.onNightShift : STATUS.promoted;
}
