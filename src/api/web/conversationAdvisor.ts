import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdvisorIO, AdvisorViewer } from './advisor.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MemoryState } from '../../advisor/memory.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { readConversationContext, readHandoffFacts, knownNames } from '../../advisor/reads.js';
import { handoffSummary, forgetHandoff } from '../../advisor/handoff.js';
import { answerConversation, replyForConversation, CONVERSATION_INTENTS, type ConversationAnswer, type ConversationContext, type ConversationIntent } from '../../advisor/conversation.js';
import { t, withAssistantName } from './say.js';
import { esc } from './layout.js';
import { conversationUrl } from '../../core/owner/addresses.js';
import { ownerMayReply, ownershipOf } from '../../core/conversation/ownership.js';

export type CopilotPanelView = {
  readonly conversationId: string; readonly customerId: string; readonly customerName: string | null; readonly revision: string;
  readonly assistantName?: string | null;
  readonly allowance: 'available' | 'used' | 'unavailable'; readonly asked: string; readonly intent: ConversationIntent | null;
  readonly answer: ConversationAnswer | null;
  readonly history: { readonly threadHref: string | null; readonly consent: boolean; readonly processor: string; readonly keeping?: boolean };
};
export type ConversationAdvisorIO = AdvisorIO & { readonly renderCopilotPanel: (locale: Locale, view: CopilotPanelView) => string };

/** Narrow ports only: no writable pool, composer, sender or owner command is reachable here. */
export function conversationAdvisorRoutes(app: FastifyInstance, io: ConversationAdvisorIO): void {
  const off: MemoryState = { workspaceOn: false, consent: null, since: null, keep: false, ask: false, keyProblem: null, person: false };
  const state = async (v: AdvisorViewer): Promise<MemoryState> => io.memory ? io.memory.state(v.businessId, v.viewerId, new Date()).catch(() => off) : off;
  const context = async (req: FastifyRequest, v: AdvisorViewer): Promise<ConversationContext | null> => {
    const bid = parseBusinessId(v.businessId);
    if (!io.db || !bid.ok) return null;
    return readConversationContext({ db: io.db, businessId: bid.value, viewerId: v.viewerId, locale: io.locale(req), now: new Date(),
      params: { period: null, customer: null, product: null, reference: null } }, (req.params as { conversationId: string }).conversationId);
  };
  const allowance = (v: AdvisorViewer): Promise<CopilotPanelView['allowance']> =>
    !io.db || !io.model ? Promise.resolve('unavailable') : io.allowanceUsed(v.businessId).then((used) => used ? 'used' : 'available', () => 'unavailable');
  const view = (req: FastifyRequest, c: ConversationContext, able: CopilotPanelView['allowance'], asked = '', answer: ConversationAnswer | null = null,
    intent: ConversationIntent | null = null, consent = false, threadHref: string | null = null, keeping = false): CopilotPanelView => ({
      conversationId: c.conversationId, customerId: c.customerId, customerName: c.customerName, revision: c.revision, assistantName: c.assistantName,
      allowance: able, asked, answer, intent, history: { consent, threadHref, keeping, processor: io.processor(io.locale(req)) },
    });
  const draw = (req: FastifyRequest, reply: FastifyReply, v: CopilotPanelView) => {
    return withAssistantName(v.assistantName, () => {
      const bodyHtml = io.renderCopilotPanel(io.locale(req), v);
      return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send((req.query as { fragment?: string }).fragment === '1'
        ? bodyHtml : io.page(req, { title: t(io.locale(req), 'nav.advisor'), active: 'inbox', bodyHtml: `<h1 class="sr">${esc(t(io.locale(req), 'nav.advisor'))}</h1>${bodyHtml}` }));
    });
  };
  const question = (req: FastifyRequest): string => String((req.body as { q?: unknown } | undefined)?.q ?? '').trim().slice(0, 1000);
  const intent = (req: FastifyRequest): ConversationIntent | null => CONVERSATION_INTENTS.find((i) => i === (req.body as { intent?: unknown } | undefined)?.intent) ?? null;
  const failed = (req: FastifyRequest, able: CopilotPanelView['allowance']): ConversationAnswer => ({ kind: 'failed', text: t(io.locale(req), able === 'used' ? 'advisor.allowanceUsed' : 'advisor.unavailable'), facts: [], reply: null });

  app.get('/app/inbox/:conversationId/copilot', { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req); if (!v) return reply.redirect('/login');
    const c = await context(req, v); if (!c) return reply.callNotFound();
    return draw(req, reply, view(req, c, await allowance(v), '', null, null, false, null, (await state(v)).keep));
  });
  app.post('/app/inbox/:conversationId/copilot', { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req); if (!v) return reply.redirect('/login');
    const c = await context(req, v); if (!c) return reply.callNotFound();
    const q = question(req); const able = await allowance(v);
    const memoryState = await state(v);
    if (!q) return draw(req, reply, view(req, c, able, '', null, null, false, null, memoryState.keep));
    if (able !== 'available' || !io.model) return draw(req, reply, view(req, c, able, q, failed(req, able), null, false, null, memoryState.keep));
    const answered = await answerConversation(c, q, io.locale(req), io.model, intent(req));
    if (answered.spent.llmCalls) await io.spent(v.businessId, answered.spent);
    let threadHref: string | null = null;
    if (io.memory && memoryState.keep) {
      const a = answered.answer;
      const id = await io.memory.keep(v.businessId, v.viewerId, null, {
        question: q, entry: `conversation.${answered.intent ?? 'unknown'}`, params: { period: null, customer: c.customerId, product: c.pricing?.product.id ?? null, reference: c.conversationId },
        kind: a.kind === 'refused' ? 'none' : a.kind, text: a.reply ? `${a.text}\n\n${a.reply.text}` : a.text,
        lines: [a.text, ...a.facts.map((f) => `${f.label}: ${f.value}${f.calculation ? ` (${f.calculation})` : ''}`),
          ...(a.reply ? [`${t(io.locale(req), 'copilot.suggestedReply')}: ${a.reply.text}`] : [])], based: [], phrased: false,
        door: { href: conversationUrl(c.conversationId), label: 'nav.inbox' }, subjects: answered.subjects,
        provider: answered.spent.llmCalls ? io.provider?.name ?? null : null, model: answered.spent.llmCalls ? io.provider?.model ?? null : null,
      }, new Date()).catch(() => null);
      if (id) threadHref = `/app/advisor/c/${id}`;
    }
    return draw(req, reply, view(req, c, able, q, answered.answer, answered.intent, memoryState.ask, threadHref, memoryState.keep));
  });

  /**
   * Block 3 PR 4 — THE HAND-OFF'S THREE LINES, as JSON for the Copilot panel (its layout is the redesign's; this route
   * and its answer are the contract): what the customer wants, what was already said with each figure's source, and
   * what waits on the owner. The advisor's read-only pool; the one worded line asked within the day's allowance, put
   * on the ledger, and kept per conversation until a newer message lands (src/advisor/handoff.ts). Nothing here
   * reaches a customer: no draft, no reply, no conversation is written.
   */
  app.get('/app/conversations/:conversationId/copilot', { logLevel: 'warn' }, async (req, reply) => {
    const json = (code: number, body: unknown) => reply.code(code).header('cache-control', 'no-store').send(body);
    // A stranger goes to the door, as on every route that is not public (tests/integration/public-routes.test.ts).
    const v = io.viewer(req); if (!v) return reply.redirect('/login');
    const bid = parseBusinessId(v.businessId);
    if (!io.db || !bid.ok) return json(503, { ok: false, reason: 'unavailable' });
    const cid = (req.params as { conversationId: string }).conversationId;
    const locale = io.locale(req);
    const ctx = { db: io.db, businessId: bid.value, viewerId: v.viewerId, locale, now: new Date(), params: { period: null, customer: null, product: null, reference: null } };
    const facts = await readHandoffFacts(ctx, cid);
    if (!facts) { forgetHandoff(v.businessId, cid); return json(404, { ok: false, reason: 'not_found' }); }
    const able = await allowance(v);
    const r = await handoffSummary(facts, { businessId: v.businessId, locale, model: able === 'available' ? io.model : null, known: () => knownNames(ctx) });
    if (r.spent.llmCalls) await io.spent(v.businessId, r.spent);
    const sm = r.summary;
    return json(200, {
      ok: true, conversationId: cid, asOf: sm.asOf, cached: r.cached, allowance: able,
      lines: [sm.wants.text, sm.said.text, sm.waiting.text], wants: sm.wants, said: sm.said, waiting: sm.waiting,
      suggest: { method: 'POST', href: `/app/conversations/${cid}/copilot/suggest` },
    });
  });

  // Validation recomputes the text from current records; browser-provided text is never accepted.
  app.post('/app/inbox/:conversationId/copilot/reply', { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req); if (!v) return reply.redirect('/login');
    const c = await context(req, v); if (!c) return reply.callNotFound();
    const revision = (req.body as { revision?: unknown } | undefined)?.revision;
    const able = await allowance(v);
    const stale = typeof revision !== 'string' || revision !== c.revision;
    const q = question(req);
    const a = stale ? { kind: 'refused' as const, text: t(io.locale(req), 'copilot.stale'), facts: [], reply: null }
      : able !== 'available' ? failed(req, able)
      : !c.pendingDraftId && !ownerMayReply(ownershipOf(c.assignedTo)) ? { kind: 'refused' as const, text: t(io.locale(req), 'copilot.noComposer'), facts: [], reply: null }
      : replyForConversation(c, q, io.locale(req));
    if (req.headers.accept?.includes('application/json')) {
      return reply.header('cache-control', 'no-store').code(a.reply ? 200 : 409).send(a.reply ? { ok: true, text: a.reply.text, revision: c.revision, draftId: c.pendingDraftId, assignedTo: c.assignedTo }
        : { ok: false, reason: stale ? 'stale' : able !== 'available' ? 'unavailable' : 'refused' });
    }
    return draw(req, reply, view(req, c, able, q, a, 'draft_reply', false, null, (await state(v)).keep));
  });
}
