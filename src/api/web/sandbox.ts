import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { type Money, type Currency, usd, parseCurrency } from '../../core/types/money.js';
import { readTypedAmount } from '../../core/commerce/amount.js';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import type { BusinessId } from '../../core/types/ids.js';
import { ownershipOf, type ConversationOwnership } from '../../core/conversation/ownership.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { capabilityName, type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { labelled } from '../../core/owner/i18n/format.js';
import { SCENARIOS } from '../../trust/scenarios.js';
import type { PracticeTrust } from '../../trust/practiceChecks.js';
import { esc, deeper, back, byAssistant } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { loadTranscriptWindow } from '../../db/transcript.js';
import { approvalCard, orderCard, loadConversationDetail, type ConversationDetail } from './inbox.js';
import { expectTotal, NOT_YET, type ChecklistItem, type PracticeTotal } from '../../db/practiceChecklist.js';
import { unitLabel } from './products.js';
import { formatList } from '../../core/owner/i18n/format.js';
import { refreshPractice, practiceConversation, activePracticeConversation, practiceRefusal, countPracticeLine, type PracticeRefusal, type PracticeSettings } from '../../db/practice.js';
import { recordTypedMessage } from '../../pipeline/received.js';
import type { InboundJob } from '../../queue/boss.js';
import * as show from './values.js';
import type { InvariantId } from '../../trust/scenarios.js';

/**
 * PRACTICE — the owner plays a customer, and the assistant answers as it
 * would answer them (M12.2; per workspace since P3, docs/PRACTICE.md).
 *
 * Each workspace practises on its OWN copy (0086): its catalogue, prices,
 * rules and assistant, and nobody real. A practice message is an ordinary
 * inbound message on the copy — the real queue, worker, turn, approval path and
 * send gate — and it ends at the practice adapter, which has no network. So
 * what Practice shows is what the business would do: batching, the Stop, the
 * window, a hand-off, a draft that waits. The golden set's checks run on every
 * practice turn in the worker (`src/trust/practiceChecks.ts`).
 *
 * Before P3 this page ran turns itself, in the request, against one shared
 * tenant — a second caller of the engine that skipped Stop, batching and the
 * send gate, and a sandbox every signed-in owner could read and reset.
 */

/**
 * CC-25 — the practice page's address. It lands where the conversation page
 * lands (`conversationUrl`): on the newest line, with the notice and the reply
 * to approve under it. Every practice action comes back through here; `before`
 * is the "Earlier messages" door. A cursor is digits, hex and `_`, so no `%`
 * reaches the page.
 */
export const practiceUrl = (before?: string | null): string =>
  `/app/sandbox${before ? `?before=${encodeURIComponent(before)}` : ''}#latest`;

// ── the message ───────────────────────────────────────────────────────────────

/**
 * The owner writes as a customer. The copy is brought in line with the
 * workspace first, so the reply quotes today's prices; the line is on the
 * transcript at once (the worker records it again under the same id, which
 * changes nothing); then it joins the inbound queue like anyone's message.
 */
export async function sayInPractice(
  deps: { readonly db: Db; readonly enqueue: (job: InboundJob) => Promise<void> },
  live: BusinessId, text: string,
  /** P4 — "your total first": the total the owner expects the answer to give, typed before it comes. */
  expected: number | null = null,
): Promise<'sent' | 'empty' | PracticeRefusal> {
  const said = text.trim();
  if (!said) return 'empty';
  // P5 — the operator's switch, and the day's fifty: refused before anything is made or queued.
  const refused = await practiceRefusal(deps.db, live);
  if (refused) return refused;
  await countPracticeLine(deps.db, live);
  const copy = await refreshPractice(deps.db, live);
  const messageId = `practice:${randomUUID()}`;
  const conversationId = await withTenantTx(deps.db, copy, async (tx) => {
    const id = await practiceConversation(tx, copy);
    await recordTypedMessage(tx, id, messageId, said);
    return id;
  });
  if (expected !== null && expected > 0) await expectTotal(deps.db, live, messageId, expected);
  await deps.enqueue({ businessId: copy, conversationId, messageId, text: said, messageType: 'text' });
  return 'sent';
}

/**
 * A recorded practice quote's unit price, from a payload of either vintage.
 *
 * Rows written before M43a carry `unitPriceUsd: number`; rows written after
 * carry `unitPrice: Money`. Both were USD, and the older shape says so by its
 * name — which is the last useful thing that name does.
 */
export function quoteUnit(q: NonNullable<PracticeTrust['quote']>): Money {
  const legacy = (q as unknown as { unitPriceUsd?: number }).unitPriceUsd;
  return q.unitPrice ?? usd(legacy ?? 0);
}

// ── read model ────────────────────────────────────────────────────────────────

export type SandboxMessage = { readonly direction: 'inbound' | 'outbound'; readonly text: string; readonly isImage: boolean };

/**
 * M20.4 (F-04) — scripted practice, run IN MEMORY: the golden safety set,
 * the same cases the readiness check runs. No database, no adapter, no
 * conversation — nothing for a message to escape through.
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
  /** The practice conversation, for the live line; null before the first message. */
  readonly conversationId?: string | null;
  /** CC-25 — one window of the practice transcript, the newest unless `transcript.older`; oldest first. */
  readonly messages: readonly SandboxMessage[];
  /** CC-25 — the same window the conversation page reads; absent reads as the newest, with nothing before it. */
  readonly transcript?: { readonly earlier: string | null; readonly older: boolean };
  /**
   * P4 — the conversation as its own page reads it (`loadConversationDetail`,
   * on the copy): the reply waiting with why it waited and where each figure
   * came from, and why it was handed to a person. Absent before a message.
   */
  readonly detail?: ConversationDetail | null;
  readonly lastTurn: PracticeTrust | null;
  /** M16.3 — the SAME ownership model as the inbox (ownershipOf), so the owner
   *  rehearses the real human-takeover lifecycle here. */
  readonly ownership: ConversationOwnership;
};

const EMPTY: SandboxView = { hasConversation: false, conversationId: null, messages: [], lastTurn: null, ownership: 'AI' };

async function viewOf(tx: Tx, conversationId: string, before: unknown): Promise<SandboxView> {
  const assigned = (await sql<{ assigned_to: string | null }>`
    select assigned_to from conversations where id = ${conversationId} limit 1
  `.execute(tx)).rows[0]?.assigned_to ?? null;

  // CC-25 — the newest window, as on the conversation page.
  const transcript = await loadTranscriptWindow(tx, conversationId, before);
  const messages = transcript.rows
    .filter((m) => m.text_content !== null)
    .map((m): SandboxMessage => ({ direction: m.direction === 'inbound' ? 'inbound' : 'outbound', text: m.text_content!, isImage: m.input_type === 'image' }));

  const evt = (await sql<{ payload: PracticeTrust }>`
    select payload from conversation_events
     where conversation_id = ${conversationId} and type = 'sandbox_turn'
     order by created_at desc limit 1
  `.execute(tx)).rows[0];

  return {
    hasConversation: true,
    conversationId,
    messages,
    transcript: { earlier: transcript.earlier, older: transcript.older },
    lastTurn: evt ? evt.payload : null,
    ownership: ownershipOf(assigned),
  };
}

/** The practice page's view of the workspace's copy; empty before its first message. */
export async function loadPracticeView(
  db: Db, copy: BusinessId | null,
  /** CC-25 — the request's `before`: an older window of the practice transcript, or the newest. */
  before: unknown = null,
  now: Date = new Date(),
): Promise<SandboxView> {
  if (!copy) return EMPTY;
  const view = await withTenantTx(db, copy, async (tx) => {
    const conversationId = await activePracticeConversation(tx, copy);
    return conversationId ? viewOf(tx, conversationId, before) : EMPTY;
  });
  // P4 — the conversation page's own reading of it, for the card and the hand-off's reason.
  const detail = view.conversationId ? await loadConversationDetail(db, copy, view.conversationId, now, before) : null;
  return { ...view, detail };
}

// ── renderer (pure, localized, escaped) ───────────────────────────────────────

/**
 * Each check by its words. Typed against the checks themselves: a check with
 * no line in the catalogue fails the typecheck — seven were shown as raw keys
 * ("sandbox.inv.noDeletionPromise") until 2026-09-30.
 */
const invLabel = (locale: Locale, id: InvariantId): string => t(locale, `sandbox.inv.${id}` as const satisfies MessageKey);

/** M16.4b — the owner-facing name of a practice case, by scenario id. */
export const caseName = (locale: Locale, id: string): string => t(locale, `sandbox.case.${id}` as MessageKey);

function renderTrust(trust: PracticeTrust | null, locale: Locale): string {
  if (!trust) return `<div class="card sbx-trust"><h2>${esc(t(locale, 'sandbox.trust.title'))}</h2><div class="empty muted">${esc(t(locale, 'sandbox.trust.none'))}</div></div>`;
  const allPass = trust.checks.every((c) => c.pass);
  const deliveryKey = trust.appliedMode === 'auto' ? 'sandbox.xray.deliveryAuto' : trust.appliedMode === 'draft' ? 'sandbox.xray.deliveryDraft' : 'sandbox.xray.deliveryNone';
  const rows = trust.checks.map((c) =>
    `<li class="chk ${c.pass ? 'ok' : 'bad'}"><span class="mk">${c.pass ? '✓' : '✗'}</span>
       <span class="lbl">${esc(invLabel(locale, c.invariant))}</span>
       <span class="dt muted">${esc(c.detail)}</span></li>`).join('');
  // CC-13 — each label and its value with the locale's own colon ("Skill: …", "技能：…"),
  // and the unit in the page's language, as on every other price ("$0.85/pcs", "$0.85/个").
  const chips = [
    `<span class="chip">${esc(labelled(locale, t(locale, 'sandbox.xray.skill'), capabilityName(locale, trust.capability)))}</span>`,
    `<span class="chip ${trust.appliedMode === 'auto' ? 'auto' : 'draft'}">${esc(labelled(locale, t(locale, 'sandbox.xray.delivery'), t(locale, deliveryKey as MessageKey)))}</span>`,
    trust.quote ? `<span class="chip"><bdi>${esc(show.money(locale, quoteUnit(trust.quote)))}/${esc(unitLabel(locale, trust.quote.unit ?? 'pcs'))}</bdi></span>` : '',
    trust.guardViolations > 0 ? `<span class="chip warn">⚠ ${trust.guardViolations}</span>` : '',
    trust.scenarioId
      ? `<span class="chip badge">${esc(labelled(locale, t(locale, 'sandbox.scenario.badge'), caseName(locale, trust.scenarioId)))}</span>`
      : '',
  ].join('');
  return `<div class="card sbx-trust ${allPass ? 'pass' : 'fail'}">
    <h2>${esc(t(locale, 'sandbox.trust.title'))} · <span class="verdict">${esc(t(locale, allPass ? 'sandbox.trust.allPass' : 'sandbox.trust.someFail'))}</span></h2>
    <div class="chips">${chips}</div>
    <ul class="checks">${rows}</ul>
  </div>`;
}

/**
 * P4 — "your total first": a price the owner knows by heart, typed BEFORE the
 * answer comes, so a misread or shifted price is caught by the owner and not
 * by a customer. Only where there is a price list to quote from.
 */
const parseTotal = (raw: unknown, currency: Currency): number | null => {
  // CUR — read the way the workspace's currency writes a figure: "1.250,00"
  // is 1250 in reais, and was 1.25.
  const n = readTypedAmount(String(raw ?? ''), currency) ?? NaN;
  return Number.isFinite(n) && n > 0 && n < 1e12 ? Math.round(n * 100) / 100 : null;
};
export { parseTotal };

function renderComposer(locale: Locale, prefill = '', totals = true): string {
  // M16.4b: the owner reads an owner-facing name; the engineering title in
  // src/trust/scenarios.ts is unchanged and stays internal (tests, CI). A
  // situation sends its customer's words, and the assistant answers them live.
  const scenarioOpts = SCENARIOS.map((s) => `<option value="${esc(s.id)}">${esc(caseName(locale, s.id))}</option>`).join('');
  // CC-25 — `compose` is where a "try it in practice" link lands: the box sits
  // under the transcript now, where the conversation continues.
  return `
  <div id="compose" class="card sbx-compose">
    <form method="post" action="/app/sandbox/scenario" class="scenariobar">
      <label class="muted" for="scenario">${esc(t(locale, 'sandbox.scenario.label'))}</label>
      <select id="scenario" name="scenarioId">
        <option value="">${esc(t(locale, 'sandbox.scenario.none'))}</option>
        ${scenarioOpts}
      </select>
      <button class="btn" type="submit">${esc(t(locale, 'sandbox.scenario.load'))}</button>
    </form>
    <form method="post" action="/app/sandbox/message" class="msgbar">
      <label class="muted" for="buyer">${esc(t(locale, 'sandbox.composer.label'))}</label>
      <textarea id="buyer" name="text" rows="2" placeholder="${esc(t(locale, 'sandbox.composer.placeholder'))}" required>${esc(prefill)}</textarea>
      ${totals ? `<label class="muted" for="expected">${esc(t(locale, 'practice.total.label'))}</label>
      <input id="expected" name="expected" inputmode="decimal" dir="ltr" autocomplete="off" />
      <p class="muted">${esc(t(locale, 'practice.total.hint'))}</p>` : ''}
      <div class="msgacts">
        <button class="btn send" type="submit">${esc(t(locale, 'sandbox.composer.send'))}</button>
      </div>
    </form>
  </div>`;
}

/** M16.3 — the human-control card, driven by ownership exactly like the inbox
 *  (same ownershipOf, same takeover.* wording, same take-over/reply/return
 *  services). Sandbox routes carry no conversation id — there is one active
 *  conversation, resolved server-side. */
function sandboxTakeoverCard(view: SandboxView, locale: Locale): string {
  if (!view.hasConversation) return '';
  const take = `<form method="post" action="/app/sandbox/takeover" class="inline"><button class="btn ${view.ownership === 'WAITING_HUMAN' ? 'send' : ''}" type="submit">${esc(t(locale, 'takeover.action.take'))}</button></form>`;
  switch (view.ownership) {
    case 'AI':
      return `<div class="card takeover"><span class="pill ok">${esc(t(locale, 'takeover.status.ai'))}</span>${take}</div>`;
    case 'WAITING_HUMAN': {
      // P4 — why it came to you, and whether the customer heard anything: the
      // newest line is theirs, so nothing was sent after it.
      const reasons = view.detail?.handoffReasons ?? [];
      const why = reasons.length ? `<p class="why muted">${esc(labelled(locale, t(locale, 'takeover.why'),
        formatList(locale, reasons.map((k) => t(locale, `takeover.reason.${k}` as MessageKey)))))}</p>` : '';
      const quiet = view.messages.at(-1)?.direction === 'inbound'
        ? `<p class="muted">${esc(t(locale, 'practice.handoff.nothingSent'))}</p>` : '';
      return `<div class="card takeover warn"><span class="pill warn">${esc(t(locale, 'takeover.status.waiting'))}</span>${why}${quiet}${take}</div>`;
    }
    case 'OWNER_CONTROLLED':
      return `<div class="card takeover owner">
        <span class="pill owner">${esc(t(locale, 'takeover.status.owner'))}</span>
        <form method="post" action="/app/sandbox/reply" class="replyform">
          <textarea name="text" rows="2" placeholder="${esc(t(locale, 'takeover.replyPlaceholder'))}" required></textarea>
          <button class="btn send" type="submit">${esc(t(locale, 'takeover.action.reply'))}</button>
        </form>
        <form method="post" action="/app/sandbox/resume" class="inline"><button class="btn ghost" type="submit">${esc(t(locale, 'takeover.action.resume'))}</button></form>
      </div>`;
  }
}

/**
 * P4 — HOW PRACTICE ANSWERS: the owner's levels, or "as if sending alone" (0090)
 * — the customer's view of an assistant that sends without waiting; and
 * Practice's own Stop. Both are the copy's alone. The owner's real Stop, when
 * on, stops Practice too, and there is nothing here to lift it.
 */
function practiceModeCard(settings: PracticeSettings, locale: Locale): string {
  const name = assistantName(locale);
  const toggle = (action: string, on: boolean, label: string) =>
    `<form method="post" action="${action}" class="inline"><input type="hidden" name="on" value="${on ? '1' : ''}" /><button class="btn" type="submit">${esc(label)}</button></form>`;
  const mode = settings.alone
    ? `<p>${esc(t(locale, 'practice.mode.alone'))}</p>${toggle('/app/sandbox/alone', false, t(locale, 'practice.mode.aloneOff'))}`
    : `<p class="muted">${esc(t(locale, 'practice.mode.levels'))}</p>${toggle('/app/sandbox/alone', true, t(locale, 'practice.mode.aloneOn'))}`;
  const stop = settings.ownerStopped
    ? `<p class="muted">${esc(t(locale, 'practice.stop.ownerStopped'))}</p>`
    : settings.stopped
      ? `<p>${esc(t(locale, 'practice.stop.stopped'))}</p>${toggle('/app/sandbox/stop', false, t(locale, 'practice.stop.off', { name }))}`
      : toggle('/app/sandbox/stop', true, t(locale, 'practice.stop.on', { name }));
  return `<div class="card sbx-mode"><h2>${esc(t(locale, 'practice.mode.title'))}</h2>${mode}${stop}</div>`;
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
    <p class="muted">${esc(t(locale, 'practice.scripted.intro', { name: assistantName(locale) }))}</p>
    <div class="pcount">${esc(show.isolate(locale, `${report.passed} / ${report.total}`))}</div>
    <ul class="pcases">${rows}</ul>
    <p class="muted pproves">${esc(t(locale, 'practice.scripted.proves', { name: assistantName(locale) }))}</p>
    <p class="muted pproves">${esc(t(locale, 'practice.scripted.notproves', { name: assistantName(locale) }))}</p>
  </div>`;
}

/**
 * P4 — THE CHECKLIST: what the owner has seen in Practice, from the list for
 * this kind of business (a catalogue, a shop, or none). Seen once is seen:
 * it is written on the workspace, so Start over does not take it back.
 */
export type PracticeChecklistView = {
  readonly items: readonly ChecklistItem[];
  readonly seen: ReadonlySet<ChecklistItem>;
  readonly totals: readonly PracticeTotal[];
  /** CUR — the workspace's one currency: a total typed before its quote is in it. */
  readonly currency?: Currency;
};

function checklistCard(c: PracticeChecklistView, locale: Locale): string {
  const name = assistantName(locale);
  const done = c.items.filter((i) => c.seen.has(i)).length;
  const rows = c.items.map((i) => {
    const gap = NOT_YET.has(i);
    const ok = !gap && c.seen.has(i);
    return `<li class="chk ${ok ? 'ok' : gap ? 'gap' : ''}"><span class="mk" aria-hidden="true">${ok ? '✓' : gap ? '—' : '○'}</span>
      <span class="lbl">${esc(t(locale, `practice.check.${i}` as MessageKey, { name }))}</span>${
      gap ? `<span class="dt muted">${esc(t(locale, 'practice.check.notYet'))}</span>` : ''}</li>`;
  }).join('');
  const money = (n: number, currency: string | null) =>
    show.money(locale, { amount: n, currency: parseCurrency(currency ?? '') ?? c.currency ?? 'USD' });
  const totals = c.totals.map((x) => `<li class="chk ${x.agreed === true ? 'ok' : x.agreed === false ? 'bad' : ''}"><span class="mk" aria-hidden="true">${
    x.agreed === true ? '✓' : x.agreed === false ? '✗' : '○'}</span><span class="lbl">${esc(
      x.quoted === null
        ? t(locale, 'practice.total.waiting', { expected: money(x.expected, x.currency) })
        : t(locale, x.agreed ? 'practice.total.agreed' : 'practice.total.differs',
            { expected: money(x.expected, x.currency), quoted: money(x.quoted, x.currency) }))}</span></li>`).join('');
  return `<div class="card sbx-checklist">
    <h2>${esc(t(locale, 'practice.checklist.title'))} · <span class="count">${esc(show.isolate(locale, `${done}/${c.items.length}`))}</span></h2>
    <ul class="checks">${rows}</ul>
    ${totals ? `<h3>${esc(t(locale, 'practice.total.title'))}</h3><ul class="checks">${totals}</ul>` : ''}
  </div>`;
}

export function renderSandbox(view: SandboxView, locale: Locale, opts: { flash: Flash | null; prefill?: string; now?: Date; settings?: PracticeSettings; checklist?: PracticeChecklistView }): string {
  const name = assistantName(locale);
  const banner = `<div class="sbx-banner" role="note">🧪 ${esc(t(locale, 'sandbox.banner'))}</div>`;
  const intro = `<p class="muted sbx-intro">${esc(t(locale, 'sandbox.intro', { name }))}</p>`;
  // CC-25 — the notice is where every practice action lands, as on a
  // conversation: under the newest line, carrying the `latest` mark itself.
  // That is also what brings Reset — which empties the transcript — onto its
  // notice, rather than to the top of a page whose first screen is the
  // safety-check card.
  const flashHtml = flashBanner(opts.flash, 'latest');

  // CC-25 — one window, newest at the bottom and marked `latest` (unless a
  // notice carries the mark); the same doors as the conversation page,
  const older = view.transcript?.older === true;
  const earlier = view.transcript?.earlier ?? null;
  const last = opts.flash === null ? view.messages.length - 1 : -1;
  const timeline = view.messages.length
    ? `<div class="timeline">${view.messages.map((m, i) => `
        <div${i === last ? ' id="latest"' : ''} class="msg ${m.direction}">
          <div dir="auto" class="bubble">${m.isImage ? '🖼️ ' : ''}<bdi>${esc(m.text)}</bdi></div>
          <div class="ts muted">${m.direction === 'inbound' ? esc(t(locale, 'sandbox.composer.send')) : byAssistant(name)}</div>
        </div>`).join('')}</div>`
    : older || earlier ? ''
    : `<div class="empty muted">${esc(t(locale, 'sandbox.empty'))}</div>`;
  const log = `${earlier ? back(esc(practiceUrl(earlier)), t(locale, 'inbox.log.earlier')) : ''}
    ${timeline}
    ${older ? deeper(esc(practiceUrl()), t(locale, 'inbox.log.latest')) : ''}`;

  // P4 — the conversation page's own card: the reply once, why it waited, where
  // each figure came from, one Send; posting to Practice's own routes.
  const draftCard = view.detail?.pendingDraft
    ? approvalCard(view.detail, locale, opts.now ?? new Date(), { act: '/app/sandbox/act', handTo: '/app/sandbox/takeover' })
    : '';
  // P4 — an order the customer said yes to waits for the owner's tap here too (T6b).
  const order = view.detail?.orderProposal
    ? orderCard(view.detail, locale, { confirm: '/app/sandbox/order/confirm', stepIn: '/app/sandbox/order/step-in' })
    : '';

  /**
   * CC-25 — THE CONVERSATION PAGE'S ORDER. The transcript; the notice, where
   * every practice action lands; her reply for approval directly under the
   * newest line; the take-over card; then what she checked on that turn, and
   * the buyer's next message, where the conversation goes on. The box and the
   * checks sat above the transcript and the approval above them both, so each
   * turn was read upwards, with the question off the screen.
   *
   * A window further back is for reading, as on a conversation: the transcript
   * and the way home, and nothing to act on under a message from earlier.
   */
  const acts = older ? '' : `
    ${order}
    ${view.ownership === 'OWNER_CONTROLLED' ? '' : draftCard}
    ${sandboxTakeoverCard(view, locale)}
    ${renderTrust(view.lastTurn, locale)}
    ${renderComposer(locale, opts.prefill ?? '', opts.checklist ? !opts.checklist.items.includes('price_handed') : true)}
    ${opts.checklist ? checklistCard(opts.checklist, locale) : ''}`;

  return `
    <div class="dhead spread">
      <form method="post" action="/app/sandbox/reset"><button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)"
        data-confirm="${esc(t(locale, 'sandbox.reset.confirm'))}">${esc(t(locale, 'sandbox.reset'))}</button></form>
    </div>
    ${banner}
    ${intro}
    ${opts.settings ? practiceModeCard(opts.settings, locale) : ''}
    <div class="block"><h2>${esc(t(locale, 'nav.sandbox'))}</h2>${log}</div>
    ${flashHtml}
    ${acts}
    `;
}

