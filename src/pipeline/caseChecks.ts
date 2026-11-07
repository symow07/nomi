import { sql } from 'kysely';
import type { Db, Tx } from '../db/client.js';
import { withTenantTx } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import type { ConversationId } from '../core/types/ids.js';
import type { Analyzer, ReplyWriter } from '../llm/ports.js';
import { tenantRepos } from '../db/repos.js';
import { hybridRetriever } from '../retrieval/hybrid.js';
import { ensureConversation } from '../db/channels.js';
import { computeTurn } from './turn.js';
import { recordSpend } from '../db/usage.js';
import { allowanceOf, allowanceUsed } from '../db/allowance.js';
import { compareCase, type CaseResult, type CheckKind } from '../core/owner/cases.js';
import { caseTexts, checkById, finishCheck } from '../db/cases.js';
import { addProcedure } from '../db/procedures.js';
import { updateAssistant } from '../db/assistants.js';
import { validateAssistant, type AssistantInput } from '../core/owner/assistants.js';
import { validateProcedure } from '../core/owner/procedures.js';
import { updateProductTx, type ProductEdit } from '../api/web/products.js';
import { teachKnowledgeTx } from '../api/web/knowledge.js';

/**
 * THE RE-RUN (Block 3 PR 3; 0230). Each saved case runs through the real turn — the workspace's own rows, the same
 * retriever, analyser and writer, every guard — INSIDE A TRANSACTION THAT IS ROLLED BACK: the staged change is written
 * first (a fact, a procedure, the voice, a price), the case's question is put to a throwaway conversation, the reply
 * is read, and nothing of it is kept but the reply and the comparison, on the check. No draft, no turn, no signal: a
 * re-run can never be evidence for the ramp that earns sending alone. The model calls ARE paid, so they go on the
 * ledger in their own transaction, and the day's allowance is asked before each case.
 */
export type StagedChange =
  | { readonly kind: 'knowledge'; readonly productId: string | null; readonly knowledgeKind: string; readonly label: string; readonly content: string }
  | { readonly kind: 'procedure'; readonly title: string; readonly steps: string }
  | { readonly kind: 'voice'; readonly assistantId: string; readonly input: AssistantInput }
  | { readonly kind: 'price'; readonly productId: string; readonly edit: ProductEdit };

export function stagedChangeOf(kind: CheckKind, raw: unknown): StagedChange | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o['kind'] !== kind) return null;
  switch (kind) {
    case 'knowledge': return typeof o['label'] === 'string' && typeof o['content'] === 'string' && typeof o['knowledgeKind'] === 'string'
      ? { kind, productId: typeof o['productId'] === 'string' ? o['productId'] : null, knowledgeKind: o['knowledgeKind'], label: o['label'], content: o['content'] } : null;
    case 'procedure': return typeof o['title'] === 'string' && typeof o['steps'] === 'string' ? { kind, title: o['title'], steps: o['steps'] } : null;
    case 'voice': return typeof o['assistantId'] === 'string' && typeof o['input'] === 'object' && o['input'] !== null ? { kind, assistantId: o['assistantId'], input: o['input'] as AssistantInput } : null;
    case 'price': return typeof o['productId'] === 'string' && typeof o['edit'] === 'object' && o['edit'] !== null ? { kind, productId: o['productId'], edit: o['edit'] as ProductEdit } : null;
  }
}

/** The write itself, inside the caller's transaction — the same whether staged for a re-run or kept for good. */
export async function applyChange(tx: Tx, businessId: BusinessId, by: string, c: StagedChange): Promise<{ ok: true } | { ok: false; why: string }> {
  switch (c.kind) {
    case 'knowledge': {
      const r = await teachKnowledgeTx(tx, businessId, { productId: c.productId, kind: c.knowledgeKind, label: c.label, content: c.content });
      return r ? { ok: true } : { ok: false, why: 'knowledge' };
    }
    case 'procedure': {
      const v = validateProcedure({ title: c.title, steps: c.steps });
      if (!v.ok) return { ok: false, why: v.problem };
      await addProcedure(tx, businessId, by, v.value);
      return { ok: true };
    }
    case 'voice': {
      const v = validateAssistant(c.input);
      if (!v.ok) return { ok: false, why: v.problem };
      const r = await updateAssistant(tx, businessId, c.assistantId, v.value, by);
      return r === 'saved' ? { ok: true } : { ok: false, why: r };
    }
    case 'price': {
      const r = await updateProductTx(tx, businessId, c.productId, by, c.edit);
      return r.ok ? { ok: true } : { ok: false, why: Object.keys(r.errors).join(',') || 'price' };
    }
  }
}

/** Would the write succeed? Tried under a savepoint and undone: the route stages only a change that would. */
export async function wouldApply(tx: Tx, businessId: BusinessId, by: string, change: StagedChange): Promise<boolean> {
  await sql`savepoint would_apply`.execute(tx);
  try { return (await applyChange(tx, businessId, by, change)).ok; }
  catch { return false; }
  finally { await sql`rollback to savepoint would_apply`.execute(tx); }
}

class RolledBack<T> extends Error { constructor(readonly value: T) { super('rolled back on purpose'); } }

/** One case against the staged change, in a transaction that never commits. */
async function runCase(db: Db, businessId: BusinessId, by: string, change: StagedChange, question: string,
  models: { readonly analyzer: Analyzer; readonly replyWriter: ReplyWriter }, publicBaseUrl: string | null, tag: string,
): Promise<{ reply: string | null; path: string; usage: { llmCalls: number; inputTokens: number; outputTokens: number; cachedInputTokens?: number } }> {
  try {
    await withTenantTx(db, businessId, async (tx) => {
      const applied = await applyChange(tx, businessId, by, change);
      if (!applied.ok) throw new RolledBack({ reply: null, path: 'failed', usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0 } });
      // A throwaway conversation for a customer who does not exist: rolled back with everything else.
      const conv = await ensureConversation(tx, businessId, `case-check:${tag}`, 'Saved case', 'web_chat');
      const tenant = tenantRepos(tx, businessId);
      const ports = { tenant, retriever: hybridRetriever(tx, businessId), analyzer: models.analyzer, replyWriter: models.replyWriter, now: () => new Date(), publicBaseUrl };
      const r = await computeTurn(ports, { conversationId: conv.conversationId as ConversationId, messageId: `case:${tag}`, text: question });
      throw new RolledBack({ reply: r.reply, path: r.answerPath, usage: r.usage });
    });
  } catch (e) {
    if (e instanceof RolledBack) return e.value as { reply: string | null; path: string; usage: { llmCalls: number; inputTokens: number; outputTokens: number; cachedInputTokens?: number } };
    throw e;
  }
  throw new Error('unreachable');
}

export type RunCheckDeps = {
  readonly db: Db; readonly businessId: BusinessId; readonly checkId: string;
  readonly models: { readonly analyzer: Analyzer; readonly replyWriter: ReplyWriter };
  readonly publicBaseUrl: string | null;
};

/** The job: every case of the check, each in its own rolled-back transaction, each paid for; then the check is done. */
export async function runCheck(d: RunCheckDeps): Promise<CaseCheckOutcome> {
  const check = await withTenantTx(d.db, d.businessId, (tx) => checkById(tx, d.businessId, d.checkId));
  if (!check || check.status !== 'running') return { ran: 0, status: 'skipped' };
  const change = stagedChangeOf(check.kind, check.change);
  if (!change) {
    await withTenantTx(d.db, d.businessId, (tx) => finishCheck(tx, d.businessId, d.checkId, [], 0, false, 'failed'));
    return { ran: 0, status: 'failed' };
  }
  const texts = await withTenantTx(d.db, d.businessId, (tx) => caseTexts(tx, d.businessId, check.refs));
  const results: CaseResult[] = [];
  let calls = 0; let stopped = false;
  for (const [i, ref] of check.refs.entries()) {
    const text = texts.get(`${ref.kind}:${ref.id}`);
    if (!text) continue;                                                       // erased meanwhile: nothing to run
    const used = await withTenantTx(d.db, d.businessId, async (tx) => allowanceUsed(await allowanceOf(tx)));
    if (used) { stopped = true; break; }
    const r = await runCase(d.db, d.businessId, 'case-check', change, text.question, d.models, d.publicBaseUrl, `${d.checkId}:${i}`);
    calls += r.usage.llmCalls;
    if (r.usage.llmCalls > 0) await withTenantTx(d.db, d.businessId, (tx) => recordSpend(tx, d.businessId, r.usage, { turn: false }));
    results.push({ ref, reply: r.reply, path: r.path, touching: i < check.touching, ...compareCase(text.accepted, r.reply) });
  }
  await withTenantTx(d.db, d.businessId, (tx) => finishCheck(tx, d.businessId, d.checkId, results, calls, stopped, 'done'));
  return { ran: results.length, status: 'done' };
}
export type CaseCheckOutcome = { readonly ran: number; readonly status: 'done' | 'failed' | 'skipped' };

/** Does this workspace have anything to run? Asked by the routes before staging a change. */
export const hasSavedCases = async (tx: Tx, businessId: BusinessId): Promise<boolean> =>
  (await sql<{ n: number }>`select (exists (select 1 from drafts where business_id = ${businessId}::uuid and status in ('approved', 'edited') and sent_text is not null)
    or exists (select 1 from messages m join conversations c on c.id = m.conversation_id where c.business_id = ${businessId}::uuid and m.direction = 'outbound' and m.external_id like 'echo:%'))::int as n`.execute(tx)).rows[0]!.n === 1;
