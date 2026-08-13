import { describe, it, expect } from 'vitest';
import { BOX, BUDGET, CARD_ORDER, MARK, DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { shell, loginPage } from '../../src/api/web/layout.js';
import { actionBar, box, buyerHeader, textWidth } from '../../src/core/owner/components.js';
import { BANNED_OWNER_TERMS, STATUS } from '../../src/core/owner/vocabulary.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { product, tiers, policy } from './fixtures.js';

/**
 * M2 — the design system, enforced. Exit criterion: any five surfaces look
 * like the same team built them. In text terms: same box grammar, same
 * markers, same section order, same budgets — all sourced from tokens.
 */

const NOW = new Date('2026-07-17T11:30:00Z');

/*
 * M34.11 — the box-grammar and CARD_ORDER blocks went with renderQuoteCard and
 * renderApprovalCard, the last two M1/M2 text cards. Both were reached by no
 * production path: the live approval surface is api/web/inbox.ts, which renders
 * HTML from stored rows, and BOX / MARK / CARD_ORDER describe a chat card that
 * no owner is shown.
 *
 * `box()` and `buyerHeader()` remain exercised below through the components the
 * shell still uses. What is NOT re-pointed is the section ORDER — who → what →
 * proposal → computed → why → actions. That was a grammar for a text card; the
 * live page has its own layout, asserted in inbox tests, and inventing an HTML
 * equivalent to keep a token alive would be measuring something nobody designed.
 */

/* ── Big Four states, re-pointed ─────────────────────────────────────────── */

/**
 * M34.8 — these rules used to be asserted against `core/owner/states.ts`, the
 * M2 text-card copy, which no live surface renders. The rules themselves are
 * still the product's: an empty screen teaches the next action, and nothing we
 * say is software talk. They now bind the i18n catalogue, where the live empty
 * and progress copy actually lives.
 *
 * `tests/parity/empty-states.test.ts` already asserts the *behavioural* half
 * against the rendered pages — a way forward, no error styling, no claimed work.
 * This is the vocabulary half, which had no live home at all.
 */
describe('M2 · empty teaches the next action, and never says No Data', () => {
  const EMPTY_KEYS = (Object.keys(messages.en) as MessageKey[])
    .filter((k) => /(^|\.)empty(\.|$)|\.none$|Empty$/i.test(k));

  it('there are empty-state strings to check', () => {
    expect(EMPTY_KEYS.length).toBeGreaterThan(3);
  });

  it('no empty state is a dead end phrase', () => {
    for (const locale of LOCALES) {
      for (const k of EMPTY_KEYS) {
        const s = t(locale, k, { name: '小雅' }).toLowerCase();
        for (const dead of ['暂无', '无数据', 'no data', 'n/a', 'null', 'undefined']) {
          expect(s.includes(dead), `${locale} ${k}: "${s}"`).toBe(false);
        }
      }
    }
  });

  it('no empty state is styled or worded as a failure', () => {
    for (const locale of LOCALES) {
      for (const k of EMPTY_KEYS) {
        const s = t(locale, k, { name: '小雅' }).toLowerCase();
        for (const bad of ['error', 'failed', '错误', '失败']) {
          expect(s.includes(bad), `${locale} ${k}: "${s}"`).toBe(false);
        }
      }
    }
  });
});

/* ── budgets come from tokens, and surfaces obey them ────────────────────── */
describe('M2 · budgets are tokens', () => {
  it('the token budgets are defined and orderable', () => {
    // BUDGET.cardLines and BUDGET.digestLines no longer have surfaces to
    // measure — both text cards are deleted and the live pages are HTML with no
    // line count to bound. The tokens stay because tokens.ts is the design
    // system's vocabulary; what is gone is the pretence that something enforces
    // them. Inventing an HTML equivalent would measure something nobody designed.
    expect(BUDGET.cardLines).toBeGreaterThan(0);
    expect(BUDGET.lineColumns).toBeGreaterThan(0);
  });
});

/* ── the system is what the SURFACE renders, not what the object says ─────── */

/**
 * M30 — this section used to read the token object and assert things about the
 * token object: `expect(PWA_TOKENS.font.sizePx.base).toBeGreaterThanOrEqual(16)`
 * passed for months while the shell shipped a hand-written `font: 15px/1.5` and
 * imported no tokens at all. A test that reads the value and checks the value
 * is not a test — it restates the source.
 *
 * So every claim about how the product LOOKS is now made against the HTML that
 * `shell()` actually returns. The only assertions left on the object are the
 * ones that are genuinely about the object: that its status vocabulary matches
 * `STATUS`, and that the emitter derives rather than transcribes.
 */
const page = shell({
  title: 'T', active: 'home', locale: 'en', path: '/app', avatar: '👩', bodyHtml: '<p>body</p>',
});

/** The shell minus the generated token block — i.e. everything hand-written. */
const handWritten = page.replace(cssVariables(), '');

describe('M30 · the rendered shell IS the design system', () => {
  it('declares the token base size and line height — not a typed-in one', () => {
    // the variable carries the token's value…
    expect(page).toContain(`--font-size-base: ${DESIGN_TOKENS.font.sizePx.base}px`);
    expect(page).toContain(`--line-height: ${DESIGN_TOKENS.font.lineHeight}`);
    // …and body actually consumes it, rather than restating a number
    expect(page).toMatch(/body \{[^}]*font: var\(--font-size-base\)\/var\(--line-height\)/);
    // the value the product renders is the one 45+ eyes were promised
    expect(DESIGN_TOKENS.font.sizePx.base).toBeGreaterThanOrEqual(16);
  });

  it('contains no hardcoded hex outside the emitted :root block', () => {
    const strays = handWritten.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(strays, `hardcoded colour(s) in the shell: ${strays.join(', ')}`).toEqual([]);
  });

  it('the login page obeys the same rule — it shares the shell stylesheet', () => {
    const login = loginPage({ locale: 'en', path: '/login' }).replace(cssVariables(), '');
    const strays = login.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(strays, `hardcoded colour(s) in login: ${strays.join(', ')}`).toEqual([]);
  });

  it('every type size is a token — no literal px font-size survives', () => {
    const literals = [...handWritten.matchAll(/font-size:\s*(\d+)px/g)].map((m) => m[0]);
    expect(literals, `off-token size(s): ${literals.join(', ')}`).toEqual([]);
    // the shorthand `font:` is the other way a size sneaks in
    expect(handWritten).not.toMatch(/font:\s*\d+px/);
  });

  it('emits a variable for every colour token, dark palette included', () => {
    const css = cssVariables();
    for (const key of Object.keys(DESIGN_TOKENS.color)) {
      const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(css, key).toContain(`--color-${name}:`);
    }
    expect(css).toContain('@media (prefers-color-scheme: dark)');
  });
});

describe('M30 · the emitter derives, it does not transcribe', () => {
  /**
   * The failure this whole commit exists to prevent: a hand-maintained mapping
   * that has to be edited in step with the tokens, and one day is not. A token
   * that does not exist here must still reach the page.
   */
  it('a colour token nobody wrote a line for still becomes a variable', () => {
    const extended = {
      ...DESIGN_TOKENS,
      color: { ...DESIGN_TOKENS.color, inventedForThisTest: '#ABCDEF' },
    } as unknown as typeof DESIGN_TOKENS;
    const css = cssVariables(extended);
    expect(css).toContain('--color-invented-for-this-test: #ABCDEF;');
    expect(css.length).toBeGreaterThan(cssVariables().length);
  });

  it('spacing variables are named by value, so extending the scale moves nothing', () => {
    for (const v of DESIGN_TOKENS.spacingPx) expect(cssVariables()).toContain(`--space-${v}: ${v}px;`);
  });
});

/* ── the two voices ──────────────────────────────────────────────────────── */

/**
 * M30 — anything a PERSON says is set in the voice serif; anything the PRODUCT
 * says stays sans. This is the design's central claim — "she is a colleague,
 * not a console" — made visible. The test is structural, in two halves:
 * which selectors the shell gives the voice to, and which elements the
 * renderers actually put speech inside.
 */
describe('M30 · two voices — a person is serif, the product is sans', () => {
  const css = page.match(/<style>([\s\S]*?)<\/style>/)![1]!;
  /** Selectors of every rule that sets the voice family. */
  const voiced = [...css.matchAll(/([^{}]+)\{[^}]*font-family:\s*var\(--font-voice\)/g)]
    .flatMap((m) => m[1]!.split(',').map((s) => s.trim()));

  it('speech components carry the voice; product components never do', () => {
    expect(voiced.some((s) => s.includes('.bubble')), '.bubble must be voiced').toBe(true);
    expect(voiced.some((s) => s.includes('.proposed')), '.proposed must be voiced').toBe(true);
    expect(voiced.some((s) => s.includes('.voice')), 'the .voice utility must exist').toBe(true);
    // the product's own furniture must NOT inherit a human voice
    for (const product of ['.btn', '.stat', '.pill', '.navlink', 'h1', 'h2', '.muted', '.empty']) {
      expect(voiced.some((s) => s.includes(product)), `${product} must stay sans`).toBe(false);
    }
    // and body's base family is the sans stack, so sans is the DEFAULT
    expect(css).toMatch(/body \{[^}]*var\(--font-family\)/);
  });

  it('a rendered draft sits in a voiced element; its buttons do not', async () => {
    const { renderConversationDetail } = await import('../../src/api/web/inbox.js');
    type Detail = Parameters<typeof renderConversationDetail>[0];
    const detail: Detail = {
      conversationId: 'c1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
      product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000,
      quote: null, order: null,
      messages: [{ direction: 'inbound', text: 'BUYERWORDS-5000', at: new Date('2026-07-27T09:00:00Z') }],
      pendingDraft: { draftId: 'd1', draftText: 'HERDRAFT-092', capability: 'quote' },
      ownership: 'AI', refusals: [], handoffReasons: [], unheardReason: null, lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
    };
    const html = renderConversationDetail(detail, 'en', new Date('2026-07-27T10:00:00Z'), null);
    // her draft is inside .proposed (voiced); the buyer's words inside .bubble
    expect(html).toMatch(/class="proposed"><bdi>HERDRAFT-092/);
    expect(html).toMatch(/class="msg inbound">\s*<div class="bubble"><bdi>BUYERWORDS-5000/);
    // the actions around the speech are the product speaking: plain .btn, no voice class
    expect(html).toMatch(/class="btn send"[^>]*>Send/);
    expect(html).not.toMatch(/class="[^"]*voice[^"]*"[^>]*>Send/);
  });

  /**
   * Speech is other people's text in other people's scripts, so every speech
   * element isolates its bidi. Found the hard way: sandbox's .proposed lacked
   * <bdi>, and a Latin draft rendered with a displaced "?" on the Arabic page
   * while inbox's identical component rendered correctly.
   */
  it('every speech element wraps its text in <bdi>', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../../src/api/web/', import.meta.url);
    const offences: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.ts'))) {
      const src = await readFile(new URL(f, dir), 'utf8');
      for (const line of src.split('\n')) {
        if (/class="(proposed|bubble)"/.test(line) && !line.includes('<bdi>')) {
          offences.push(`${f}: ${line.trim().slice(0, 70)}`);
        }
      }
    }
    expect(offences, `speech without bidi isolation: ${offences.join(' · ')}`).toEqual([]);
  });
});

describe('M2 · status chips stay keyed to the owner vocabulary', () => {
  it('cover exactly the five canonical statuses with valid color keys', () => {
    expect(Object.keys(DESIGN_TOKENS.statusChip).sort()).toEqual(
      [...Object.values(STATUS)].sort(),
    );
    for (const colorKey of Object.values(DESIGN_TOKENS.statusChip)) {
      expect(Object.keys(DESIGN_TOKENS.color)).toContain(colorKey);
    }
  });

  it('motion respects the ≤300ms spec', () => {
    expect(DESIGN_TOKENS.motionMs.max).toBeLessThanOrEqual(300);
  });
});

/**
 * M22 — fixtures must be TYPED.
 *
 * `{...} as never` on a whole fixture disables every check the compiler could
 * make about it, and this repo has paid for that twice in one week:
 *
 *   - `empty-states.test.ts` carried Phase-E's pre-rename field names, so
 *     `formatMoney(undefined)` threw at module load and NONE of its six tests ran
 *     for weeks while `npm run check` reported "1 failed | 819 passed".
 *   - `refusals.test.ts` asserted against `{ action: 'send_free_form' }`, a
 *     SendPlan action that does not exist. `gateOutbound` falls through on
 *     anything it does not recognise, so the assertions passed while testing a
 *     state that cannot occur.
 *
 * Narrow casts on a single field are allowed — they are visible and local. What
 * this forbids is casting an entire object literal, which is where shape drift
 * hides. Typing a fixture is one import; the compiler then finds the drift.
 */
describe('M22 · no parity fixture opts out of type-checking', () => {
  it('no whole-object literal is cast away with `as never`', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('./', import.meta.url);
    const offenders: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.test.ts'))) {
      const src = await readFile(new URL(f, dir), 'utf8');
      src.split('\n').forEach((line, i) => {
        // Comments describe the rule; only code can break it.
        if (/^\s*(\*|\/\/)/.test(line)) return;
        // A line that closes an object literal and immediately casts it away.
        if (/\}\s*as never/.test(line) && !/db:\s*\{\}\s*as never/.test(line)) {
          offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(offenders, `type the fixture instead:\n${offenders.join('\n')}`).toEqual([]);
  });
});
