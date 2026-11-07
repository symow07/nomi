import { detectInjection } from '../safety/injection.js';
import { statesAPrice } from '../safety/statesPrice.js';
import { promisesWhatNothingKeeps } from '../safety/unkeptPromise.js';

/**
 * PROCEDURES (Block 3 PR 2 of the finishing roadmap; 0229) — a short numbered list the owner writes for one situation:
 * "For a sample request: 1. ask the delivery address, 2. quote the sample price and shipping, 3. hand to me to
 * confirm." The analyser says which procedure a message starts; the writer does one step per turn; a step that
 * hands to a person is a hand-off (`procedure_handoff`), and the timeline says which step was done.
 *
 * WHAT A STEP MAY NOT SAY, refused at save time with the reason: moving money (a refund, a transfer, a charge),
 * a price or any figure (prices come only from the catalogue — the writer quotes CONTEXT.quote, never a step),
 * a promise nothing keeps ("tell them we'll call back"), an instruction to the model dressed as a step (the injection
 * guard), or a step after the one that hands over (nothing comes after handing over). A step is an instruction to
 * the writer, never words to repeat and never a source of facts: every send-path guard runs on the reply as before.
 */
export const TITLE_MAX = 120;
export const STEP_MAX = 200;
export const STEPS_MAX = 8;

export type StepKind = 'do' | 'handoff';
export type ProcedureStep = { readonly text: string; readonly kind: StepKind };
export type Procedure = { readonly id: string; readonly title: string; readonly steps: readonly ProcedureStep[] };

export type ProcedureProblem = 'title_missing' | 'title_long' | 'steps_missing' | 'steps_many' | 'step_long'
  | 'money' | 'price' | 'promise' | 'injection' | 'after_handoff';
export type ProcedureInput = { readonly title: string; readonly steps: string };
export type ValidProcedure = { readonly title: string; readonly steps: readonly ProcedureStep[] };
export type ProcedureVerdict = { readonly ok: true; readonly value: ValidProcedure }
  | { readonly ok: false; readonly problem: ProcedureProblem; readonly step: number | null };

/** The lines of the box, one step each; a leading "1." / "1)" / "-" / "•" is the list's own numbering, not the step. */
export const parseSteps = (text: string): string[] =>
  text.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[0-9]{1,2}[.)]|[-•*])\s*/, '').replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0);

/** A step that hands the conversation to a person: the owner, "me", someone on the team. Six languages. */
const HANDOFF = [
  /\b(?:hand|pass|give|send)\s+(?:it|this|them|that|the\s+(?:customer|client|conversation|rest|order))?\s*(?:over\s+|back\s+|on\s+)?to\s+(?:me|a\s+person|someone|a\s+human|the\s+owner|the\s+team|us)\b/i,
  /\bhand\s*(?:off|over)\b/i,
  /\b(?:let\s+me|i(?:'ll|\s+will)?)\s+(?:confirm|take\s+over|take\s+it\s+from\s+(?:here|there)|handle\s+(?:it|this|the\s+rest))\b/i,
  /\ba\s+person\s+(?:takes|will\s+take)\s+(?:it\s+)?over\b/i,
  /转给我|交给我|转人工|转给人工|由我(?:来)?(?:确认|处理|接手)|让我(?:来)?(?:确认|处理|接手)/,
  /حوّ?ل(?:ها|ه|ي)?\s*(?:إلي|لي|إلى\s+شخص|إلى\s+موظف)|أتولى\s*(?:أنا)?\s*(?:الباقي|الأمر|التأكيد)?|يتولى\s+(?:شخص|موظف)/,
  /p[áa]samel[oa]|me\s+lo\s+pasas|pasar(?:lo)?\s+a\s+una\s+persona|(?:lo\s+)?confirmo\s+yo|yo\s+(?:lo\s+)?confirmo/i,
  /passe-?(?:le|la|les|moi)\b|transmets?-(?:le|la|moi)\b|je\s+confirme\b|une\s+personne\s+(?:prend|reprend)\b/i,
  /passa\s+(?:pra|para)\s+mim|eu\s+confirmo|passar\s+para\s+uma\s+pessoa/i,
];
export const handsOff = (step: string): boolean => HANDOFF.some((p) => p.test(step));

/** A step that would move money: nothing on this side moves any. */
const MONEY = [
  /\b(?:refund|reimburse|pay\s*back|wire|charge\s+(?:the|their|his|her|a)\s+card|send\s+(?:them\s+|the\s+)?money|take\s+(?:the\s+|a\s+)?payment|transfer\s+(?:the\s+|their\s+)?(?:money|payment|funds|deposit))\b/i,
  /退款|退钱|转账|打款|扣款|收款/,
  /استرجاع\s+المبلغ|رد\s+المبلغ|تحويل\s+(?:المبلغ|المال|الأموال)|خصم\s+من\s+(?:البطاقة|الكارت)/,
  /\brembours|\bvirement\b|pr[ée]lever?\b|encaisser\b/i,
  /\breembols|\btransferencia\b|devolver\s+el\s+dinero|cobrar(?:le)?\b/i,
  /\bestorn|\btransfer[êe]ncia\b|devolver\s+o\s+dinheiro/i,
];
const movesMoney = (step: string): boolean => MONEY.some((p) => p.test(step));

/**
 * A step that tells the assistant to promise what nothing on this side does: a call, a reply later, a check, a send. The
 * reply guard (`promisesWhatNothingKeeps`) reads a reply's own sentences; a step is an instruction ("tell them we will
 * call back"), so the same promise is read here in its own shape, in six languages.
 */
const PROMISES = [
  /\b(?:we|i|someone|somebody|the\s+team|a\s+colleague|the\s+owner)\s+(?:will|'ll|shall|are\s+going\s+to|is\s+going\s+to|would)\s+(?:call|phone|ring|get\s+back|come\s+back|reply|respond|answer|check|confirm|contact|email|e-mail|message|write|send|ship|deliver|follow\s+up)\b/i,
  /\b(?:tell|say|promise|assure)\s+(?:them|the\s+(?:customer|client))?\s*(?:that\s+)?(?:we|someone|the\s+team)\s+(?:will|'ll)\b/i,
  /我们(?:会|将)(?:给您?)?(?:回电|回复|联系|确认|发|寄|查)|稍后(?:回复|联系)|会有人(?:联系|回复)/,
  /سن(?:تصل|رد|راجع|تواصل|رسل|ؤكد)|سوف\s+ن(?:تصل|رد|راجع|تواصل|رسل)|سيتواصل\s+معك/,
  /\b(?:te|le|les)\s+(?:llamaremos|contestaremos|responderemos|contactaremos|confirmaremos|enviaremos|escribiremos)\b|\balguien\s+(?:te|le)\s+(?:llamará|contactará|responderá)\b/i,
  /\b(?:nous|on)\s+(?:vous\s+)?(?:rappellerons|rappelle|répondrons|recontacterons|confirmerons|enverrons|reviendrons)\b|\bquelqu'un\s+(?:vous\s+)?(?:rappellera|répondra|contactera)\b/i,
  /\b(?:vamos|iremos)\s+(?:ligar|responder|retornar|confirmar|enviar|entrar\s+em\s+contato)\b|\balguém\s+(?:vai|irá)\s+(?:ligar|responder|retornar)\b/i,
];
const promisesLater = (step: string): boolean => PROMISES.some((p) => p.test(step)) || promisesWhatNothingKeeps(step) !== null;

export function validateProcedure(input: ProcedureInput): ProcedureVerdict {
  const title = input.title.replace(/\s+/g, ' ').trim();
  if (!title) return { ok: false, problem: 'title_missing', step: null };
  if (title.length > TITLE_MAX) return { ok: false, problem: 'title_long', step: null };
  const lines = parseSteps(input.steps);
  if (lines.length === 0) return { ok: false, problem: 'steps_missing', step: null };
  if (lines.length > STEPS_MAX) return { ok: false, problem: 'steps_many', step: null };
  const steps: ProcedureStep[] = [];
  let handed = false;
  for (const [i, text] of lines.entries()) {
    const step = i + 1;
    if (handed) return { ok: false, problem: 'after_handoff', step };
    if (text.length > STEP_MAX) return { ok: false, problem: 'step_long', step };
    if (detectInjection(text).detected) return { ok: false, problem: 'injection', step };
    if (movesMoney(text)) return { ok: false, problem: 'money', step };
    // A figure of any kind: a price not in the catalogue, a quantity, a date. The writer takes its figures from the
    // owner's rows, never from a step, so a step never carries one.
    if (statesAPrice(text) || /[0-9٠-٩۰-۹]/.test(text)) return { ok: false, problem: 'price', step };
    const kind: StepKind = handsOff(text) ? 'handoff' : 'do';
    if (kind === 'do' && promisesLater(text)) return { ok: false, problem: 'promise', step };
    if (kind === 'handoff') handed = true;
    steps.push({ text, kind });
  }
  return { ok: true, value: { title, steps } };
}

/** The step to do this turn: the first after a message starts the procedure, then one per inbound message. */
export type ProcedureNow = { readonly procedure: Procedure; readonly index: number; readonly step: ProcedureStep };
export function stepNow(
  procedures: readonly Procedure[],
  inProgress: { readonly id: string; readonly step: number } | null | undefined,
  started: string | null | undefined,
): ProcedureNow | null {
  if (inProgress) {
    const p = procedures.find((x) => x.id === inProgress.id);
    if (!p) return null;
    const index = inProgress.step + 1;
    const step = p.steps[index - 1];
    return step ? { procedure: p, index, step } : null;
  }
  if (started) {
    const p = procedures.find((x) => x.id === started);
    const step = p?.steps[0];
    return p && step ? { procedure: p, index: 1, step } : null;
  }
  return null;
}

/** What the writer is told: the step, by itself, with where it stands. */
export type ProcedureContext = { readonly for: string; readonly step: number; readonly of: number; readonly do: string };
export const procedureContext = (now: ProcedureNow): ProcedureContext =>
  ({ for: now.procedure.title, step: now.index, of: now.procedure.steps.length, do: now.step.text });

/** The rows as stored (jsonb), read defensively: a row the code did not write is no step. */
export function stepsFromRows(raw: unknown): ProcedureStep[] {
  if (!Array.isArray(raw)) return [];
  const out: ProcedureStep[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o['text'] !== 'string') continue;
    out.push({ text: o['text'], kind: o['kind'] === 'handoff' ? 'handoff' : 'do' });
  }
  return out;
}
