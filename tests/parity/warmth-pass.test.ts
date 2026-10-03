import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { cssVariables } from '../../src/core/owner/css.js';
import { shell, loginPage, NEEDS_ACT } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { renderSandbox, type SandboxView } from '../../src/api/web/sandbox.js';
import { renderCustomerPanel } from '../../src/api/web/panes.js';
import { renderDataRights } from '../../src/api/web/dataRights.js';
import { renderComponents } from '../../src/api/web/components.js';
import { saveBar } from '../../src/api/web/rows.js';
import type { CustomerPanel } from '../../src/db/customerPanel.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { usd } from '../../src/core/types/money.js';
import { conversationDetail } from './fixtures.js';
import { linkedCss } from './linked-css.js';

/**
 * THE WARMTH PASS (2026-10-04). The owner: "The app feels dry and
 * black-and-white. Add life WITHOUT spending the magenta's meaning."
 *
 *   - Two magentas, two jobs: DEEP (`needs`) for what waits for the owner and
 *     the one act that answers it; LIGHT (`assistant`) for what Nomi did.
 *   - Warm neutrals, warm shadows under the rounded cards.
 *   - Faces in real colour, never a signal's.
 *
 * Everything here is COMPUTED from the values the pages are drawn with, so a
 * token changed by eye fails here before it reaches a page.
 */

const C = DESIGN_TOKENS.color;
const WHITE = '#FFFFFF';
/** The graphite the run used to fill its primary act, for the comparison the brief asks for. */
const OLD_GRAPHITE = '#1C1B1F';

// ── colour science, WCAG 2.x and CIE 1976 ─────────────────────────────────
const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const rgb = (hex: string) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16))) as [number, number, number];
const luminance = (hex: string) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
const lab = (hex: string) => {
  const [r, g, b] = rgb(hex);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  const L = 116 * Y - 16, A = 500 * (X - Y), B = 200 * (Y - Z);
  return { L, a: A, b: B, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
};
const dE = (p: string, q: string) => { const x = lab(p), y = lab(q); return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b); };
const hueGap = (p: number, q: number) => { const d = Math.abs(p - q) % 360; return Math.min(d, 360 - d); };

const appCss = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
const doorCss = linkedCss(loginPage({ locale: 'en', path: '/login' }));
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const ruleOf = (sel: string, css = appCss) => rules(css).filter((r) => r.sel.split(',').map((s) => s.trim()).includes(sel)).map((r) => r.body).join(';');

describe('two magentas with two jobs — the contrast, computed', () => {
  /**
   * THE TABLE (also in the report): every pair a page draws, with its floor.
   * The deep magenta carries the small Arabic and Chinese words of waiting
   * (the rail's count, a pill, "○ 回复待审"), so it is held to 7:1 (AAA) on every
   * ground it sits on. The light magenta carries "✦ name" and today's date: it
   * is held to 4.5:1 (AA) and reaches about 5:1 — it cannot reach 7:1 and stay
   * 20 L* lighter than the deep one, which itself must stay clear of the ink.
   */
  const TABLE: readonly (readonly [string, string, string, number])[] = [
    ['needs as text', C.needs, C.paper, 7], ['needs as text', C.needs, C.surface, 7], ['needs as text', C.needs, C.needsWash, 7],
    ['assistant as text', C.assistant, C.paper, 4.5], ['assistant as text', C.assistant, C.surface, 4.5], ['assistant as text', C.assistant, C.assistantWash, 4.5],
    ['ink on the needs wash', C.ink, C.needsWash, 7], ['ink on the assistant wash', C.ink, C.assistantWash, 7],
    ['white words on the deep fill', C.surface, C.needs, 4.5], ['white words on the deep fill', WHITE, C.needs, 4.5],
    ['white words on the ink fill', C.surface, C.ink, 4.5],
  ];

  it.each(TABLE)('%s: %s on %s ≥ %d:1', (_what, fg, bg, floor) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(floor);
  });

  it('the light magenta reaches 5:1 or near it everywhere it is text — not just the floor', () => {
    for (const bg of [C.paper, C.surface, C.assistantWash]) expect(ratio(C.assistant, bg), bg).toBeGreaterThanOrEqual(4.9);
  });

  it('in greyscale the deep one is clearly darker than the light one: at least 20 L* apart (CIE 1976)', () => {
    expect(lab(C.assistant).L - lab(C.needs).L).toBeGreaterThanOrEqual(20);
    // and by luminance, the measure a screen's grey mode uses: more than twice as dark
    expect(luminance(C.assistant) / luminance(C.needs)).toBeGreaterThanOrEqual(1.8);
  });

  it('the deep one is not the ink: a hue the ink does not have, and lighter by at least 10 L*', () => {
    for (const graphite of [C.ink, OLD_GRAPHITE]) {
      expect(lab(C.needs).L - lab(graphite).L, graphite).toBeGreaterThanOrEqual(10);
      expect(lab(graphite).C, graphite).toBeLessThan(6);           // the ink is a near-neutral…
      expect(dE(C.needs, graphite), graphite).toBeGreaterThanOrEqual(40);
    }
    expect(lab(C.needs).C).toBeGreaterThanOrEqual(40);             // …the deep magenta is a colour
  });

  it('the two shades are one family: their hues within 15° (CIELAB), far from the failed red', () => {
    expect(hueGap(lab(C.needs).h, lab(C.assistant).h)).toBeLessThanOrEqual(15);
    for (const m of [C.needs, C.assistant]) expect(dE(m, C.warn), m).toBeGreaterThanOrEqual(25);
  });

  it('every state and secondary text clears 4.5:1 on every ground it sits on', () => {
    for (const bg of [C.paper, C.surface, C.border, C.needsWash, C.assistantWash]) {
      expect(ratio(C.inkSecondary, bg), `stone on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const bg of [C.paper, C.surface]) {
      for (const s of [C.ok, C.warn, C.needs, C.assistant]) expect(ratio(s, bg), `${s} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(C.ink, bg), `ink on ${bg}`).toBeGreaterThanOrEqual(12);
    }
    expect(ratio(C.ok, C.okWash)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(C.warn, C.warnWash)).toBeGreaterThanOrEqual(4.5);
  });

  it('the stylesheets name the two jobs and nothing names the single magenta any more', () => {
    const vars = cssVariables();
    for (const v of ['--color-needs:', '--color-needs-wash:', '--color-assistant:', '--color-assistant-wash:']) expect(vars).toContain(v);
    for (const css of [appCss, doorCss]) {
      expect(css).not.toContain('--color-waiting');
      // no hex outside the tokens' own block: every colour is a var(--…)
      const hexes = rules(css.replace(vars, '')).filter((r) => /#[0-9a-f]{3,8}\b/i.test(r.body)).map((r) => r.sel);
      expect(hexes).toEqual([]);
    }
  });
});

describe('the deep fill marks exactly one kind of act: the one that answers what waits for the owner', () => {
  const NOW = new Date('2026-10-04T09:00:00Z');
  const OWNER = { id: 'p-owner', name: 'Symow', isOwner: true };
  const CHEN = { id: 'p-chen', name: '陈莉', isOwner: false };
  const draft = (over: Partial<ConversationDetail> = {}): ConversationDetail => conversationDetail({
    buyer: 'Aisha Bello', country: 'NG', channel: 'whatsapp', status: 'awaiting',
    messages: [{ direction: 'inbound', text: 'Price for 5,000 pcs?', at: NOW }],
    pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs: $1.45/pc.', capability: 'quote' }, ...over,
  });
  const order = {
    id: 'f0000000-0000-0000-0000-000000000001', conversationId: 'conv-1', productId: 'p1', productName: 'Gift box', quantity: 40, unit: 'boxes',
    unitPrice: usd(2.1), total: usd(84), email: 'customer@example.com', paymentTerms: null, incoterm: null, createdAt: NOW,
  } as unknown as NonNullable<ConversationDetail['orderProposal']>;
  const needsButtons = (html: string) => [...html.matchAll(/<button class="btn send needs"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

  it('one class, a variant of the primary act — never a colour of its own', () => {
    expect(NEEDS_ACT).toBe('btn send needs');
    const body = ruleOf('.btn.send.needs');
    expect(body).toContain('background:var(--color-needs)');
    expect(body).toContain('color:var(--color-surface)');
    expect(body).toContain('border-color:transparent');           // its edge is its fill: magenta draws no frame
    // the ordinary primary act stays the ink
    expect(ruleOf('.btn.send')).toContain('background:var(--color-ink)');
  });

  it('Send on a reply waiting for review, in every language', () => {
    for (const l of LOCALES) {
      const html = renderConversationDetail(draft(), l, NOW, null, OWNER_VIEW);
      expect(needsButtons(html), l).toHaveLength(1);
      expect(html, l).toMatch(/<button class="btn send needs" type="submit" name="command" value="send">/);
    }
  });

  it('Confirm on an order waiting for the owner\'s tap', () => {
    const html = renderConversationDetail(draft({ pendingDraft: null, orderProposal: order }), 'en', NOW, null, OWNER_VIEW);
    expect(html).toMatch(/order\/confirm"[^>]*>\s*<input[^>]*\/>\s*<button class="btn send needs" type="submit">/);
    expect(needsButtons(html)).toHaveLength(1);
  });

  it('Reply in a conversation handed to the reader — ink when a colleague holds it', () => {
    const mine = renderConversationDetail(draft({ pendingDraft: null, ownership: 'OWNER_CONTROLLED', heldBy: OWNER.id, people: [OWNER, CHEN] }),
      'en', NOW, null, { id: OWNER.id, isOwner: true });
    expect(mine).toMatch(/<button class="btn send needs" type="submit">[^<]+<\/button>\s*<\/form>/);
    const theirs = renderConversationDetail(draft({ pendingDraft: null, ownership: 'OWNER_CONTROLLED', heldBy: CHEN.id, people: [OWNER, CHEN] }),
      'en', NOW, null, { id: OWNER.id, isOwner: true });
    expect(needsButtons(theirs)).toEqual([]);
  });

  it('nothing waiting, nothing deep: the assistant\'s conversation, a person waiting to be asked to take it', () => {
    for (const ownership of ['AI', 'WAITING_HUMAN'] as const) {
      expect(needsButtons(renderConversationDetail(draft({ pendingDraft: null, ownership }), 'en', NOW, null, OWNER_VIEW)), ownership).toEqual([]);
    }
  });

  it('Practice rehearses the same three cards, drawn the same way', () => {
    const view = (over: Partial<SandboxView>): SandboxView => ({ hasConversation: true, messages: [], lastTurn: null, ownership: 'AI', ...over });
    expect(needsButtons(renderSandbox(view({ ownership: 'OWNER_CONTROLLED' }), 'en', { flash: null }))).toHaveLength(1);
    expect(needsButtons(renderSandbox(view({}), 'en', { flash: null }))).toEqual([]);
  });

  it('Save and Add stay ink: the variant appears in no other renderer', () => {
    expect(saveBar('Save')).toContain('class="btn send"');
    expect(saveBar('Save')).not.toContain('needs');
    const WEB = join(fileURLToPath(new URL('.', import.meta.url)), '../../src/api/web');
    const where: string[] = [];
    for (const f of readdirSync(WEB).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(WEB, f), 'utf8');
      // a literal class list naming the variant is ad hoc; the renderers take NEEDS_ACT
      if (/class="[^"$]*\bneeds\b[^"]*"/.test(src)) where.push(`${f}: a literal "needs" class`);
      const n = src.match(/\$\{(?:[^}]*\? [^}]*: )?NEEDS_ACT\}/g)?.length ?? 0;
      if (n) where.push(`${f}: ${n}`);
    }
    // the draft's Send, the order's Confirm, the held conversation's Reply; Practice's Reply; the gallery shows it
    expect(where.sort()).toEqual(['components.ts: 1', 'inbox.ts: 3', 'sandbox.ts: 1']);
  });

  it('the component gallery shows the variant beside the ordinary primary act', () => {
    const html = renderComponents('en');
    expect(html.match(/class="btn send needs/g)?.length).toBe(4);   // rest, hover, focus, disabled
  });
});

describe('warm neutrals', () => {
  it('a soft warm off-white page, a warmer white card a step lighter, a warm near-black ink — never pure white or black', () => {
    const paper = lab(C.paper), surface = lab(C.surface), ink = lab(C.ink);
    // warm: a CIELAB hue on the yellow-red side (60–100), and soft: a little chroma, not cream
    for (const [n, x] of [['paper', paper], ['surface', surface], ['ink', ink], ['stone', lab(C.inkSecondary)], ['rule', lab(C.border)]] as const) {
      expect(x.h, n).toBeGreaterThanOrEqual(55);
      expect(x.h, n).toBeLessThanOrEqual(100);
      expect(x.C, n).toBeGreaterThan(1);
      expect(x.C, n).toBeLessThan(8);
    }
    expect(surface.L - paper.L).toBeGreaterThanOrEqual(2);
    expect(surface.L).toBeGreaterThanOrEqual(99);
    expect(ink.L).toBeLessThanOrEqual(15);
    for (const v of [C.paper, C.surface, C.ink]) expect(['#FFFFFF', '#000000']).not.toContain(v.toUpperCase());
  });

  it('light only, said in one place: no dark palette half-made', () => {
    expect(cssVariables()).toContain('color-scheme: light;');
    expect(cssVariables()).not.toContain('prefers-color-scheme');
  });
});

describe('the one warm supporting tone: sand, for quiet surfaces only', () => {
  /**
   * The owner allowed ONE warm tone that is not magenta, for quiet surfaces, if the pass still read
   * flat — and asked to be told. It did, inside the cards: a recess drawn in paper on the warm white
   * was all but invisible (the customer's bubble, the quote box). Sand is that tone, and these are
   * the only places it is drawn: recesses that hold ink or stone words, never a state's.
   */
  const SAND = ['.pc-facts > div', '.langsw', '.pill.owner', '.msg.inbound .bubble', '.chip', '.pill.stop', '.tag', '.cat', '.badge.owner',
    '.fchip', '.ch-info', '.prob', '.pill.corrected', '.dl-who.dl-only', '.cal-empty-i', '.mo-e .kind-icon', '.tabs.lens', '.reasons',
    '.ctx', '.pill.muted', '.pill.wait', '.sbx-banner', '.chip.badge'];

  it('a warm tone, not magenta, a step below the paper; ink, stone and the deep magenta read on it', () => {
    const sand = lab(C.sand);
    expect(sand.h).toBeGreaterThanOrEqual(60);
    expect(sand.h).toBeLessThanOrEqual(100);
    expect(lab(C.paper).L - sand.L).toBeGreaterThanOrEqual(3);
    for (const m of [C.needs, C.assistant]) expect(hueGap(sand.h, lab(m).h)).toBeGreaterThanOrEqual(60);
    expect(ratio(C.ink, C.sand)).toBeGreaterThanOrEqual(12);
    expect(ratio(C.inkSecondary, C.sand)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(C.needs, C.sand)).toBeGreaterThanOrEqual(7);
    expect(ratio(C.assistant, C.sand)).toBeGreaterThanOrEqual(4.5);
  });

  it('drawn on exactly the quiet surfaces, and never under a state\'s words', () => {
    const on = rules(appCss).filter((r) => /background:var\(--color-sand\)/.test(r.body));
    expect(on.flatMap((r) => r.sel.split(',').map((x) => x.trim())).sort()).toEqual([...SAND].sort());
    for (const r of on) expect(r.body, r.sel).not.toMatch(/(?:^|[;\s])color:\s*var\(--color-(ok|warn|needs|assistant)\)/);
    // a state pill or chip keeps its own wash over the neutral one
    for (const sel of ['.pill.ok', '.pill.bad', '.pill.warn', '.chip.auto', '.chip.draft', '.chip.warn']) expect(ruleOf(sel), sel).toMatch(/background:var\(--color-[a-z]+-wash\)/);
  });
});

describe('warm shadows: the rounded cards read as objects', () => {
  const S = DESIGN_TOKENS.shadow;

  it('two lifts, each warm (a brown, never grey or black) and gentle', () => {
    expect(Object.keys(S).sort()).toEqual(['lift1', 'lift2']);
    for (const [k, v] of Object.entries(S)) {
      const layers = [...v.matchAll(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)];
      expect(layers.length, k).toBe(3);
      for (const m of layers) {
        const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
        expect(r > g && g > b, `${k} is warm`).toBe(true);
        expect(a, `${k} is gentle`).toBeLessThanOrEqual(0.15);
      }
    }
  });

  it('cards, menus, the lists, the profile card and the calendar\'s grid rest on a shadow, not a drawn border', () => {
    for (const sel of ['.card', '.scard', '.irows', '.crows', '.attn', '.pcard', '.wk-scroll', '.dl', '.tw-list', '.kitem', '.gap', '.guide-step', '.empty', '.block.level-control']) {
      const body = ruleOf(sel);
      expect(body, sel).toMatch(/box-shadow:var\(--shadow-lift[12]\)/);
      expect(body, sel).not.toMatch(/(^|;|\s)border:\s*1px/);
    }
    // what rises over the page rises higher
    for (const sel of ['dialog.ask', '.toast', 'dialog.sheet .pcard']) expect(ruleOf(sel), sel).toContain('box-shadow:var(--shadow-lift2)');
  });
});

describe('faces carry real colour, and never a signal\'s', () => {
  const tints = DESIGN_TOKENS.faceTint;

  it('eight full, warm mid-tones under a white letter: each letter ≥ 4.5:1 on its ground', () => {
    expect(tints).toHaveLength(8);
    for (const f of tints) {
      expect(f.fg).toBe(WHITE);
      expect(ratio(f.fg, f.bg), f.bg).toBeGreaterThanOrEqual(4.5);
      expect(lab(f.bg).C, `${f.bg} is a colour`).toBeGreaterThanOrEqual(25);
    }
  });

  it('far from both magentas (40° of hue at least), and not the ok green nor the failed red (ΔE ≥ 25)', () => {
    for (const f of tints) {
      for (const m of [C.needs, C.assistant]) expect(hueGap(lab(f.bg).h, lab(m).h), `${f.bg} vs ${m}`).toBeGreaterThanOrEqual(40);
      for (const s of [C.ok, C.warn]) expect(dE(f.bg, s), `${f.bg} vs ${s}`).toBeGreaterThanOrEqual(25);
    }
  });

  it('eight hues a reader tells apart: no two within 15° (CIELAB)', () => {
    for (let i = 0; i < tints.length; i++) for (let j = i + 1; j < tints.length; j++) {
      const close = hueGap(lab(tints[i]!.bg).h, lab(tints[j]!.bg).h) < 15 && dE(tints[i]!.bg, tints[j]!.bg) < 20;
      expect(close, `${tints[i]!.bg} and ${tints[j]!.bg}`).toBe(false);
    }
  });

  it('Your data\'s deletion list names each customer with their face; one erased keeps a quiet outline', () => {
    const NOW = new Date('2026-10-04T09:00:00Z');
    const ask = { id: 'a1', askedAt: NOW, asks: 1, conversationId: 'c1', words: 'delete my data', buyer: 'Maya', clientId: '5a1e0000-0000-4000-8000-0000000000aa' };
    const buyers = [{ id: 'r1', scope: 'buyer' as const, subjectNote: null, askedBy: 'owner', askedAt: NOW, state: 'done' as const, closedAt: NOW, closedNote: null,
      buyer: null, conversationId: null, clientId: null }];
    for (const l of LOCALES) {
      const html = renderDataRights({ requests: [], buyers, asks: [ask], businessName: 'B' }, l, null, OWNER_VIEW, 'Setup');
      expect(html, l).toMatch(/<li class="row has-face"><a class="face-link" href="\/app\/customers\/5a1e0000-0000-4000-8000-0000000000aa" data-card[^>]*><span class="face face-s t\d"/);
      expect(html, l).toMatch(/<li class="row has-face"><span class="face face-s t\d" aria-hidden="true"><span class="face-i"><svg/);
    }
  });

  it('the conversation\'s customer panel leads with their face', () => {
    const p = { clientId: '5a1e0000-0000-4000-8000-0000000000aa', name: 'Aisha Bello', photo: null, country: 'NG', channel: 'whatsapp', address: null, language: 'en',
      firstWrote: null, conversations: 1, askedAbout: [], prices: [], samples: [], promised: [], orders: [], activity: [] } as CustomerPanel;
    expect(renderCustomerPanel(p, [], 'ar', new Date(), 'conv-1')).toMatch(/<div class="pn-who"><span class="face face-m t\d" aria-hidden="true"><span class="face-i">A<\/span><\/span><h2><bdi>Aisha Bello<\/bdi><\/h2><\/div>/);
  });
});
