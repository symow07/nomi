import type { Db } from '../db/client.js';
import type { AdvisorModel } from '../llm/ports.js';
import { parseBusinessId } from '../core/types/ids.js';
import type { Locale } from '../core/owner/i18n/locale.js';
import type { MessageKey } from '../core/owner/i18n/messages.js';
import { t } from '../api/web/say.js';
import { CATALOGUE, entryOf } from './catalogue.js';
import { READS, knownNames, type Door, type ReadCtx, type Sheet, type Params } from './reads.js';
import { checkPhrasing } from './check.js';

/**
 * THE ADVISOR, question to answer (docs/ADVISOR-GROUNDING.md, section 2):
 *   1. the model names which catalogue entry was asked (or none: the owner is told what can be asked);
 *   2. that entry's read runs (src/advisor/reads.ts, read-only) — a "not stored" entry runs nothing;
 *   3. nothing there: the entry's fixed sentence, and the model is not asked;
 *   4. the model phrases the facts; the sentence is checked (rule 4, check.ts); a sentence that fails is
 *      thrown away and the facts themselves are the answer;
 *   5. the page that shows the same thing goes with it.
 * Opinions stand only on the entries the catalogue names for them, under their own label.
 */

export type AdvisorAnswer =
  | { readonly kind: 'fact'; readonly text: string; readonly lines: readonly string[]; readonly phrased: boolean; readonly door?: Door }
  | { readonly kind: 'none'; readonly text: string; readonly door?: Door }
  | { readonly kind: 'notStored'; readonly text: string }
  | { readonly kind: 'opinion'; readonly text: string; readonly lines: readonly string[]; readonly phrased: boolean; readonly based: readonly string[] }
  | { readonly kind: 'unknown'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string };

export type AskContext = {
  readonly db: Db;
  readonly model: AdvisorModel;
  readonly businessId: string;
  readonly viewerId: string;
  readonly locale: Locale;
  readonly now: Date;
};

const LANGUAGE: Readonly<Record<Locale, string>> = { en: 'English', zh: 'Simplified Chinese', ar: 'Arabic', es: 'Spanish', fr: 'French' };
const PERIODS = new Set(['today', 'week', 'month']);

export async function answerQuestion(a: AskContext, question: string): Promise<AdvisorAnswer> {
  const say = (key: MessageKey, p: Record<string, string> = {}): string => t(a.locale, key, p);
  const failed = (): AdvisorAnswer => ({ kind: 'failed', text: say('advisor.failed') });
  const bid = parseBusinessId(a.businessId);
  if (!bid.ok) return failed();

  let asked: Awaited<ReturnType<AdvisorModel['recognise']>>;
  try {
    asked = await a.model.recognise({ question, entries: CATALOGUE.map((e) => ({ id: e.id, ask: e.ask })) });
  } catch { return failed(); }
  const entry = asked ? entryOf(asked.id) : undefined;
  if (!asked || !entry) return { kind: 'unknown', text: say('advisor.unknown') };

  const params: Params = {
    period: asked.period && PERIODS.has(asked.period) ? asked.period as Params['period'] : null,
    customer: asked.customer, product: asked.product, reference: asked.reference,
  };
  const ctx: ReadCtx = { db: a.db, businessId: bid.value, viewerId: a.viewerId, locale: a.locale, now: a.now, params };

  if (entry.kind === 'notStored') return { kind: 'notStored', text: say(entry.says!) };

  if (entry.kind === 'opinion') {
    if (entry.says) return { kind: 'opinion', text: say(entry.says), lines: [], phrased: false, based: [] };
    let sheets: { id: string; sheet: Sheet }[];
    try {
      sheets = await Promise.all((entry.cites ?? []).map(async (id) => ({ id, sheet: await READS[id]!(ctx) })));
    } catch { return failed(); }
    const used = sheets.filter((s) => !s.sheet.empty);
    if (used.length === 0) return { kind: 'none', text: say('advisor.opinion.nothing') };
    const lines = used.flatMap((s) => s.sheet.lines);
    const names = used.flatMap((s) => s.sheet.names);
    const based = used.map((s) => say(`advisor.title.${s.id}` as MessageKey));
    const text = await phrase(a, ctx, question, lines, names, [], true);
    return { kind: 'opinion', text: text ?? '', lines, phrased: text !== null, based };
  }

  const read = READS[entry.id];
  if (!read) return failed();
  let sheet: Sheet;
  try { sheet = await read(ctx); } catch { return failed(); }
  if (sheet.empty) {
    return { kind: 'none', text: say(sheet.none ?? 'advisor.failed', { ...(sheet.noneParams ?? {}) }), ...(sheet.door ? { door: sheet.door } : {}) };
  }
  const text = await phrase(a, ctx, question, sheet.lines, sheet.names, sheet.must ?? [], false);
  return { kind: 'fact', text: text ?? '', lines: sheet.lines, phrased: text !== null, ...(sheet.door ? { door: sheet.door } : {}) };
}

/** The model's sentence, if it passes rule 4's check; null otherwise (the facts are then the answer). */
async function phrase(a: AskContext, ctx: ReadCtx, question: string, facts: readonly string[], names: readonly string[], must: readonly string[], opinion: boolean): Promise<string | null> {
  let text: string | null;
  try {
    text = await a.model.phrase({ question, language: LANGUAGE[a.locale], facts, opinion });
  } catch { return null; }
  if (!text) return null;
  const known = await knownNames(ctx).catch(() => null);
  if (!known) return null;
  return checkPhrasing(text, { facts, names, known, must, locale: a.locale }).ok ? text : null;
}
