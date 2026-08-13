import { describe, it, expect } from 'vitest';
import {
  renderSandbox, evaluateTrust,
  type SandboxView, type SandboxTrust,
} from '../../src/api/web/sandbox.js';
import { sandboxSeedSql, SANDBOX_BUSINESS_ID } from '../../src/demo/sandbox.js';
import { SCENARIOS, TRUST_PRODUCT_ID, analysis } from '../../src/trust/scenarios.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { computeTurn, commitTurn } from '../../src/pipeline/turn.js';
import { FakeTenant, FakeAnalyzer, FakeReplyWriter, FakeRetriever } from '../pipeline/fakes.js';
import { emptyState, CONVERSATION } from './fixtures.js';
import type { AutonomyGrant } from '../../src/core/conversation/autonomy.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

// ── fixtures ───────────────────────────────────────────────────────────────

const passCheck = (invariant: SandboxTrust['checks'][number]['invariant']) =>
  ({ invariant, pass: true, detail: 'ok' } as const);

const view = (over: Partial<SandboxView> = {}): SandboxView => ({
  hasConversation: true, messages: [], pendingDraft: null, lastTurn: null, ownership: 'AI', ...over,
});

const trust = (over: Partial<SandboxTrust> = {}): SandboxTrust => ({
  mode: 'scripted', scenarioId: null, scenarioTitle: null, capability: 'quote', appliedMode: 'draft',
  guardViolations: 0, handoff: false, quote: null,
  checks: [passCheck('priceFloorRespected'), passCheck('noSilentCapabilityEscalation')],
  ...over,
});

// ── isolation ──────────────────────────────────────────────────────────────

describe('M12.2 · sandbox isolation (structural)', () => {
  it('the seed creates NO channel credential — a webhook can never route to it', () => {
    const seed = sandboxSeedSql();
    expect(seed).not.toMatch(/insert\s+into\s+channel_credentials/i);
    // and no channels row either — it is unreachable from any provider surface.
    expect(seed).not.toMatch(/insert\s+into\s+channels\b/i);
  });

  it('the sandbox tenant id is distinct from the demo and the pilot defaults', () => {
    expect(SANDBOX_BUSINESS_ID).not.toBe('de300000-0000-4000-8000-0000000000b1'); // demo
    expect(SANDBOX_BUSINESS_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the seed provisions the trust product + a floor + draft-first autonomy', () => {
    const seed = sandboxSeedSql();
    expect(seed).toContain(TRUST_PRODUCT_ID as string);
    expect(seed).toMatch(/insert into pricing_policy/i);
    expect(seed).toMatch(/insert into autonomy_policy/i);
    expect(seed).not.toMatch(/mode\s*=\s*'auto'/i);   // nothing auto-sends by default
  });
});

// ── web render ─────────────────────────────────────────────────────────────

describe('M12.2 · sandbox surface (localized renderer)', () => {
  it('always shows the simulation banner + the reset/composer, in en/zh/ar', () => {
    for (const l of LOCALES) {
      const html = renderSandbox(view(), l, { mode: 'scripted', liveAvailable: false, flash: null });
      expect(html).toContain(t(l, 'sandbox.banner'));           // "This is practice only…"
      expect(html).toContain('action="/app/sandbox/message"');  // composer
      expect(html).toContain('action="/app/sandbox/scenario"'); // scenario loader
      expect(html).toContain('action="/app/sandbox/reset"');    // reset
      expect(html).toContain(t(l, 'sandbox.reset'));
      expect(html).toContain(t(l, 'sandbox.empty'));            // no messages yet
    }
  });

  it('lists every golden scenario as a loadable test case (owner-facing name)', () => {
    const html = renderSandbox(view(), 'en', { mode: 'scripted', liveAvailable: true, flash: null });
    for (const s of SCENARIOS) expect(html).toContain(`value="${s.id}"`);
    // M16.4b: the picker shows the owner label, never the engineering title.
    expect(html).toContain(t('en', `sandbox.case.${SCENARIOS[0]!.id}` as MessageKey));
    expect(html).not.toContain(SCENARIOS[0]!.title);
  });

  it('mode toggle: scripted is the default; live is offered only when available', () => {
    const on = renderSandbox(view(), 'en', { mode: 'scripted', liveAvailable: true, flash: null });
    expect(on).toMatch(/name="mode" value="scripted"[^>]*checked/);
    expect(on).toContain('value="live"');
    const off = renderSandbox(view(), 'en', { mode: 'scripted', liveAvailable: false, flash: null });
    expect(off).not.toContain('value="live"');            // no live radio
    expect(off).toContain(t('en', 'sandbox.mode.live'));  // shown, but disabled label
  });

  it('renders the transcript with buyer + employee bubbles', () => {
    const v = view({ messages: [
      { direction: 'inbound', text: 'do you have canvas bags?', isImage: false },
      { direction: 'outbound', text: 'Yes — what quantity?', isImage: false },
    ] });
    const html = renderSandbox(v, 'en', { mode: 'scripted', liveAvailable: false, flash: null });
    expect(html).toContain('do you have canvas bags?');
    expect(html).toContain('Yes — what quantity?');
    expect(html).toContain('msg inbound');
    expect(html).toContain('msg outbound');
  });

  it('a pending draft shows the same approve/skip/revoke controls, posting to the sandbox', () => {
    const v = view({ pendingDraft: { draftId: 'draft-1', draftText: 'Our MOQ is 1,000 pcs.' } });
    const html = renderSandbox(v, 'en', { mode: 'scripted', liveAvailable: false, flash: null });
    expect(html).toContain('Our MOQ is 1,000 pcs.');
    expect(html).toContain('action="/app/sandbox/act"');
    expect(html).toContain('value="发送"');   // wire command, localized label
    expect(html).toContain('value="不回"');
    expect(html).toContain('value="收回"');
  });

  it('trust strip: none-state until a turn runs; then verdict + localized labels', () => {
    const none = renderSandbox(view(), 'en', { mode: 'scripted', liveAvailable: false, flash: null });
    expect(none).toContain(t('en', 'sandbox.trust.none'));

    const passing = renderSandbox(view({ lastTurn: trust() }), 'en', { mode: 'scripted', liveAvailable: false, flash: null });
    expect(passing).toContain(t('en', 'sandbox.trust.allPass'));
    expect(passing).toContain('✓');
    expect(passing).toContain(t('en', 'sandbox.inv.priceFloorRespected'));
    expect(passing).toContain(t('en', 'sandbox.xray.deliveryDraft'));   // held for approval

    const failing = renderSandbox(view({ lastTurn: trust({
      checks: [{ invariant: 'noUnsupportedClaim', pass: false, detail: 'LEAKED: CE certified' }],
    }) }), 'en', { mode: 'scripted', liveAvailable: false, flash: null });
    expect(failing).toContain(t('en', 'sandbox.trust.someFail'));
    expect(failing).toContain('✗');
  });

  it('a scenario turn is badged with its owner-facing name', () => {
    const s = SCENARIOS[0]!;
    const html = renderSandbox(view({ lastTurn: trust({ scenarioId: s.id, scenarioTitle: s.title }) }), 'en',
      { mode: 'scripted', liveAvailable: false, flash: null });
    expect(html).toContain(t('en', 'sandbox.scenario.badge'));
    expect(html).toContain(t('en', `sandbox.case.${s.id}` as MessageKey));
    expect(html).not.toContain(s.title);   // the engineering title stays internal
  });
});

// ── controller trust logic, off a FakeTenant (no DB) ─────────────────────────

type FakeSetup = {
  text: string;
  state?: Parameters<typeof emptyState>[0];
  analyzerNext?: Analysis;
  replies?: string[];
  retrieverResults?: FakeRetriever['results'];
  grants?: AutonomyGrant[];
};

async function runFake(s: FakeSetup) {
  const tenant = new FakeTenant();
  tenant.grantRows = s.grants ?? [];
  tenant.seed(CONVERSATION, emptyState(s.state ?? {}));
  const retriever = new FakeRetriever();
  if (s.retrieverResults !== undefined) retriever.results = s.retrieverResults;
  const analyzer = new FakeAnalyzer();
  analyzer.next = s.analyzerNext ?? analysis();
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = s.replies ?? ['How can I help?'];
  const ports = { tenant, retriever, analyzer, replyWriter, now: () => new Date('2026-07-14T12:00:00Z') };
  const req = { conversationId: CONVERSATION, messageId: 'm-1', text: s.text };
  const result = await computeTurn(ports, req);
  const effects = await commitTurn(ports, req, result, Date.now());
  const floorPrice = result.quote ? (await tenant.catalog.pricingPolicy(result.quote.productId))?.floorPrice ?? null : null;
  return { result, effects, grants: tenant.grantRows, floorPrice };
}

describe('M12.2 · evaluateTrust — the same M12.1 checkers, live off a FakeTenant', () => {
  it('a draft-mode reply passes the universal checks and is marked held-for-approval', async () => {
    const r = await runFake({ text: 'hello, interested in your bags', replies: ['What quantity are you after?'] });
    const out = evaluateTrust({
      mode: 'scripted', expectations: [
        { invariant: 'noSilentCapabilityEscalation' },
        { invariant: 'noFabricatedPrice' },
        { invariant: 'noUnsupportedClaim', forbidden: ['CE certified'] },
      ],
      result: r.result, effects: r.effects, grants: r.grants, now: new Date('2026-07-14T12:00:00Z'), floorPrice: r.floorPrice,
    });
    expect(out.mode).toBe('scripted');
    expect(out.scenarioTitle).toBeNull();
    expect(out.appliedMode).toBe('draft');
    expect(out.checks.every((c) => c.pass)).toBe(true);
  });

  it('an explicit human request is scored as an escalation', async () => {
    const r = await runFake({ text: 'I want to speak to a real person now', state: { phase: 'qualification' } });
    const out = evaluateTrust({
      mode: 'scripted', expectations: [{ invariant: 'escalatesToHuman' }],
      result: r.result, effects: r.effects, grants: r.grants, now: new Date('2026-07-14T12:00:00Z'), floorPrice: r.floorPrice,
    });
    expect(out.handoff).toBe(true);
    expect(out.checks[0]!.pass).toBe(true);
  });

  it('an invented certification is stripped, and the check confirms it never shipped', async () => {
    const r = await runFake({
      text: 'are these certified?',
      state: {
        phase: 'commercial_discussion',
        product: { productId: TRUST_PRODUCT_ID, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
        quantity: { value: 5000, unit: 'pcs' },
      },
      analyzerNext: analysis({ productId: TRUST_PRODUCT_ID, confidence: 0.95, confirmed: true, quantity: 5000, phase: 'commercial_discussion' }),
      replies: ['Yes — CE certified and FDA approved.', 'Yes — CE certified and FDA approved.'],
    });
    const out = evaluateTrust({
      mode: 'scripted', expectations: [
        { invariant: 'noUnsupportedClaim', forbidden: ['CE certified', 'FDA approved'] },
        { invariant: 'priceFloorRespected' },
      ],
      result: r.result, effects: r.effects, grants: r.grants, now: new Date('2026-07-14T12:00:00Z'), floorPrice: r.floorPrice,
    });
    expect(out.guardViolations).toBeGreaterThan(0);
    expect(out.checks.every((c) => c.pass)).toBe(true);   // claim stripped, floor respected
  });
});

/**
 * M16.3 — the sandbox rehearses the SAME human-control lifecycle as the inbox:
 * one ownership model (ownershipOf), one set of takeover.* words, one set of
 * services. These pin the controls to ownership and prove no sandbox-specific
 * vocabulary or second send path leaked in.
 */
describe('M16.3 · sandbox human-control rehearsal (localized renderer)', () => {
  const at = (o: SandboxView['ownership']) =>
    renderSandbox(view({ ownership: o }), 'en', { mode: 'scripted', liveAvailable: false, flash: null });

  it('AI: employee-handling status + Take over; no reply/return controls', () => {
    const html = at('AI');
    expect(html).toContain(t('en', 'takeover.status.ai'));
    expect(html).toContain('action="/app/sandbox/takeover"');
    expect(html).toContain(t('en', 'takeover.action.take'));
    expect(html).not.toContain('action="/app/sandbox/reply"');
    expect(html).not.toContain('action="/app/sandbox/resume"');
  });

  it('WAITING_HUMAN: waiting status + Take over (same words as the inbox)', () => {
    const html = at('WAITING_HUMAN');
    expect(html).toContain(t('en', 'takeover.status.waiting'));
    expect(html).toContain('action="/app/sandbox/takeover"');
    expect(html).not.toContain('action="/app/sandbox/reply"');
  });

  it('OWNER_CONTROLLED: reply box + return-to-employee; the draft card steps aside', () => {
    const v = view({ ownership: 'OWNER_CONTROLLED', pendingDraft: { draftId: 'd-1', draftText: 'Our MOQ is 1,000 pcs.' } });
    const html = renderSandbox(v, 'en', { mode: 'scripted', liveAvailable: false, flash: null });
    expect(html).toContain(t('en', 'takeover.status.owner'));
    expect(html).toContain('action="/app/sandbox/reply"');
    expect(html).toContain('name="text"');
    expect(html).toContain('action="/app/sandbox/resume"');
    expect(html).toContain(t('en', 'takeover.action.resume'));
    expect(html).not.toContain('action="/app/sandbox/act"');   // no draft approval while the owner holds it
  });

  it('controls carry the sandbox mode so a rehearsal never changes lane', () => {
    for (const mode of ['scripted', 'live'] as const) {
      const html = renderSandbox(view({ ownership: 'OWNER_CONTROLLED' }), 'en', { mode, liveAvailable: true, flash: null });
      expect(html).toContain(`value="${mode}"`);
    }
  });

  it('no controls at all before a conversation exists', () => {
    const html = renderSandbox(view({ hasConversation: false }), 'en', { mode: 'scripted', liveAvailable: false, flash: null });
    expect(html).not.toContain('action="/app/sandbox/takeover"');
    expect(html).not.toContain('action="/app/sandbox/reply"');
  });

  it('every ownership state renders in en/zh/ar with no technical vocabulary', () => {
    // Scoped to the control card: the rest of the page carries the M12.2
    // scenario picker, whose titles are developer-authored test-case names.
    const card = (html: string) => html.match(/<div class="card takeover[\s\S]*?<\/div>\s*<div class="card sbx-trust/)?.[0] ?? '';
    for (const l of LOCALES) {
      for (const o of ['AI', 'WAITING_HUMAN', 'OWNER_CONTROLLED'] as const) {
        const html = renderSandbox(view({ ownership: o }), l, { mode: 'scripted', liveAvailable: false, flash: null });
        expect(html).toContain(t(l, `takeover.status.${o === 'AI' ? 'ai' : o === 'WAITING_HUMAN' ? 'waiting' : 'owner'}`));
        const low = card(html).toLowerCase();
        expect(low.length, `${l}/${o}: control card found`).toBeGreaterThan(0);
        for (const banned of ['llm', 'model', 'webhook', 'database', 'confidence', '模型', '人工智能', '数据库']) {
          const hit = /^[a-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(low) : low.includes(banned);
          expect(hit, `${l}/${o}:"${banned}"`).toBe(false);
        }
      }
    }
  });
});

/**
 * M16.4b — the sandbox is an owner surface, so the practice cases must read as
 * owner language. The engineering titles in src/trust/scenarios.ts are untouched
 * (CI and the trust harness still use them); only the display layer changes.
 */
describe('M16.4b · owner-facing practice-case names', () => {
  it('every scenario has a display key, present and non-empty in all locales', () => {
    for (const s of SCENARIOS) {
      const key = `sandbox.case.${s.id}` as MessageKey;
      for (const l of LOCALES) {
        const label = t(l, key);
        expect(label, `${l}:${s.id}`).not.toBe(key);      // t() returns the key when missing
        expect(label.trim().length, `${l}:${s.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('no engineering title reaches the rendered page, in any locale', () => {
    for (const l of LOCALES) {
      const html = renderSandbox(view(), l, { mode: 'scripted', liveAvailable: true, flash: null });
      for (const s of SCENARIOS) expect(html, `${l}:${s.id}`).not.toContain(s.title);
    }
  });

  it('the picker carries no engineering vocabulary — in any locale', () => {
    const picker = (html: string) => html.match(/<select[\s\S]*?<\/select>/)?.[0] ?? '';
    for (const l of LOCALES) {
      const html = renderSandbox(view(), l, { mode: 'scripted', liveAvailable: true, flash: null });
      const opts = picker(html);
      expect(opts.length, `${l}: picker found`).toBeGreaterThan(0);
      // option VALUES are scenario ids (the wire contract) — check the labels only.
      const labels = [...opts.matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1]!).join(' \n ').toLowerCase();
      for (const banned of ['confidence', 'incoterm', 'ddp', 'policy row', 'grant', 'auto-grant', 'catalog', 'invariant', 'harness', '模型', '人工智能']) {
        expect(labels.includes(banned), `${l}:"${banned}"`).toBe(false);
      }
      expect(/\bai\b/.test(labels), `${l}:"ai"`).toBe(false);
    }
  });

  it('scenario ids remain the wire contract (values unchanged)', () => {
    const html = renderSandbox(view(), 'zh', { mode: 'scripted', liveAvailable: true, flash: null });
    for (const s of SCENARIOS) expect(html).toContain(`value="${s.id}"`);
  });
});

/**
 * M20.4 (F-04) — the M21 rehearsal found practice silently dead on a fresh
 * factory: it wrote turns to a hard-coded tenant only an operator script
 * creates, so choosing a case did nothing at all, with no error.
 */
describe('M20.4 · F-04 · scripted practice needs no tenant, and says what it proves', () => {
  it('THE M21 REPRODUCTION: it runs with no database and no sandbox tenant', async () => {
    const { runScriptedPractice } = await import('../../src/api/web/sandbox.js');
    const r = await runScriptedPractice();          // no Db argument exists to pass
    expect(r.total).toBeGreaterThan(20);
    expect(r.passed).toBe(r.total);                 // the golden safety set
  });

  it('the golden set is unchanged — practice IS the regression set', async () => {
    const { runScriptedPractice } = await import('../../src/api/web/sandbox.js');
    const { SCENARIOS } = await import('../../src/trust/scenarios.js');
    const r = await runScriptedPractice();
    expect(r.total).toBe(SCENARIOS.length);
    expect(new Set(r.cases.map((c) => c.id))).toEqual(new Set(SCENARIOS.map((s) => s.id)));
  });

  it('states what it proves AND what it does not', async () => {
    const { runScriptedPractice, renderPractice } = await import('../../src/api/web/sandbox.js');
    const html = renderPractice(await runScriptedPractice(), 'en');
    expect(html).toContain('will not quote below your floor');
    expect(html).toContain('will not claim a certification you have not confirmed');
    expect(html).toContain('What it does not prove');
    expect(html).toContain('whether WhatsApp delivers it');
  });

  it('shows a real count, never a score or a percentage', async () => {
    const { runScriptedPractice, renderPractice } = await import('../../src/api/web/sandbox.js');
    const r = await runScriptedPractice();
    const html = renderPractice(r, 'en').replace(/<style>[\s\S]*?<\/style>/g, '');
    expect(html).toContain(`${r.passed} / ${r.total}`);
    expect(html).not.toMatch(/\d+\s*%/);
    for (const banned of ['score', 'grade', 'rating']) expect(html.toLowerCase()).not.toContain(banned);
  });

  it('renders in all three locales with each case named in the owner’s words', async () => {
    const { runScriptedPractice, renderPractice } = await import('../../src/api/web/sandbox.js');
    const r = await runScriptedPractice();
    for (const l of LOCALES) {
      const html = renderPractice(r, l);
      expect(html.length).toBeGreaterThan(800);
      expect(html).not.toContain('sandbox.case.');       // every id resolved to copy
    }
    expect(renderPractice(r, 'zh')).toContain('练习——安全检查');
    expect(renderPractice(r, 'ar')).toContain('فحوص السلامة');
  });
});
