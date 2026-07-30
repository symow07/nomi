import { describe, it, expect } from 'vitest';
import {
  renderSandbox, evaluateTrust,
  type SandboxView, type SandboxTrust,
} from '../../src/api/web/sandbox.js';
import { sandboxSeedSql, SANDBOX_BUSINESS_ID } from '../../src/demo/sandbox.js';
import { SCENARIOS, TRUST_PRODUCT_ID, analysis } from '../../src/trust/scenarios.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { computeTurn, commitTurn } from '../../src/pipeline/turn.js';
import { FakeTenant, FakeAnalyzer, FakeReplyWriter, FakeRetriever } from '../pipeline/fakes.js';
import { emptyState, CONVERSATION } from './fixtures.js';
import type { AutonomyGrant } from '../../src/core/conversation/autonomy.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

// ── fixtures ───────────────────────────────────────────────────────────────

const passCheck = (invariant: SandboxTrust['checks'][number]['invariant']) =>
  ({ invariant, pass: true, detail: 'ok' } as const);

const view = (over: Partial<SandboxView> = {}): SandboxView => ({
  hasConversation: true, messages: [], pendingDraft: null, lastTurn: null, ...over,
});

const trust = (over: Partial<SandboxTrust> = {}): SandboxTrust => ({
  mode: 'scripted', scenarioTitle: null, capability: 'quote', appliedMode: 'draft',
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
      expect(html).toContain(t(l, 'sandbox.banner'));           // "Simulation only…"
      expect(html).toContain('action="/app/sandbox/message"');  // composer
      expect(html).toContain('action="/app/sandbox/scenario"'); // scenario loader
      expect(html).toContain('action="/app/sandbox/reset"');    // reset
      expect(html).toContain(t(l, 'sandbox.reset'));
      expect(html).toContain(t(l, 'sandbox.empty'));            // no messages yet
    }
  });

  it('lists every golden scenario as a loadable test case', () => {
    const html = renderSandbox(view(), 'en', { mode: 'scripted', liveAvailable: true, flash: null });
    for (const s of SCENARIOS) expect(html).toContain(`value="${s.id}"`);
    expect(html).toContain(SCENARIOS[0]!.title);
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

  it('a scenario turn is badged with its title', () => {
    const html = renderSandbox(view({ lastTurn: trust({ scenarioTitle: SCENARIOS[0]!.title }) }), 'en',
      { mode: 'scripted', liveAvailable: false, flash: null });
    expect(html).toContain(t('en', 'sandbox.scenario.badge'));
    expect(html).toContain(SCENARIOS[0]!.title);
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
  const floorPriceUsd = result.quote ? (await tenant.catalog.pricingPolicy(result.quote.productId))?.floorPriceUsd ?? null : null;
  return { result, effects, grants: tenant.grantRows, floorPriceUsd };
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
      result: r.result, effects: r.effects, grants: r.grants, now: new Date('2026-07-14T12:00:00Z'), floorPriceUsd: r.floorPriceUsd,
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
      result: r.result, effects: r.effects, grants: r.grants, now: new Date('2026-07-14T12:00:00Z'), floorPriceUsd: r.floorPriceUsd,
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
      result: r.result, effects: r.effects, grants: r.grants, now: new Date('2026-07-14T12:00:00Z'), floorPriceUsd: r.floorPriceUsd,
    });
    expect(out.guardViolations).toBeGreaterThan(0);
    expect(out.checks.every((c) => c.pass)).toBe(true);   // claim stripped, floor respected
  });
});
