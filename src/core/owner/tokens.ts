/**
 * M2 — Design tokens.
 *
 * Today's owner surface is chat text, so today's tokens are TEXT tokens:
 * borders, markers, indents, line budgets, ordering rules. The future PWA
 * tokens (type scale, colors, spacing, radii, motion) are defined HERE as
 * data, so the shell inherits the system instead of redesigning it.
 *
 * Rule: no renderer draws a border, picks a marker, or decides a budget
 * on its own. Everything visual comes from this file.
 */

/** ── Text tokens (the live surface) ────────────────────────────────────── */

export const BOX = {
  top: (title: string) => `┌ ${title} ${'─'.repeat(Math.max(2, 20 - title.length * 2))}`,
  side: '│ ',
  bottom: `└${'─'.repeat(20)}`,
} as const;

/** Semantic markers — the "colors" of a text UI. One meaning each. */
export const MARK = {
  ok: '✓',          // a check that passed
  warn: '⚠️',       // needs the owner's judgment
  star: '⭐',        // the day's highlight
  person: '👤',      // buyer context header
  translation: '〔翻译〕',   // buyer's words, in Chinese
  meaning: '〔意思是〕',     // our draft's meaning, in Chinese
  meaningShort: '〔意思〕',  // thread view — tighter lines
} as const;

/** Spacing: the full-width indent for continuation lines; blank line = section. */
export const INDENT = '　';

/** Line budgets (thumb-perfect, enforced by tests). */
export const BUDGET = {
  cardLines: 24,        // approval card incl. quote box
  digestLines: 16,
  pushColumns: 60,      // single line
  lineColumns: 48,      // any authored line, CJK = 2 columns
  conversationTail: 8,  // messages shown before "earlier omitted"
} as const;

/** Canonical section order for any owner card. Consistency IS the design. */
export const CARD_ORDER = [
  'who',        // 👤 buyer context
  'what',       // their message + translation
  'proposal',   // our draft + meaning
  'computed',   // boxed facts (报价卡) — calculator visuals, never prose
  'why',        // one line
  'actions',    // reply words
] as const;

/** ── PWA tokens (inherited later, defined now) ─────────────────────────── */

export const PWA_TOKENS = {
  /** Type scale tuned for 45+ eyes: base 17, generous line height. */
  font: {
    family: `-apple-system, "PingFang SC", "Noto Sans SC", sans-serif`,
    sizePx: { base: 17, small: 15, title: 20, numeral: 22 },
    lineHeight: 1.6,
  },
  /** Semantic colors — mirror the text markers one-to-one. */
  color: {
    ok: '#0F7B3E',        // MARK.ok
    waiting: '#B45309',   // 等你审批
    warn: '#B42318',      // MARK.warn
    highlight: '#8A6D00', // MARK.star
    ink: '#1A1A1A',
    inkSecondary: '#5C5C5C',
    surface: '#FFFFFF',
    surfaceAlt: '#F6F5F2',
    border: '#E4E2DD',
  },
  spacingPx: [4, 8, 12, 16, 24, 32] as const,
  radiusPx: { card: 12, chip: 999 },
  shadow: { card: '0 1px 3px rgba(0,0,0,0.08)', raised: '0 4px 12px rgba(0,0,0,0.10)' },
  motionMs: { fast: 120, normal: 200, max: 300 },  // spec: ≤300ms, skippable
  /** Status chip: canonical five statuses (vocabulary.STATUS) → semantic color key. */
  statusChip: {
    已处理: 'ok',
    等你审批: 'waiting',
    学习中: 'inkSecondary',
    已晋升: 'ok',
    夜班中: 'highlight',
  },
} as const;
