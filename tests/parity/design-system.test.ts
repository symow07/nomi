import { describe, it, expect } from 'vitest';
import { BOX, BUDGET, CARD_ORDER, MARK, DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { shell, loginPage } from '../../src/api/web/layout.js';
import { actionBar, box, buyerHeader, textWidth } from '../../src/core/owner/components.js';
import { EMPTY, PROGRESS, SUCCESS, renderProblem } from '../../src/core/owner/states.js';
import { BANNED_OWNER_TERMS, STATUS } from '../../src/core/owner/vocabulary.js';
import { renderQuoteCard, renderApprovalCard } from '../../src/core/conversation/cards.js';
import { renderDailyDigest } from '../../src/core/owner/digest.js';
import { renderConversation } from '../../src/core/owner/conversation.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { product, tiers, policy } from './fixtures.js';

/**
 * M2 — the design system, enforced. Exit criterion: any five surfaces look
 * like the same team built them. In text terms: same box grammar, same
 * markers, same section order, same budgets — all sourced from tokens.
 */

const NOW = new Date('2026-07-17T11:30:00Z');

const quote = (() => {
  const r = computeQuote({ product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 20000 });
  if (!r.ok) throw new Error('fixture');
  return r.value;
})();
const quoteCard = renderQuoteCard(quote, product().name);
const approvalCard = renderApprovalCard({
  buyerName: 'Ahmed', buyerCountryHint: '阿联酋', isReturning: true,
  buyerMessage: 'Can you do 20000 pcs FOB Ningbo?', buyerMessageZh: '能做2万个FOB宁波吗？',
  draft: 'Yes — for 20,000 pcs the unit price is $0.38 FOB Ningbo.',
  draftZh: '可以，2万个单价0.38美元，FOB宁波。',
  whyLineZh: '买家问大货价；按你的价格表第三档计算。',
  quoteCard,
});
const digest = renderDailyDigest({
  employeeName: '小雅', date: NOW, now: NOW,
  stats: { conversations: 12, handled: 9, quotes: 3, orders: 1, orderValueUsd: 7300 },
  highlight: { buyerName: 'Ahmed', countryZh: '阿联酋', what: '谈到了2万个的报价，等他确认', at: new Date('2026-07-16T19:40:00Z') },
  pending: [{ buyerName: 'Sara', what: '想要样品，等你审批回复' }],
  onDutyTonightZh: '接待问候、了解需求（新买家）',
});
const conversation = renderConversation({
  buyerName: 'Ahmed', countryZh: '阿联酋', employeeName: '小雅', now: NOW,
  messages: [
    { direction: 'inbound', text: 'Price for 20000?', textZh: '2万个什么价？', at: new Date('2026-07-16T19:35:00Z'), sentBy: null },
    { direction: 'outbound', text: '$0.38/pc FOB Ningbo.', textZh: '单价0.38美元，FOB宁波。', at: new Date('2026-07-16T19:41:00Z'), sentBy: 'employee' },
  ],
});

/* ── one box grammar ─────────────────────────────────────────────────────── */
describe('M2 · every boxed surface uses the token border', () => {
  it('quote card opens and closes with BOX tokens', () => {
    const lines = quoteCard.split('\n');
    expect(lines[0]).toBe(BOX.top('报价卡'));
    expect(lines.at(-1)).toBe(BOX.bottom);
    for (const l of lines.slice(1, -1)) expect(l.startsWith(BOX.side), l).toBe(true);
  });

  it('box() is the only way box grammar appears (component output matches)', () => {
    expect(box('报价卡', ['a']).split('\n')).toEqual([BOX.top('报价卡'), `${BOX.side}a`, BOX.bottom]);
  });
});

/* ── one section grammar ─────────────────────────────────────────────────── */
describe('M2 · approval card follows CARD_ORDER', () => {
  it('sections appear in canonical order: who → what → proposal → computed → why → actions', () => {
    const anchors: Record<(typeof CARD_ORDER)[number], string> = {
      who: MARK.person,
      what: '买家说：',
      proposal: '我想回：',
      computed: BOX.top('报价卡'),
      why: '为什么：',
      actions: actionBar(),
    };
    const positions = CARD_ORDER.map((s) => approvalCard.indexOf(anchors[s]));
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('buyer intro is the shared component everywhere', () => {
    expect(approvalCard.startsWith(buyerHeader({ name: 'Ahmed', countryZh: '阿联酋', tag: '老询盘' }))).toBe(true);
    expect(conversation.startsWith(`${MARK.person} Ahmed`)).toBe(true);
  });

  it('markers keep one meaning: 翻译 for buyer words, 意思 for our drafts', () => {
    expect(approvalCard).toContain(`${MARK.translation}能做2万个FOB宁波吗？`);
    expect(approvalCard).toContain(`${MARK.meaning}可以，2万个单价0.38美元，FOB宁波。`);
    expect(conversation).toContain(MARK.meaningShort);
  });
});

/* ── Big Four states ─────────────────────────────────────────────────────── */
describe('M2 · Big Four: empty teaches, progress informs, problems reassure, success rewards', () => {
  const stateStrings: Record<string, string> = {
    emptyProducts: EMPTY.products('小雅'),
    emptyConversations: EMPTY.conversations('小雅'),
    emptyPending: EMPTY.pending(),
    emptyOrders: EMPTY.orders('小雅'),
    ...PROGRESS,
    successFirstSend: SUCCESS.firstSend('小雅'),
    successSent: SUCCESS.sent('Ahmed'),
    successOrder: SUCCESS.orderConfirmed('Ahmed'),
    successCatalog: SUCCESS.catalogLearned('小雅', 23),
    successPromoted: SUCCESS.promoted('报价'),
    problem: renderProblem({
      whatHappened: '给 Ahmed 的消息暂时没发出去。',
      beingDone: '正在自动重试。',
      whatYouDo: null,
    }),
  };

  for (const [name, text] of Object.entries(stateStrings)) {
    it(`${name}: no banned terms, phone-width lines`, () => {
      const lower = text.toLowerCase();
      for (const banned of BANNED_OWNER_TERMS) {
        const needle = banned.toLowerCase();
        const hit = /^[a-z ]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(lower)
          : lower.includes(needle);
        expect(hit, `"${banned}" in ${name}`).toBe(false);
      }
      for (const l of text.split('\n')) expect(textWidth(l), l).toBeLessThanOrEqual(BUDGET.lineColumns);
    });
  }

  it('empty states never say No Data — they name the next action', () => {
    for (const empty of [EMPTY.products('小雅'), EMPTY.conversations('小雅'), EMPTY.orders('小雅')]) {
      for (const dead of ['暂无', '无数据', 'no data', 'empty']) {
        expect(empty.toLowerCase()).not.toContain(dead);
      }
    }
    expect(EMPTY.products('小雅')).toContain('培训');
    expect(EMPTY.conversations('小雅')).toContain('WhatsApp');
  });

  it('progress copy says what work is happening, not that software is busy', () => {
    for (const p of Object.values(PROGRESS)) {
      expect(p.endsWith('……')).toBe(true);
      expect(p).not.toContain('加载');  // "loading" is software talk
    }
  });
});

/* ── budgets come from tokens, and surfaces obey them ────────────────────── */
describe('M2 · budgets are tokens', () => {
  it('digest and approval card fit their token budgets', () => {
    expect(digest.split('\n').length).toBeLessThanOrEqual(BUDGET.digestLines);
    expect(approvalCard.split('\n').length).toBeLessThanOrEqual(BUDGET.cardLines);
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
 *     `formatUsd(undefined)` threw at module load and NONE of its six tests ran
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
