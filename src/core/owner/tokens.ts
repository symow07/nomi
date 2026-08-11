/**
 * M2 — Design tokens.
 *
 * Today's owner surface is chat text, so today's tokens are TEXT tokens:
 * borders, markers, indents, line budgets, ordering rules. The visual tokens
 * (type scale, colors, spacing, radii, motion) are defined HERE as data, and
 * `cssVariables()` renders them into the shell, so the surface inherits the
 * system instead of redesigning it.
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

/** ── Design tokens (the web surface renders FROM these) ────────────────── */

/**
 * Formerly `PWA_TOKENS`, which was the reason nobody noticed the problem: there
 * is no PWA and there never was, so a name promising a future artifact let the
 * ONE surface that actually ships — the server-rendered command centre — drift
 * away from the system for months. `design-system.test.ts` asserted
 * `sizePx.base >= 16` and passed while the product rendered 15px, because the
 * test read the object rather than the page.
 *
 * These are emitted as CSS custom properties by `cssVariables()` and consumed
 * as `var(--…)` by the shell. Nothing downstream may write a literal colour or
 * size: a value that describes the system must be DERIVED from this file, never
 * transcribed into another one.
 */
export const DESIGN_TOKENS = {
  /** Type scale tuned for 45+ eyes: base 17, generous line height. */
  font: {
    family: `-apple-system, "PingFang SC", "Noto Sans SC", sans-serif`,
    /**
     * The serif voice. Anything a PERSON says is set in this — her drafts, a
     * buyer's quoted words. Sans is what the PRODUCT says: labels, nav, counts,
     * buttons. The distinction is the point; do not use it for emphasis.
     */
    voice: `ui-serif, Georgia, "Songti SC", "Noto Serif SC", "Noto Naskh Arabic", serif`,
    sizePx: { micro: 12, caption: 13, note: 14, small: 15, base: 17, title: 20, numeral: 22, display: 26 },
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
    /**
     * The single accent, derived from `ok` — the same green that means "this
     * went through". One per screen: the primary action, or the active
     * destination, never both competing.
     */
    jade: '#0F7B3E',
    jadeDeep: '#0A5A2C',   // pressed / hover, one step down
    jadeWash: '#EDF4EF',   // a tint to sit behind text, not a fill to shout with
    jadeLine: '#C6DCCE',   // a border that agrees with the wash
    paper: '#FBFAF7',      // a raised sheet: lighter than the page, warmer than white
    paperSunk: '#F0EDE7',  // a recess: inputs, code, anything set INTO the page
    /**
     * A wash and a line for each semantic colour. These exist as TOKENS rather
     * than `color-mix(… 12% …)` in the stylesheet for a product reason: the
     * owner surface bans the `%` character outright (no scores, no
     * percentages-as-performance), and that ban is enforced against rendered
     * HTML — which a CSS percentage trips just as surely as a fake metric.
     */
    okWash: '#E2EFE8',
    okLine: '#B7D7C5',
    warnWash: '#F6E5E3',
    warnLine: '#E9BDBA',
    waitingWash: '#F5E7DD',
    waitingLine: '#E5C3A9',
    highlightWash: '#EFEBDB',
    highlightLine: '#EAE5D1',
  },
  /** M7 dark mode — same semantic keys as `color`, tuned for OLED nights. */
  colorDark: {
    ok: '#4ADE80',
    waiting: '#FBBF24',
    warn: '#F87171',
    highlight: '#FACC15',
    ink: '#F2F1EE',
    inkSecondary: '#A3A29E',
    surface: '#161514',
    surfaceAlt: '#211F1D',
    border: '#33312E',
    jade: '#4ADE80',
    jadeDeep: '#22C55E',
    jadeWash: '#13251B',
    jadeLine: '#1F3E2C',
    paper: '#1C1B19',
    paperSunk: '#100F0E',
    okWash: '#12241A',
    okLine: '#1F3E2C',
    warnWash: '#2A1614',
    warnLine: '#4A211C',
    waitingWash: '#2A1F12',
    waitingLine: '#4A3418',
    highlightWash: '#262112',
    highlightLine: '#43391C',
  },
  spacingPx: [4, 8, 12, 16, 24, 32, 48, 64] as const,
  radiusPx: { card: 12, chip: 999 },
  /**
   * One shadow is a box; three are a surface. Each lift is a contact shadow, a
   * diffuse body, and a hairline that does the work a 1px border used to —
   * which is why cards can drop their border without dissolving into the page.
   */
  shadow: {
    card: '0 1px 3px rgba(0,0,0,0.08)',
    raised: '0 4px 12px rgba(0,0,0,0.10)',
    lift1: '0 1px 1px rgba(26,26,26,0.04), 0 2px 6px rgba(26,26,26,0.05), 0 0 0 1px rgba(26,26,26,0.04)',
    lift2: '0 2px 4px rgba(26,26,26,0.05), 0 10px 24px rgba(26,26,26,0.09), 0 0 0 1px rgba(26,26,26,0.05)',
  },
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

/**
 * M7 — Micro-interaction specs, as data the PWA executes. Every moment is
 * ≤ motionMs.max, skippable, and collapses to instant under reduced-motion.
 * The chat surface has no animation — these exist so the shell inherits the
 * interaction language instead of inventing one.
 */
export const MOTION_SPECS = {
  approveTap:    { durationMs: 200, easing: 'ease-out', skippable: true, description: '发送 button confirms with a settle, card slides away' },
  quoteReveal:   { durationMs: 300, easing: 'ease-out', skippable: true, description: '报价卡 lines appear top-down — the calculator moment' },
  sendFlight:    { durationMs: 250, easing: 'ease-in',  skippable: true, description: 'message lifts toward the thread' },
  statusChange:  { durationMs: 150, easing: 'linear',   skippable: true, description: 'status chip crossfade (学习中→已晋升 etc.)' },
} as const;

/** Reduced-motion: every spec collapses to an instant state change. */
export const REDUCED_MOTION_RULE = 'all MOTION_SPECS durations become 0ms; no element may rely on animation to convey state' as const;

/** M7 desktop keyboard shortcuts — approval flow first, vim-adjacent. */
export const KEYBOARD_SHORTCUTS = {
  approve: 'Enter',
  edit: 'e',
  skip: 'x',
  nextCard: 'j',
  prevCard: 'k',
  search: '/',
} as const;
