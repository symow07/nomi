import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db, type Tx } from '../../db/client.js';
import { tenantRepos } from '../../db/repos.js';
import { hybridRetriever } from '../../retrieval/hybrid.js';
import { ensureConversation } from '../../db/channels.js';
import { computeTurn, commitTurn, BUSINESS_TZ, type TurnPorts, type TurnResult, type TurnEffects } from '../../pipeline/turn.js';
import { capabilityOf, resolveMode, type AutonomyGrant } from '../../core/conversation/autonomy.js';
import type { Analyzer, ReplyWriter } from '../../llm/ports.js';
import type { Analysis } from '../../core/conversation/decide.js';
import type { Retriever, RetrievedProduct } from '../../retrieval/ports.js';
import type { BusinessId } from '../../core/types/ids.js';
import { parseBusinessId, parseConversationId } from '../../core/types/ids.js';
import { ownershipOf, type ConversationOwnership } from '../../core/conversation/ownership.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, capabilityName, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatUsd } from '../../core/owner/i18n/format.js';
import {
  SCENARIOS, analysis as buildAnalysis, candidate as toCandidate,
  type Expectation, type Scenario,
} from '../../trust/scenarios.js';
import { runCheck, type CheckResult, type TurnOutcome } from '../../trust/invariants.js';
import { esc } from './layout.js';

/**
 * M12.2 — Interactive pilot sandbox.
 *
 * The owner plays the buyer; each message runs through the REAL engine
 * (computeTurn → commitTurn) against a dedicated sandbox tenant — a SECOND
 * CALLER of the same functions the worker runs, never a second engine. Replies
 * either auto-"send" or become a pending draft resolved through the existing
 * applyOwnerCommand. Every turn is scored live by the M12.1 trust invariants.
 *
 * No Meta, no network send, no production-inbox changes: the sandbox tenant has
 * no channel credential (unroutable), and "delivery" is a recorded message row.
 */

export type SandboxMode = 'scripted' | 'live';

export type SandboxDeps = {
  readonly db: Db;
  readonly businessId: string;          // the sandbox tenant (never the pilot)
  readonly now: () => Date;
  /** Present only when Live AI is enabled; absent → scripted only. */
  readonly analyzer?: Analyzer | undefined;
  readonly replyWriter?: ReplyWriter | undefined;
};

// A fixed simulated-buyer identity. Reset archives the conversation, not the
// client, so this wa_id persists and a fresh conversation is created next turn.
const SANDBOX_WA_ID = 'sandbox-buyer';
const SANDBOX_BUYER_NAME = 'Buyer (you)';
const DEFAULT_REPLY = 'Thanks for your message — could you tell me a little more about what you need?';

/** Universal invariants evaluated on a free-typed (non-scenario) turn. */
const DEFAULT_INVARIANTS: readonly Expectation[] = [
  { invariant: 'priceFloorRespected' },
  { invariant: 'noFabricatedPrice' },
  { invariant: 'noSilentCapabilityEscalation' },
  { invariant: 'noUnsupportedClaim', forbidden: ['CE certified', 'FDA approved', 'DDP', 'money-back', 'refund guarantee', 'ISO 9001'] },
];

// ── stub ports (scripted mode) — the same seam M12.1 fakes, in src ────────────

class ScriptedRetriever implements Retriever {
  constructor(private readonly results: readonly RetrievedProduct[]) {}
  async byText(): Promise<RetrievedProduct[]> { return [...this.results]; }
  async byImageDescription(): Promise<RetrievedProduct[]> { return [...this.results]; }
  async explore(): Promise<RetrievedProduct[]> { return [...this.results]; }
}
class ScriptedAnalyzer implements Analyzer {
  constructor(private readonly analysis: Analysis) {}
  async analyze() {
    return { analysis: this.analysis, promptVersion: 'sandbox@scripted', modelId: 'scripted', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
class ScriptedReplyWriter implements ReplyWriter {
  constructor(private readonly reply: string) {}
  async write() {
    return { reply: this.reply, promptVersion: 'sandbox@scripted', modelId: 'scripted', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

// ── low-level helpers ─────────────────────────────────────────────────────────

const bidOf = (raw: string): BusinessId => {
  const p = parseBusinessId(raw);
  if (!p.ok) throw new Error(`sandbox: invalid business id`);
  return p.value;
};

/** Record a transcript row. clock_timestamp() guarantees inbound < outbound order. */
async function recordMessage(tx: Tx, conversationId: string, direction: 'inbound' | 'outbound', inputType: 'text' | 'image', text: string): Promise<void> {
  await sql`
    insert into messages (conversation_id, direction, input_type, text_content, sent_at)
    values (${conversationId}, ${direction}, ${inputType}, ${text}, clock_timestamp())
  `.execute(tx);
}

async function findActiveConversation(tx: Tx, businessId: BusinessId): Promise<string | null> {
  const r = await sql<{ id: string }>`
    select c.id from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp' and cc.channel_user_id = ${SANDBOX_WA_ID}
     where c.business_id = ${businessId} and c.is_active
     order by c.created_at desc limit 1
  `.execute(tx);
  return r.rows[0]?.id ?? null;
}

function buildPorts(mode: SandboxMode, scenario: Scenario | undefined, tx: Tx, businessId: BusinessId, deps: SandboxDeps): TurnPorts {
  const tenant = tenantRepos(tx, businessId);
  if (mode === 'live' && deps.analyzer && deps.replyWriter) {
    return { tenant, retriever: hybridRetriever(tx, businessId), analyzer: deps.analyzer, replyWriter: deps.replyWriter, now: deps.now };
  }
  // Scripted: deterministic stub ports, seeded from the scenario when present.
  const a = scenario?.analysis ?? buildAnalysis();
  const reply = scenario?.proposedReply ?? DEFAULT_REPLY;
  const candidates: readonly RetrievedProduct[] = scenario
    ? (scenario.candidates === 'none' ? [] : scenario.candidates ?? (scenario.catalog?.map(toCandidate) ?? []))
    : [];
  return { tenant, retriever: new ScriptedRetriever(candidates), analyzer: new ScriptedAnalyzer(a), replyWriter: new ScriptedReplyWriter(reply), now: deps.now };
}

// ── the turn ──────────────────────────────────────────────────────────────────

export type SandboxTurnInput = {
  readonly mode: SandboxMode;
  readonly text?: string;
  readonly kind?: 'text' | 'image';
  readonly scenarioId?: string;
};

/** Run one simulated buyer turn through the real engine, persist it, score it. */
export async function runSandboxTurn(deps: SandboxDeps, input: SandboxTurnInput): Promise<void> {
  const businessId = bidOf(deps.businessId);
  const scenario = input.scenarioId ? SCENARIOS.find((s) => s.id === input.scenarioId) : undefined;
  const text = (scenario ? scenario.buyer.text : input.text ?? '').trim();
  if (!text) return;
  const kind: 'text' | 'image' = scenario ? (scenario.buyer.kind === 'image' ? 'image' : 'text') : (input.kind ?? 'text');
  const started = deps.now().getTime();

  await withTenantTx(deps.db, businessId, async (tx) => {
    const { conversationId } = await ensureConversation(tx, businessId, SANDBOX_WA_ID, SANDBOX_BUYER_NAME);
    const cid = parseConversationId(conversationId);
    if (!cid.ok) return;
    await lockConversation(tx, conversationId);
    await recordMessage(tx, conversationId, 'inbound', kind, text);

    const ports = buildPorts(input.mode, scenario, tx, businessId, deps);
    const req = { conversationId: cid.value, messageId: `sbx-${started}-${Math.random().toString(36).slice(2, 8)}`, text };
    const result = await computeTurn(ports, req);
    const effects = await commitTurn(ports, req, result, started);
    if (effects.outbound) await recordMessage(tx, conversationId, 'outbound', 'text', effects.outbound.reply);

    // ── trust strip: the SAME M12.1 checkers, live ──────────────────────────
    const grants = await ports.tenant.autonomy.grants();
    const policy = result.quote ? await ports.tenant.catalog.pricingPolicy(result.quote.productId) : null;
    // respectsAutonomy encodes a scenario's OWN fake grant; the live sandbox is
    // governed by the tenant's real (draft-first) policy, so drop it here — the
    // universal noSilentCapabilityEscalation covers "applied matches policy".
    const scenarioExp = scenario?.expect.filter((e) => e.invariant !== 'respectsAutonomy') ?? [];
    const trust = evaluateTrust({
      mode: input.mode, scenario,
      expectations: scenario && scenarioExp.length > 0 ? scenarioExp : DEFAULT_INVARIANTS,
      result, effects, grants, now: deps.now(), floorPriceUsd: policy?.floorPriceUsd ?? null,
    });
    await sql`
      insert into conversation_events (business_id, conversation_id, type, payload)
      values (${businessId}, ${conversationId}, 'sandbox_turn', ${JSON.stringify(trust)}::jsonb)
    `.execute(tx);
  });
}

/** Archive the active sandbox conversation — never delete — with an event trace. */
export async function resetSandbox(deps: SandboxDeps): Promise<void> {
  const businessId = bidOf(deps.businessId);
  await withTenantTx(deps.db, businessId, async (tx) => {
    const conversationId = await findActiveConversation(tx, businessId);
    if (!conversationId) return;
    await lockConversation(tx, conversationId);
    // Archive-not-erase (the app role has no DELETE): close + deactivate. Any
    // pending draft is rejected so it cannot linger against an archived thread.
    await sql`update drafts set status = 'rejected', decided_at = ${deps.now()} where conversation_id = ${conversationId} and status = 'pending'`.execute(tx);
    await sql`update conversations set is_active = false, closed_at = ${deps.now()} where id = ${conversationId}`.execute(tx);
    await sql`
      insert into conversation_events (business_id, conversation_id, type, payload)
      values (${businessId}, ${conversationId}, 'sandbox_reset', ${JSON.stringify({ actor: 'owner', at: deps.now().toISOString() })}::jsonb)
    `.execute(tx);
  });
}

/**
 * Score a turn with the M12.1 trust checkers — pure, so the sandbox's live
 * readout is unit-testable off a FakeTenant and provably the SAME logic the CI
 * gate runs. `expectations` are the scenario's when replaying a golden case,
 * else the universal watchlist.
 */
export function evaluateTrust(input: {
  readonly mode: SandboxMode;
  readonly scenario?: Scenario | undefined;
  readonly expectations: readonly Expectation[];
  readonly result: TurnResult;
  readonly effects: TurnEffects;
  readonly grants: readonly AutonomyGrant[];
  readonly now: Date;
  readonly floorPriceUsd: number | null;
}): SandboxTrust {
  const { result, effects } = input;
  const capability = capabilityOf(result.decision, result.quote !== null);
  const requestedMode = resolveMode({ capability, grants: input.grants, now: input.now, timeZone: BUSINESS_TZ });
  const appliedMode: SandboxTrust['appliedMode'] = effects.outbound ? 'auto' : effects.draftCreated ? 'draft' : 'none';
  const floorOf = (pid: string): number | null =>
    result.quote && pid === (result.quote.productId as string) ? input.floorPriceUsd : null;
  const ctx: TurnOutcome = { scenario: input.scenario, result, effects, floorOf, capability, requestedMode, appliedMode };
  const checks = input.expectations.map((e) => runCheck(e, ctx));
  return {
    mode: input.mode,
    scenarioId: input.scenario?.id ?? null,
    scenarioTitle: input.scenario?.title ?? null,
    capability, appliedMode,
    guardViolations: result.guardViolations,
    handoff: effects.handoffAlert,
    quote: result.quote ? { unitPriceUsd: result.quote.unitPriceUsd, totalUsd: result.quote.totalUsd } : null,
    checks,
  };
}

/** The outbound sink for applyOwnerCommand in the sandbox: record, never transmit. */
export function sandboxOutboundSink(deps: SandboxDeps): (businessId: string, conversationId: string, reply: string) => Promise<void> {
  return async (_businessId, conversationId, reply) => {
    await withTenantTx(deps.db, bidOf(deps.businessId), (tx) => recordMessage(tx, conversationId, 'outbound', 'text', reply));
  };
}

// ── read model ────────────────────────────────────────────────────────────────

export type SandboxMessage = { readonly direction: 'inbound' | 'outbound'; readonly text: string; readonly isImage: boolean };
export type SandboxTrust = {
  readonly mode: SandboxMode;
  /** M16.4b: the id drives the owner-facing label; the title stays internal
   *  (and is kept so payloads written before M16.4b still render). */
  readonly scenarioId?: string | null;
  readonly scenarioTitle: string | null;
  readonly capability: string; readonly appliedMode: 'auto' | 'draft' | 'none';
  readonly guardViolations: number; readonly handoff: boolean;
  readonly quote: { readonly unitPriceUsd: number; readonly totalUsd: number } | null;
  readonly checks: readonly CheckResult[];
};
/**
 * M20.4 (F-04) — scripted practice, run IN MEMORY.
 *
 * The M21 rehearsal found this surface silently dead on a fresh factory: it
 * wrote turns to a separate hard-coded tenant that only an operator script
 * creates, so choosing a case returned 302 and nothing happened. Scripted
 * practice now runs the M12.1 harness in process — the same 23 golden scenarios
 * the readiness check runs — so it works the moment a factory exists.
 *
 * Isolation is now absolute rather than conventional: no DB write, no adapter,
 * no conversation. There is nothing for a message to escape through.
 */
export type PracticeCase = {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly passed: boolean;
  readonly checks: readonly { readonly invariant: string; readonly pass: boolean; readonly detail: string }[];
};
export type PracticeReport = {
  readonly cases: readonly PracticeCase[];
  readonly passed: number;
  readonly total: number;
};

/** Run the golden safety set. No database, no provider — nothing can be sent. */
export async function runScriptedPractice(): Promise<PracticeReport> {
  const { runAll } = await import('../../trust/harness.js');
  const { SCENARIOS } = await import('../../trust/scenarios.js');
  const r = await runAll(SCENARIOS);
  return {
    cases: r.scenarios.map((x) => ({
      id: x.id, title: x.title, category: x.category, passed: x.passed,
      checks: x.checks.map((c) => ({ invariant: c.invariant, pass: c.pass, detail: c.detail })),
    })),
    passed: r.passed, total: r.total,
  };
}

export type SandboxView = {
  readonly hasConversation: boolean;
  readonly messages: readonly SandboxMessage[];
  readonly pendingDraft: { readonly draftId: string; readonly draftText: string } | null;
  readonly lastTurn: SandboxTrust | null;
  /** M16.3 — the SAME ownership model as the inbox (ownershipOf), so the owner
   *  rehearses the real human-takeover lifecycle here. */
  readonly ownership: ConversationOwnership;
};

export async function loadSandboxView(deps: SandboxDeps): Promise<SandboxView> {
  const businessId = bidOf(deps.businessId);
  return withTenantTx(deps.db, businessId, async (tx) => {
    const conversationId = await findActiveConversation(tx, businessId);
    if (!conversationId) return { hasConversation: false, messages: [], pendingDraft: null, lastTurn: null, ownership: 'AI' };

    const assigned = (await sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${conversationId} limit 1
    `.execute(tx)).rows[0]?.assigned_to ?? null;

    const messages = (await sql<{ direction: string; input_type: string; text_content: string | null }>`
      select direction, input_type, text_content from messages
       where conversation_id = ${conversationId} order by sent_at asc limit 200
    `.execute(tx)).rows
      .filter((m) => m.text_content !== null)
      .map((m): SandboxMessage => ({ direction: m.direction === 'inbound' ? 'inbound' : 'outbound', text: m.text_content!, isImage: m.input_type === 'image' }));

    const draft = (await sql<{ id: string; draft_text: string }>`
      select id, draft_text from drafts where conversation_id = ${conversationId} and status = 'pending'
       order by created_at desc limit 1
    `.execute(tx)).rows[0];

    const evt = (await sql<{ payload: SandboxTrust }>`
      select payload from conversation_events
       where conversation_id = ${conversationId} and type = 'sandbox_turn'
       order by created_at desc limit 1
    `.execute(tx)).rows[0];

    return {
      hasConversation: true,
      messages,
      pendingDraft: draft ? { draftId: draft.id, draftText: draft.draft_text } : null,
      lastTurn: evt ? evt.payload : null,
      ownership: ownershipOf(assigned),
    };
  });
}

/** The active sandbox conversation, for the takeover routes (M16.3). */
export async function activeSandboxConversationId(deps: SandboxDeps): Promise<string | null> {
  const businessId = bidOf(deps.businessId);
  return withTenantTx(deps.db, businessId, (tx) => findActiveConversation(tx, businessId));
}

/**
 * M16.3 — the sandbox "delivery" for an owner reply. ownerReply() has already
 * gone through the ONE send path (enqueueOutboundRow, origin='owner') and
 * written the owner_reply event; this is the kickDrive it fires afterwards. The
 * sandbox has no worker and no channel credential, so instead of a real send we
 * SINK the queued owner row into the transcript (the same recordMessage the AI
 * reply and the approval sink use) and mark the row terminal. No real outbound
 * delivery, and no second send path.
 */
export async function sandboxFlushOutbound(deps: SandboxDeps, conversationId: string): Promise<void> {
  const businessId = bidOf(deps.businessId);
  await withTenantTx(deps.db, businessId, async (tx) => {
    await lockConversation(tx, conversationId);
    const queued = (await sql<{ id: string; body: string }>`
      select id, body from outbound_messages
       where conversation_id = ${conversationId} and origin = 'owner' and status = 'queued'
       order by seq asc
    `.execute(tx)).rows;
    for (const row of queued) {
      await recordMessage(tx, conversationId, 'outbound', 'text', row.body);   // the sink
      await sql`update outbound_messages set status = 'sent', sent_at = now() where id = ${row.id}`.execute(tx);
    }
  });
}

// ── renderer (pure, localized, escaped) ───────────────────────────────────────

const invLabel = (locale: Locale, id: string): string => t(locale, `sandbox.inv.${id}` as MessageKey);

/** M16.4b — the owner-facing name of a practice case, by scenario id. */
export const caseName = (locale: Locale, id: string): string => t(locale, `sandbox.case.${id}` as MessageKey);

function renderTrust(trust: SandboxTrust | null, locale: Locale): string {
  if (!trust) return `<div class="card sbx-trust"><h2>${esc(t(locale, 'sandbox.trust.title'))}</h2><div class="empty muted">${esc(t(locale, 'sandbox.trust.none'))}</div></div>`;
  const allPass = trust.checks.every((c) => c.pass);
  const deliveryKey = trust.appliedMode === 'auto' ? 'sandbox.xray.deliveryAuto' : trust.appliedMode === 'draft' ? 'sandbox.xray.deliveryDraft' : 'sandbox.xray.deliveryNone';
  const rows = trust.checks.map((c) =>
    `<li class="chk ${c.pass ? 'ok' : 'bad'}"><span class="mk">${c.pass ? '✓' : '✗'}</span>
       <span class="lbl">${esc(invLabel(locale, c.invariant))}</span>
       <span class="dt muted">${esc(c.detail)}</span></li>`).join('');
  const chips = [
    `<span class="chip">${esc(t(locale, 'sandbox.xray.skill'))}: ${esc(capabilityName(locale, trust.capability))}</span>`,
    `<span class="chip ${trust.appliedMode === 'auto' ? 'auto' : 'draft'}">${esc(t(locale, 'sandbox.xray.delivery'))}: ${esc(t(locale, deliveryKey as MessageKey))}</span>`,
    trust.quote ? `<span class="chip">${esc(formatUsd(trust.quote.unitPriceUsd))}/pc</span>` : '',
    trust.guardViolations > 0 ? `<span class="chip warn">⚠ ${trust.guardViolations}</span>` : '',
    trust.scenarioId
      ? `<span class="chip badge">${esc(t(locale, 'sandbox.scenario.badge'))}: ${esc(caseName(locale, trust.scenarioId))}</span>`
      : '',
  ].join('');
  return `<div class="card sbx-trust ${allPass ? 'pass' : 'fail'}">
    <h2>${esc(t(locale, 'sandbox.trust.title'))} · <span class="verdict">${esc(t(locale, allPass ? 'sandbox.trust.allPass' : 'sandbox.trust.someFail'))}</span></h2>
    <div class="chips">${chips}</div>
    <ul class="checks">${rows}</ul>
  </div>`;
}

function renderComposer(locale: Locale, mode: SandboxMode, liveAvailable: boolean, prefill = ''): string {
  // M16.4b: the owner reads an owner-facing name; the engineering title in
  // src/trust/scenarios.ts is unchanged and stays internal (tests, CI).
  const scenarioOpts = SCENARIOS.map((s) => `<option value="${esc(s.id)}">${esc(caseName(locale, s.id))}</option>`).join('');
  const modeRadio = (m: SandboxMode, labelKey: MessageKey, disabled = false) =>
    `<label class="radio ${disabled ? 'off' : ''}"><input type="radio" name="mode" value="${m}" ${m === mode && !disabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}/> ${esc(t(locale, labelKey))}</label>`;
  return `
  <div class="card sbx-compose">
    <div class="modebar">
      <span class="muted">${esc(t(locale, 'sandbox.mode.label'))}:</span>
      ${modeRadio('scripted', 'sandbox.mode.scripted')}
      ${liveAvailable ? modeRadio('live', 'sandbox.mode.live') : `<span class="radio off muted" title="${esc(t(locale, 'sandbox.mode.liveOff'))}">${esc(t(locale, 'sandbox.mode.live'))}</span>`}
    </div>
    <form method="post" action="/app/sandbox/scenario" class="scenariobar">
      <input type="hidden" name="mode" value="${mode}" />
      <label class="muted" for="scenario">${esc(t(locale, 'sandbox.scenario.label'))}</label>
      <select id="scenario" name="scenarioId">
        <option value="">${esc(t(locale, 'sandbox.scenario.none'))}</option>
        ${scenarioOpts}
      </select>
      <button class="btn" type="submit">${esc(t(locale, 'sandbox.scenario.load'))}</button>
    </form>
    <form method="post" action="/app/sandbox/message" class="msgbar">
      <input type="hidden" name="mode" value="${mode}" />
      <label class="muted" for="buyer">${esc(t(locale, 'sandbox.composer.label'))}</label>
      <textarea id="buyer" name="text" rows="2" placeholder="${esc(t(locale, 'sandbox.composer.placeholder'))}" required>${esc(prefill)}</textarea>
      <div class="msgacts">
        <label class="chkbox"><input type="checkbox" name="image" value="1" /> ${esc(t(locale, 'sandbox.composer.image'))}</label>
        <button class="btn send" type="submit">${esc(t(locale, 'sandbox.composer.send'))}</button>
      </div>
    </form>
  </div>`;
}

/** M16.3 — the human-control card, driven by ownership exactly like the inbox
 *  (same ownershipOf, same takeover.* wording, same take-over/reply/return
 *  services). Sandbox routes carry no conversation id — there is one active
 *  conversation, resolved server-side. */
function sandboxTakeoverCard(view: SandboxView, locale: Locale, mode: SandboxMode): string {
  if (!view.hasConversation) return '';
  const m = `<input type="hidden" name="mode" value="${mode}" />`;
  const take = `<form method="post" action="/app/sandbox/takeover" class="inline">${m}<button class="btn ${view.ownership === 'WAITING_HUMAN' ? 'send' : ''}" type="submit">${esc(t(locale, 'takeover.action.take'))}</button></form>`;
  switch (view.ownership) {
    case 'AI':
      return `<div class="card takeover"><span class="pill ok">${esc(t(locale, 'takeover.status.ai'))}</span>${take}</div>`;
    case 'WAITING_HUMAN':
      return `<div class="card takeover warn"><span class="pill warn">${esc(t(locale, 'takeover.status.waiting'))}</span>${take}</div>`;
    case 'OWNER_CONTROLLED':
      return `<div class="card takeover owner">
        <span class="pill owner">${esc(t(locale, 'takeover.status.owner'))}</span>
        <form method="post" action="/app/sandbox/reply" class="replyform">${m}
          <textarea name="text" rows="2" placeholder="${esc(t(locale, 'takeover.replyPlaceholder'))}" required></textarea>
          <button class="btn send" type="submit">${esc(t(locale, 'takeover.action.reply'))}</button>
        </form>
        <form method="post" action="/app/sandbox/resume" class="inline">${m}<button class="btn ghost" type="submit">${esc(t(locale, 'takeover.action.resume'))}</button></form>
      </div>`;
  }
}

/** M20.4 (F-04) — what scripted practice proves, and what it does not. */
export function renderPractice(report: PracticeReport, locale: Locale): string {
  const rows = report.cases.map((c) => `
    <li class="pcase ${c.passed ? 'ok' : 'bad'}">
      <span class="pmark">${c.passed ? '✓' : '✗'}</span>
      <span class="ptitle">${esc(t(locale, `sandbox.case.${c.id}` as MessageKey))}</span>
    </li>`).join('');
  return `<div class="card">
    <h2>${esc(t(locale, 'practice.scripted.title'))}</h2>
    <p class="muted">${esc(t(locale, 'practice.scripted.intro', { name: EMPLOYEE_NAME[locale] }))}</p>
    <div class="pcount">${report.passed} / ${report.total}</div>
    <ul class="pcases">${rows}</ul>
    <p class="muted pproves">${esc(t(locale, 'practice.scripted.proves', { name: EMPLOYEE_NAME[locale] }))}</p>
    <p class="muted pproves">${esc(t(locale, 'practice.scripted.notproves', { name: EMPLOYEE_NAME[locale] }))}</p>
  </div>`;
}

export function renderSandbox(view: SandboxView, locale: Locale, opts: { mode: SandboxMode; liveAvailable: boolean; flash: string | null; prefill?: string }): string {
  const name = EMPLOYEE_NAME[locale];
  const banner = `<div class="sbx-banner" role="note">🧪 ${esc(t(locale, 'sandbox.banner'))}</div>`;
  const intro = `<p class="muted sbx-intro">${esc(t(locale, 'sandbox.intro', { name }))}</p>`;
  const flashHtml = opts.flash ? `<div class="flash" role="status">${esc(opts.flash)}</div>` : '';

  const timeline = view.messages.length
    ? `<div class="timeline">${view.messages.map((m) => `
        <div class="msg ${m.direction}">
          <div class="bubble">${m.isImage ? '🖼️ ' : ''}<bdi>${esc(m.text)}</bdi></div>
          <div class="ts muted">${m.direction === 'inbound' ? esc(t(locale, 'sandbox.composer.send')) : esc(name)}</div>
        </div>`).join('')}</div>`
    : `<div class="empty muted">${esc(t(locale, 'sandbox.empty'))}</div>`;

  const draftCard = view.pendingDraft
    ? `<div class="card draft" role="region">
        <div class="proposed">${esc(view.pendingDraft.draftText)}</div>
        <form method="post" action="/app/sandbox/act" class="acts">
          <input type="hidden" name="draftId" value="${esc(view.pendingDraft.draftId)}" />
          <input type="hidden" name="mode" value="${opts.mode}" />
          <button class="btn send" name="command" value="发送">${esc(t(locale, 'inbox.action.send'))}</button>
          <button class="btn" name="command" value="不回">${esc(t(locale, 'inbox.action.skip'))}</button>
          <button class="btn danger" name="command" value="收回">${esc(t(locale, 'inbox.action.revoke'))}</button>
        </form>
        <form method="post" action="/app/sandbox/act" class="editform">
          <input type="hidden" name="draftId" value="${esc(view.pendingDraft.draftId)}" />
          <input type="hidden" name="mode" value="${opts.mode}" />
          <label class="muted" for="edit">${esc(t(locale, 'inbox.action.editLabel'))}</label>
          <textarea id="edit" name="edit" rows="2" placeholder="${esc(t(locale, 'inbox.action.editPlaceholder'))}"></textarea>
          <button class="btn" name="command" value="改">${esc(t(locale, 'inbox.action.editSend'))}</button>
        </form>
      </div>`
    : '';

  return `
    <div class="dhead">
      <h1 class="page">${esc(t(locale, 'sandbox.title'))}</h1>
      <form method="post" action="/app/sandbox/reset"><button class="btn ghost" type="submit">${esc(t(locale, 'sandbox.reset'))}</button></form>
    </div>
    ${banner}
    ${intro}
    ${flashHtml}
    ${renderComposer(locale, opts.mode, opts.liveAvailable, opts.prefill ?? '')}
    ${sandboxTakeoverCard(view, locale, opts.mode)}
    ${renderTrust(view.lastTurn, locale)}
    ${view.ownership === 'OWNER_CONTROLLED' ? '' : draftCard}
    <div class="card"><h2>${esc(t(locale, 'nav.sandbox'))}</h2>${timeline}</div>
    ${SANDBOX_STYLE}`;
}

const SANDBOX_STYLE = `<style>
  .pcount { font-size:var(--font-size-numeral); font-weight:600; color:var(--color-ink); font-variant-numeric:tabular-nums; margin:4px 0 12px; }
  .pcases { list-style:none; margin:0; padding:0; }
  .pcase { display:flex; gap:10px; padding:7px 0; border-bottom:1px solid var(--color-border); font-size:var(--font-size-note); }
  .pcase:last-child { border-bottom:0; }
  .pcase.ok .pmark { color:var(--color-ok); } .pcase.bad .pmark { color:var(--color-warn); }
  .ptitle { color:var(--color-ink-secondary); }
  .pproves { margin:12px 0 0; max-width:62ch; line-height:1.6; }
  .dhead { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .sbx-banner { background:var(--color-waiting-wash); color:var(--color-waiting); border:1px solid var(--color-waiting-line); border-radius:12px; padding:12px 16px; font-weight:600; font-size:var(--font-size-note); margin:6px 0 12px; }
  .sbx-intro { margin:0 0 16px; }
  .sbx-compose { display:flex; flex-direction:column; gap:14px; }
  .modebar { display:flex; align-items:center; gap:14px; flex-wrap:wrap; font-size:var(--font-size-note); }
  .radio { display:inline-flex; align-items:center; gap:6px; cursor:pointer; }
  .radio.off { opacity:.5; cursor:not-allowed; }
  .scenariobar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  select { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:9px 12px; font:inherit; max-width:100%; }
  .msgbar { display:flex; flex-direction:column; gap:8px; }
  .msgacts { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .chkbox { display:inline-flex; align-items:center; gap:6px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  textarea { width:100%; background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px; font:inherit; resize:vertical; }
  .sbx-trust { border-color:var(--color-highlight-line); }
  .sbx-trust.pass { border-color:var(--color-jade-line); } .sbx-trust.fail { border-color:var(--color-warn-line); }
  .sbx-trust .verdict { font-weight:700; text-transform:none; letter-spacing:0; }
  .sbx-trust.pass .verdict { color:var(--color-ok); } .sbx-trust.fail .verdict { color:var(--color-warn); }
  .chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .chip { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:4px 12px; font-size:var(--font-size-micro); color:var(--color-ink-secondary); }
  .chip.auto { background:var(--color-jade-wash); color:var(--color-ok); border-color:var(--color-jade-line); }
  .chip.draft { background:var(--color-waiting-wash); color:var(--color-waiting); border-color:var(--color-waiting-line); }
  .chip.warn { background:var(--color-warn-wash); color:var(--color-warn); } .chip.badge { background:var(--color-jade-wash); color:var(--color-highlight); }
  .checks { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
  .chk { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; align-items:start; }
  .chk .mk { font-weight:700; } .chk.ok .mk { color:var(--color-ok); } .chk.bad .mk { color:var(--color-warn); }
  .chk .lbl { font-size:var(--font-size-note); } .chk .dt { grid-column:2; font-size:var(--font-size-micro); word-break:break-word; }
  .card.draft { border-color:var(--color-waiting-line); }
  .proposed { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; padding:14px; margin-bottom:12px; font-size:var(--font-size-small); white-space:pre-wrap; }
  .acts { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .editform { display:flex; flex-direction:column; gap:8px; }
  .timeline { display:flex; flex-direction:column; gap:12px; }
  .msg { max-width:82%; } .msg.inbound { align-self:flex-start; } .msg.outbound { align-self:flex-end; }
  .bubble { padding:10px 14px; border-radius:14px; font-size:var(--font-size-small); white-space:pre-wrap; word-break:break-word; }
  .msg.inbound .bubble { background:var(--color-paper-sunk); border-start-start-radius:4px; }
  .msg.outbound .bubble { background:var(--color-highlight-line); border-start-end-radius:4px; }
  .ts { font-size:var(--font-size-micro); margin-top:4px; }
  .takeover { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .takeover.owner { flex-direction:column; align-items:stretch; }
  .replyform { display:flex; flex-direction:column; gap:8px; }
  @media (max-width:560px) { .msg { max-width:92%; } }
</style>`;
