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
   * THE PALETTE — warm neutrals, ONE magenta family in three shades, three
   * states (the identity system, the owner, 2026-10-04; it supersedes the
   * warmth pass's "magenta for meaning only").
   *
   * The owner: "Magenta becomes Nomi's SIGNATURE colour, used generously for
   * brand identity the way Claude uses orange … Because colour can no longer
   * also be the scarce meaning-marker, MEANING now moves to SHADE plus SHAPE,
   * not hue alone." So magenta is three shades, a step of about 10 L* apart,
   * and each meaning has a SHAPE that says it with the colour removed:
   *
   *   brand        THE SIGNATURE (L* 34). Identity, everywhere you can press or
   *                go: the ordinary primary act as a fill (Save, Add, Connect,
   *                Next), a door's words and every chevron, an underline under a
   *                link, the focus ring, the selection, a checked control, the
   *                tab or row you are on, today's date, and the mark. Its shape
   *                is the thing itself: a button, a door's ›, an underline.
   *   needs        DEEP (L* 24). Something waits for the owner. Its shape is the
   *                NEEDS DOT: a solid disc, drawn (never a font's glyph), before
   *                the words of every waiting thing — the waiting signal, the
   *                pills, Today's band, the card's flag — and, white, before
   *                the word of the one act that answers it (`.btn.send.needs`:
   *                Send on a reply waiting for review, Confirm on an order
   *                waiting for the tap, Reply in a conversation handed to you),
   *                which is the deep FILL; the rail's count is the same fill.
   *                Solid = a customer waits; the OPEN ring ○ in stone is a
   *                chore (`chore`). Never a border, a ring or an underline.
   *   assistant    LIGHT (L* 44). Nomi did this. Its shape is the NAME TAG: its
   *                wash as the ground, its light words, a chip — beside what it
   *                wrote (`.as-tag`) — and its replies sit on the same wash with
   *                no hairline (a person's keep theirs). Only ever words on its
   *                wash or on a light ground; the wash is only ever a ground.
   *
   * In greyscale the three keep their order (deep darkest, light lightest) and
   * their shapes: a dark disc or a dark fill with a white disc is "needs you";
   * a pale tag is "the assistant"; a fill without a disc, an underline or a
   * chevron is plain brand. `warmth-pass.test.ts` computes every pair;
   * `warmth-magenta.test.ts` holds where each may draw an edge (only the brand,
   * and only a focus ring, an underline or the edge of what you are on).
   *
   * The neutrals lean warm (hue near 70–85 in CIELAB), never cream:
   *   ink          A warm near-black. Type and headings, the secondary
   *                button's words, the reply box's border, a wordmark.
   *   inkSecondary Warm stone. Secondary text, times, past entries, the EDGE of
   *                an outlined button or a field, a chore's ring. 4.5:1 or
   *                better on every ground it sits on.
   *   border       A warm rule. Lines between rows and panes — never the edge
   *                of a control.
   *   paper        A soft warm off-white: the page, the rail, a recess.
   *   surface      A white with warmth in it: cards, where the owner reads and
   *                decides. A step lighter than paper; the shadows do the rest.
   *   sand         THE ONE WARM SUPPORTING TONE (the owner allowed one, if the
   *                pass still read flat; it did, inside the cards: a recess in
   *                paper on a warm white was all but invisible). Quiet surfaces
   *                only — a recess that holds ink or stone words: the
   *                customer's bubble, the quote box, the reasons list, the
   *                profile card's figures, the lens and language tracks, a
   *                neutral tag, pill or chip, an icon's round. Never under a
   *                state's words, never a meaning, never magenta.
   *
   * What stays ink, on purpose (restraint is what reads as premium): headings,
   * body text, the rail and its words, a secondary button, the wordmark "Nomi"
   * beside the mark. There is no brand wash: a third pale pink would be the
   * two meanings' washes by another name.
   *
   * And the three states: ok (it went, it is on), failed (`warn`: it did not
   * happen), and waiting — which is `needs`. A state is a shape and a WORD;
   * colour never carries it alone.
   *
   * Retired: the single faded magenta that did both jobs, its wash and line,
   * the cool graphite neutrals with pure white (the warmth pass); jade,
   * highlight, the three warm papers, the dark palette (before it).
   * `palette.test.ts` keeps all of their values out of the product.
   *
   * Washes and lines are TOKENS rather than `color-mix(… 12% …)` for a product
   * reason: the owner surface bans the `%` character outright, and that ban is
   * enforced against rendered HTML — which a CSS percentage trips just as surely
   * as a fake metric.
   */
  color: {
    ok: '#0F7B3E',
    brand: '#9A0F5E',
    needs: '#6E0C44',
    needsWash: '#F9E6EE',
    warn: '#B42318',
    assistant: '#BE2D6E',
    assistantWash: '#FBEFF3',
    ink: '#25201C',
    inkSecondary: '#665D55',
    surface: '#FFFDFA',
    paper: '#F7F3EE',
    sand: '#F1E8DC',
    border: '#E8E1D8',
    okWash: '#E2EFE8',
    okLine: '#B7D7C5',
    warnWash: '#F6E5E3',
    warnLine: '#E9BDBA',
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
   * product is one of these: a control (a field, a button), a card (a card, a
   * band, a grouped menu of rows, a panel of facts), a panel (the sheet that
   * springs up, the calendar's grid), a chip, a face. The warmth pass
   * (2026-10-04) named the rest: an input, a button and an image are controls;
   * a menu, a toast and a notice are cards; a dialog and a sheet are panels;
   * a pill, a tag and a face are chips. The re-audit
   * (w4-whole-17) held the app to it: a button beside a field shares its corner,
   * and a band above a list shares the list's.
   */
  radiusPx: { control: 12, card: 16, panel: 20, chip: 999 },
  /**
   * THE WARMTH RUN — customers' faces. A customer the channel gives no photo
   * of (e-mail, WhatsApp) is a coloured initial: one of these eight, chosen by
   * their id so it never changes.
   *
   * The warmth pass (2026-10-04) — "let the customer faces carry real colour
   * across every page": the pale pastels became eight full, warm mid-tones
   * with the letter in white — blue, teal, olive, ochre, orange, violet,
   * petrol, cocoa — so a face is the most colourful thing on a page and never
   * a signal. Each white letter is ≥ 4.5:1 on its ground; each hue sits at
   * least 40° (CIELAB) from both magentas and is not the ok green's or the
   * failed red's (ΔE ≥ 25 from each); `warmth-pass.test.ts` computes all eight.
   */
  faceTint: [
    { bg: '#3366A8', fg: '#FFFFFF' },
    { bg: '#187A70', fg: '#FFFFFF' },
    { bg: '#6B7320', fg: '#FFFFFF' },
    { bg: '#8C6B0A', fg: '#FFFFFF' },
    { bg: '#AD5C14', fg: '#FFFFFF' },
    { bg: '#6450B0', fg: '#FFFFFF' },
    { bg: '#0F7085', fg: '#FFFFFF' },
    { bg: '#8A5A3C', fg: '#FFFFFF' },
  ],
  /**
   * One shadow is a box; three are a surface. Each lift is a contact shadow, a
   * diffuse body, and a hairline that does the work a 1px border used to —
   * which is why cards can drop their border without dissolving into the page.
   *
   * The warmth pass (2026-10-04) — the shadows are WARM (a brown, the ink's
   * own hue, never grey or black) and a little deeper, so a rounded card, a
   * menu, the profile card and the calendar's grid read as objects resting on
   * the paper. Two lifts and no more: `lift1` for what rests on the page,
   * `lift2` for what rises over it (a sheet, a dialog, a toast, a pressed
   * primary act). `card` and `raised` were emitted and drawn nowhere; retired.
   */
  shadow: {
    lift1: '0 1px 2px rgba(74,48,30,0.07), 0 3px 10px rgba(74,48,30,0.07), 0 0 0 1px rgba(74,48,30,0.05)',
    lift2: '0 2px 6px rgba(74,48,30,0.09), 0 12px 28px rgba(74,48,30,0.13), 0 0 0 1px rgba(74,48,30,0.05)',
  },
  // The warmth run's re-audit (w4-whole-21): the owner's range is 100–250 ms, so the longest is 250.
  motionMs: { fast: 120, normal: 200, max: 250 },  // skippable; nothing moves under reduced motion
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
   * PHASE 4 OF THE UI REBUILD (2026-10-02) — THE FOUR SIGNALS. Each signal
   * has a SHAPE as well as a colour, so it is still said in greyscale, to an
   * eye that does not tell the hues apart, and on a phone in the sun:
   *
   *   ok         ✓  green          it went, it is on, it is done
   *   waiting    ●  deep magenta   it waits for you (`--color-needs`): the
   *                                NEEDS DOT, a solid disc the stylesheet
   *                                draws, the same size in every script
   *   failed     ✕  red            it did not happen, it did not reach them
   *   assistant  ✦  light magenta  the assistant did this (`--color-assistant`)
   *
   * The identity system (2026-10-04): waiting was the open ring ○, which a
   * chore also wore in stone — two rings told apart by colour alone. Now a
   * customer waiting is the SOLID disc, and a chore keeps the open ring
   * (`chore`), so the two are two shapes.
   *
   * The stylesheet draws the shape before a state's words (`::before`, read
   * from here; the needs dot is drawn as a disc); a renderer that draws a
   * shape on its own takes it from `signalMark` (layout.ts).
   * `phase4-colour.test.ts` holds every use of a signal colour in the
   * stylesheet to one of these, with its shape.
   */
  signal: { ok: '✓', waiting: '●', failed: '✕', assistant: '✦' },
  /**
   * Something left TO DO that is not a customer waiting — a setup step, a
   * hold, a check: the OPEN ring, in the secondary ink (`todoMark`, layout.ts).
   */
  chore: '○',
  /** Status chip: canonical five statuses (vocabulary.STATUS) → semantic color key. */
  statusChip: {
    已处理: 'ok',
    等你审批: 'needs',     // the warmth pass: waiting for the owner is the deep magenta
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
