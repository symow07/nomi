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
  /**
   * Type scale — V1, decided by Symow 2026-09-24 (docs/DESIGN-V1-BRIEF.md §8):
   * base 17 kept for 45+ eyes; the scale is 13/15/17/20/26/34, and the
   * line-height is PER SCRIPT — the one value for three scripts was the rule
   * V1 dropped. `hero` (34) is new and has no use yet; `micro` (12), `note`
   * (14) and `numeral` (22) retired, their uses remapped to a neighbour.
   */
  font: {
    /**
     * ONE ORDER PER LANGUAGE (the design pass, 2026-09-29). The order decides
     * which font draws the characters scripts share — Latin letters, digits,
     * punctuation, quotation marks. The old single stack began with
     * `-apple-system`, which Chrome does not recognise, so it fell to
     * "PingFang SC" and English was drawn by the Chinese font. Now each
     * language leads with its own Noto face (served by the product itself,
     * `src/api/web/type.ts`); a Chinese page leads with the Chinese face so
     * "，。" are drawn full-width by it. `type.test.ts` checks the first family.
     */
    family: {
      en: `"Noto Sans", "Noto Sans SC", "Noto Sans Arabic", system-ui, sans-serif`,
      zh: `"Noto Sans SC", "Noto Sans", system-ui, sans-serif`,
      ar: `"Noto Sans Arabic", "Noto Sans", system-ui, sans-serif`,
    },
    /**
     * The serif voice. Anything a PERSON says is set in this — the assistant's
     * drafts, a customer's quoted words. Sans is what the PRODUCT says: labels,
     * nav, counts, buttons. The distinction is the point; do not use it for
     * emphasis. Arabic speech is Naskh, the hand running text is read in.
     */
    voice: {
      en: `"Noto Serif", "Noto Serif SC", "Noto Naskh Arabic", Georgia, serif`,
      zh: `"Noto Serif SC", "Noto Serif", serif`,
      ar: `"Noto Naskh Arabic", "Noto Serif", serif`,
    },
    sizePx: { caption: 13, small: 15, base: 17, title: 20, display: 26, hero: 34 },
    /** Set from `html[lang]`; the shell writes the locale there on every page. */
    lineHeight: { en: 1.5, zh: 1.7, ar: 1.75, es: 1.5, fr: 1.5 },
    /**
     * CJK never below weight 400 at 15 px and under (decision 1). No weight
     * below 400 exists anywhere today; a test holds that it stays so.
     */
    weightFloor: { min: 400, cjkAtOrBelowPx: 15 },
  },
  /**
   * THE PALETTE — six named values (the design pass, decided 2026-09-29;
   * the plan's §6). The neutrals are graphite at two lighter steps plus one
   * paper; there are no other greys.
   *
   *   ink          Graphite. Type, the primary action as a FILL, focus rings,
   *                the border of the reply box.
   *   inkSecondary Stone. Secondary text, times, past entries, the EDGE of an
   *                outlined button or a field.
   *   border       Rule. Lines between panes and around sheets only — never
   *                the edge of a control (1.3:1 is not an edge you can find).
   *   paper        The ground: the rail, the list, a recess. Leans toward
   *                graphite's hue; not cream.
   *   surface      White: where the owner reads and decides.
   *   assistant    Magenta. The assistant's hand and nothing else: the ✦
   *                beside what it wrote, sent, noted or handed over, and its
   *                name where it is the author. Only ever a TEXT colour —
   *                never a fill, a wash, a border, a link, a heading, the mark
   *                or a button (2.6:1 on graphite, so never on it either).
   *                Its hue stays above 325°, on the raspberry side of true
   *                magenta: `palette.test.ts` holds both.
   *
   * And the three states, kept at their values: ok (Sent — it went, it is
   * on), waiting (it waits for you), warn (Failed — it did not happen, it
   * did not reach them). A state is a dot and a WORD; colour never carries
   * it alone.
   *
   * Retired with this: jade (the accent that also meant "sent" — green now
   * means one thing), highlight (a fourth state colour; its uses became
   * weight), the three warm papers, and the dark palette (never reviewed;
   * decision 3). `palette.test.ts` keeps their values out of the product.
   *
   * CC-20 (2026-09-28) — every state is read as TEXT on its own wash (a pill,
   * a tag), so each pair must reach the 4.5:1 WCAG asks of text that size.
   * `audit-closeout.test.ts` computes every pair.
   */
  color: {
    ok: '#0F7B3E',
    /**
     * THE WARMTH RUN (2026-10-03) — "waiting for you" is magenta. The owner:
     * magenta marks what the assistant did, plus the waiting-for-you signal
     * and today's marker. The amber it had is retired; its shape (○) is what
     * tells it from the assistant's ✦, in greyscale and to any eye.
     */
    waiting: '#A82860',
    warn: '#B42318',
    assistant: '#A82860',
    ink: '#1C1B1F',
    inkSecondary: '#5E5A66',
    surface: '#FFFFFF',
    paper: '#F5F4F6',
    border: '#E2E0E6',
    /**
     * A wash and a line for each state. These exist as TOKENS rather
     * than `color-mix(… 12% …)` in the stylesheet for a product reason: the
     * owner surface bans the `%` character outright (no scores, no
     * percentages-as-performance), and that ban is enforced against rendered
     * HTML — which a CSS percentage trips just as surely as a fake metric.
     */
    okWash: '#E2EFE8',
    okLine: '#B7D7C5',
    warnWash: '#F6E5E3',
    warnLine: '#E9BDBA',
    waitingWash: '#FBEEF3',
    waitingLine: '#EBC3D3',
    /**
     * THE WARMTH RUN — the wash under what the assistant wrote, so a reader
     * new to a conversation tells at a glance what Nomi said from what a
     * person said. A wash, never a frame: no border is drawn in magenta.
     */
    assistantWash: '#FBEEF3',
  },
  spacingPx: [4, 8, 12, 16, 24, 32, 48] as const,   // V1: 64 retired, it was used nowhere
  /**
   * M49 — THE MEASURES. Three, and every width in the product is one of them.
   *
   * Before this there were four unrelated widths on one page: rules running to
   * one edge, prose wrapping at another, inputs at a third, and `main` capped
   * at a fourth. None of them agreed, and the effect was not minimalism — it
   * was the page looking unfinished. Restraint without alignment reads as
   * unfinished, not confident.
   *
   *   column — the content sheet. Everything sits inside it: rules, cards,
   *            forms, prose, buttons. Nothing gets its own arbitrary cap.
   *   prose  — a comfortable reading line WITHIN the column. Narrower is
   *            allowed; a different number is not.
   *   form   — an input is a target, not a canvas. A 40ch box is wide enough
   *            for a price, a rate, a term, and a factory name.
   *
   * `ch` for the inner two on purpose: they follow the type scale, so raising
   * the base size does not silently make a line of prose longer to read.
   */
  measure: { column: '1040px', prose: '62ch', form: '40ch' },
  /**
   * THE WARMTH RUN (2026-10-03) — rounded for warmth. Every corner in the
   * product is one of these: a control (a field, a button, a row), a card, a
   * panel (a sheet, the calendar grid, a grouped menu), a chip, a face.
   */
  radiusPx: { control: 12, card: 16, panel: 20, chip: 999 },
  /**
   * THE WARMTH RUN — customers' faces. A customer the channel gives no photo
   * of (e-mail, WhatsApp) is a coloured initial: one of these eight, chosen by
   * their id so it never changes. None is magenta's (that colour has its
   * jobs), green, amber or red's (the states'); each initial is ≥ 6:1 on its
   * ground (`warmth-faces.test.ts` computes all eight).
   */
  faceTint: [
    { bg: '#DCEBFA', fg: '#1D4E7E' },
    { bg: '#D5EFEC', fg: '#155E57' },
    { bg: '#E3EED6', fg: '#3D5A1C' },
    { bg: '#F4EAD3', fg: '#6B4E12' },
    { bg: '#F9E1D6', fg: '#8A3B17' },
    { bg: '#E7E1F6', fg: '#4B3A84' },
    { bg: '#E1E6EC', fg: '#34495E' },
    { bg: '#DDE3FA', fg: '#2F3F8F' },
  ],
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
  /**
   * PHASE 5 OF THE UI REBUILD (2026-10-02) — THE ONE CURVE. Decelerating: a
   * thing starts moving at once and settles into place, and nothing overshoots
   * or bounces. One curve for everything that moves, so nothing in the product
   * moves two ways. (The owner named the curve as mine to decide.)
   */
  motionEase: 'cubic-bezier(0.2, 0, 0, 1)',
  /**
   * THE WARMTH RUN (2026-10-03) — one exception to the one curve: the profile
   * card and the bottom sheet spring up (a small overshoot, over
   * `motionMs.normal`). Nothing else uses it; under reduced motion nothing moves.
   */
  motionSpring: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
  /**
   * PHASE 4 OF THE UI REBUILD (2026-10-02) — THE FOUR SIGNALS. Colour does
   * these four jobs and no others, the same on every page; graphite does one
   * more, the FILL of the page's one primary action. Each signal has a SHAPE
   * as well as a colour, so it is still said in greyscale, to an eye that
   * does not tell the hues apart, and on a phone in the sun:
   *
   *   ok         ✓  green    it went, it is on, it is done
   *   waiting    ○  amber    it waits for you
   *   failed     ✕  red      it did not happen, it did not reach them
   *   assistant  ✦  magenta  the assistant did this
   *
   * The stylesheet draws the shape before a state's words (`::before`, read
   * from here); a renderer that draws a shape on its own takes it from
   * `signalMark` (layout.ts). `phase4-colour.test.ts` holds every use of a
   * signal colour in the stylesheet to one of these, with its shape.
   */
  signal: { ok: '✓', waiting: '○', failed: '✕', assistant: '✦' },
  /** Status chip: canonical five statuses (vocabulary.STATUS) → semantic color key. */
  statusChip: {
    已处理: 'ok',
    等你审批: 'waiting',
    学习中: 'inkSecondary',
    已晋升: 'ok',
    夜班中: 'inkSecondary',   // highlight retired 2026-09-29: its uses became weight
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
