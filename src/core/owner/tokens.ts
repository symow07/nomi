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
     *
     * THE TYPE PASS (2026-10-04) — and every order names all three scripts, so
     * no word falls to the device: the switch's العربية on a Chinese page was
     * Geeza Pro, a customer's 陈莉 on an Arabic page PingFang.
     */
    family: {
      en: `"Noto Sans", "Noto Sans SC", "Noto Sans Arabic", system-ui, sans-serif`,
      zh: `"Noto Sans SC", "Noto Sans", "Noto Sans Arabic", system-ui, sans-serif`,
      ar: `"Noto Sans Arabic", "Noto Sans", "Noto Sans SC", system-ui, sans-serif`,
    },
    /**
     * The serif voice. Anything a PERSON says is set in this — the assistant's
     * drafts, a customer's quoted words. Sans is what the PRODUCT says: labels,
     * nav, counts, buttons. The distinction is the point; do not use it for
     * emphasis. Arabic speech is Naskh, the hand running text is read in.
     */
    voice: {
      en: `"Noto Serif", "Noto Serif SC", "Noto Naskh Arabic", Georgia, serif`,
      zh: `"Noto Serif SC", "Noto Serif", "Noto Naskh Arabic", serif`,
      ar: `"Noto Naskh Arabic", "Noto Serif", "Noto Serif SC", serif`,
    },
    /**
     * THE TYPE PASS (2026-10-04) — the six sizes stay; what changed is which
     * role wears which, so the hierarchy reads at a glance (it was flat: the
     * page title 20 px, 1.18× the body, and Today's 26 px heading above it):
     *
     *   page title        hero 34, bold, tight, tracked in (display 26 on a phone)
     *   a page's headline display 26 (Today's "handled" line, a customer's name on the card)
     *   section heading   title 20, semibold, tight
     *   a row's name      small 15, medium; a person's name semibold
     *   body              small 15 / base 17, regular
     *   caption, time     caption 13, regular, in the secondary ink
     *   a large figure    display 26, light (Today's three, the card's two)
     */
    sizePx: { caption: 13, small: 15, base: 17, title: 20, display: 26, hero: 34 },
    /**
     * Set from `html[lang]`; the shell writes the locale there on every page.
     * The type pass opened Latin up from 1.5 to 1.6 — the measure many of the
     * product's reading blocks already set for themselves. Chinese (1.7) and
     * Arabic (1.75) were already that open; a step more pushed the owner's
     * decided row heights (64 px with a line under the name) to 65 and 66.
     */
    lineHeight: { en: 1.6, zh: 1.7, ar: 1.75, es: 1.6, fr: 1.6 },
    /**
     * Headings (20 px and up) close up: a 26 px line in a 39 px box read as
     * loose. Arabic keeps room for its ascenders and marks when a heading wraps.
     */
    lineHeightTight: { en: 1.2, zh: 1.35, ar: 1.45, es: 1.2, fr: 1.2 },
    /**
     * Letter-spacing for headings: Latin tracks in at large sizes; Chinese and
     * Arabic never take tracking (it would open gaps inside Arabic's joined
     * letters and between Chinese characters).
     */
    trackingTight: { en: '-0.02em', zh: '0', ar: '0', es: '-0.02em', fr: '-0.02em' },
    /**
     * THE WEIGHTS (the type pass) — five, all real: the Sans faces are variable
     * files that draw 300 to 700 (`assets/fonts`, `tools/fonts.mjs`). Before,
     * only 400 and 600 existed, so every 700 drew 600 and every 500 drew 400.
     *
     *   light 300     a large, quiet figure or sentence, 20 px and up only
     *   regular 400   reading text, captions
     *   medium 500    a row's name, a group's label, a quiet button, the rail
     *   semibold 600  a section heading, a person's name, the primary act, a state
     *   bold 700      a page title, the brand
     *
     * The voice (Serif) is 400 only, as before.
     */
    weight: { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700 },
    /**
     * Nothing below 400 at 15 px and under, in any script — decision 1 said it
     * of Chinese, and 45+ eyes read the other four the same way. Light is for
     * 20 px and up. `type.test.ts` holds both against the stylesheet.
     */
    weightFloor: { min: 400, cjkAtOrBelowPx: 15, lightFromPx: 20 },
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
   * And one DECORATIVE magenta, which is not a meaning (the owner, 2026-10-07):
   *   orbGlow      #A1127A, the glow behind the advisor's orb, and the light
   *                behind the advisor's mark in the nav (the owner, 2026-10-09:
   *                the mark is the orb's), and nothing else. Never a button, a
   *                chip, a pill, a state, a text colour, a border or a fill of
   *                anything but those two. Its own value: a
   *                touch toward violet, held clear of `needs` (ΔE00 12.5) and of
   *                `assistant` (10.3). Four magentas is the CEILING — brand,
   *                needs, assistant, orbGlow — and `palette.test.ts` holds both.
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
    /** DECORATIVE: the advisor orb's glow only (above). Never a button, chip, state or text. */
    orbGlow: '#A1127A',
  },
  /**
   * A colour by the JOB it does, named after one of the palette's own (never a
   * new value): `--color-<job>` is the palette's variable. One line here moves
   * a job to another shade.
   *
   *   navActive  the rail's entry you are on: its icon, filled (the icons run,
   *              2026-10-04). The owner asked for it "filled and in deep
   *              magenta", so it is `needs`. Deep also says "needs you", and
   *              the two stay apart by SHAPE: a filled icon is where you are;
   *              the needs dot (a small solid disc) is what waits for you,
   *              and it never sits on the filled icon. To draw it in the
   *              brand shade instead, write 'brand'.
   */
  colorRole: { navActive: 'needs' } as const,
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
  /**
   * THE MOTION PASS (2026-10-04) — the owner: "Motion is wired but unfeelable:
   * an 8 px rise that is 90% done within 100 ms." Everything that arrives now
   * lands in about 220 ms, travels far enough to be seen, and settles; what
   * leaves goes in about 160 ms. (docs/MOTION-TRUTH.md measured the before.)
   *
   *   fast    160 ms  a hover, a press and its release, anything leaving
   *   normal  220 ms  anything arriving: a notice, the draft card, a dialog, a toast, a face
   *   max     250 ms  the profile card and the page coming in; one breath of the dots
   *   step     40 ms  the gap between one face (or one menu group) and the next
   *
   * The owner's band is 200–250 ms for what lands; nothing runs longer than 250.
   */
  motionMs: { fast: 160, normal: 220, max: 250, step: 40 },  // nothing moves under reduced motion
  /**
   * THE ONE CURVE for what arrives: an ease-out with a gentle deceleration
   * (the classic quadratic): 45 per cent of the way at a quarter of the time,
   * three quarters at half, settling over the last third. The old curve
   * (0.2, 0, 0, 1) did 60 per cent in the first quarter, so a 200 ms rise read
   * as 70 ms. Nothing overshoots on it.
   */
  motionEase: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  /** What leaves accelerates away (its mirror), over `fast`. */
  motionEaseIn: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)',
  /**
   * THE WARMTH RUN (2026-10-03) — one exception to the one curve: the profile
   * card springs up (a small overshoot, over `motionMs.max` since the motion
   * pass). Nothing else uses it; under reduced motion nothing moves.
   */
  motionSpring: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
  /**
   * How far each thing travels (px), so it is seen: the old rise was 8 and a
   * fold 4. `nudge` is a rail icon lifting under the pointer; `sheet` the
   * profile card springing up (on a phone it comes from the screen's foot).
   */
  motionTravelPx: { nudge: 2, fold: 8, page: 12, rise: 16, toast: 24, sheet: 48 },
  /** A pressed control settles to `press`; a dialog grows in from `enter`. */
  motionScale: { press: 0.97, enter: 0.96 },
  /**
   * PHASE 4 OF THE UI REBUILD (2026-10-02) — THE SIGNALS. Each signal
   * has a SHAPE as well as a colour, so it is still said in greyscale, to an
   * eye that does not tell the hues apart, and on a phone in the sun:
   *
   *   ok         ✓  green          it went, it is on, it is done
   *   waiting    ●  deep magenta   it waits for you (`--color-needs`): the
   *                                NEEDS DOT, a solid disc the stylesheet
   *                                draws, the same size in every script
   *   failed     ✕  red            it did not happen, it did not reach them
   *
   * The assistant was a fourth, a four-pointed star; the icons run (2026-10-04)
   * took it out. "The assistant did this" is the light magenta with its NAME
   * TAG where it labels words, and its slot (`agentMark`) where it is a mark.
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
  signal: { ok: '✓', waiting: '●', failed: '✕' },
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

/*
 * M7's `MOTION_SPECS` (approveTap, quoteReveal, sendFlight, statusChange) and
 * `REDUCED_MOTION_RULE` were RETIRED with the motion pass (2026-10-04): they
 * described a PWA that never existed, nothing imported them, and two of their
 * values (300 ms, linear) were outside the owner's range. The motion the
 * product has is `motionMs`, `motionEase`, `motionTravelPx` and `motionScale`
 * above, drawn by the shell's stylesheet (`MOTION_CSS`, layout.ts).
 */

/** M7 desktop keyboard shortcuts — approval flow first, vim-adjacent. */
export const KEYBOARD_SHORTCUTS = {
  approve: 'Enter',
  edit: 'e',
  skip: 'x',
  nextCard: 'j',
  prevCard: 'k',
  search: '/',
} as const;
