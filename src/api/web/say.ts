import { AsyncLocalStorage } from 'node:async_hooks';
import { t as sayPlain, ASSISTANT_FALLBACK, type MessageKey } from '../../core/owner/i18n/messages.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { SetupProgress } from '../../db/setup.js';

/**
 * A5.2 — her name, for THIS request. D — and the two other facts every page
 * draws from before it says anything.
 *
 * Every sentence that says `{name}` used to be filled from one constant per
 * language. A business now names its own assistants, so the name is a fact
 * about the request: the main assistant's on a page about the whole business,
 * the conversation's own on a page about one conversation. Whether the
 * outreach area exists for this workspace, and how far its setup has come, are
 * facts of the same kind, fetched by the same look-up (`workspaceFacts`), so
 * they ride in the same scope — a second scope would be a second thing to
 * forget to open.
 *
 * The catalogue stays pure — it cannot know about requests — so the web layer
 * wraps it. Outside a scope (a test rendering a page directly, a public page)
 * there is no name, no outreach area and no setup to report.
 */
export type RequestScope = {
  readonly name: string | null;
  /** More than one assistant: the nav says "Team" instead of a name. */
  readonly several: boolean;
  /** The outreach area (sequences, prospects, writing first) is shown here. */
  readonly outreach: boolean;
  /** Null outside a workspace — a public page, a test rendering a fragment. */
  readonly setup: SetupProgress | null;
  /**
   * CC-14 — the business's own name, as the owner typed it at sign-up or last
   * saved it. The shell leads with it; absent (outside a workspace, or a
   * look-up that failed), the shell says what it always said.
   */
  readonly business?: string | null;
  /**
   * The design pass — how many customers need the owner now (Buyers' "Needs
   * you"), for the rail's one number. Read fresh on every page, never cached:
   * a count that lags is a count that lies. Absent: the rail shows none.
   */
  readonly needsYou?: number | null;
};

const scope = new AsyncLocalStorage<RequestScope>();

/** Run `fn` with these facts in force — the preHandler's call, once per request. */
export const withWorkspace = <T>(facts: RequestScope, fn: () => T): T => scope.run(facts, fn);

/**
 * Run `fn` with this name in force. A blank name leaves things as they were.
 * Nested inside a request (a page about one conversation narrowing to that
 * conversation's assistant) it keeps the request's other facts.
 */
export const withAssistantName = <T>(
  name: string | null | undefined, fn: () => T, several = false,
): T => {
  if (!name) return fn();
  const outer = scope.getStore();
  return scope.run({
    name, several, outreach: outer?.outreach ?? false, setup: outer?.setup ?? null, business: outer?.business ?? null,
    needsYou: outer?.needsYou ?? null,
  }, fn);
};

/** Is the outreach area shown for this workspace? Outside a scope: no. */
export const outreachShown = (): boolean => scope.getStore()?.outreach ?? false;

/** CC-14 — the business's name for this request, or null outside a workspace. Never blank. */
export const businessName = (): string | null => {
  const n = scope.getStore()?.business?.trim();
  return n ? n : null;
};

/** How many customers need the owner now, for the rail; null outside a workspace or when it could not be read. */
export const needsYouCount = (): number | null => scope.getStore()?.needsYou ?? null;

/** How far setup has come, for the badge and the Today card. Outside a scope: nothing to say. */
export const setupState = (): SetupProgress | null => scope.getStore()?.setup ?? null;

/**
 * The name in force here, else "Your assistant" — capitalised, because a caller
 * that prints this on its own prints a label. Passed into `t` as `{name}`, the
 * catalogue sets the case for where it lands in the sentence.
 */
export const assistantName = (locale: Locale): string => {
  const fallback = ASSISTANT_FALLBACK[locale];
  return scope.getStore()?.name ?? fallback.charAt(0).toLocaleUpperCase() + fallback.slice(1);
};

/** Does this business have more than one assistant? Outside a scope: no. */
export const assistantsAreSeveral = (): boolean => scope.getStore()?.several ?? false;

/** `t`, with `{name}` filled from the request. An explicit `name` still wins. */
export const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>): string =>
  sayPlain(locale, key, { name: assistantName(locale), ...params });

/**
 * The facts per business, remembered for a minute so a page costs no extra
 * look-up, and forgotten the moment any of them changes — a rename, a
 * confirmed name, a step of setup completed. `null` is a real answer ("no row
 * yet") and is remembered too.
 */
export type WhoAnswers = { readonly name: string | null; readonly several: boolean };

export type NameCache<T extends object = WhoAnswers> = {
  get(businessId: string, now: number): T | undefined;
  set(businessId: string, who: T, now: number): void;
  evict(businessId: string): void;
};

export function makeNameCache<T extends object = WhoAnswers>(ttlMs = 60_000, maxKeys = 5000): NameCache<T> {
  const held = new Map<string, { readonly who: T; readonly at: number }>();
  return {
    get(businessId, now) {
      const hit = held.get(businessId);
      if (!hit) return undefined;
      if (now - hit.at >= ttlMs) { held.delete(businessId); return undefined; }
      return hit.who;
    },
    set(businessId, who, now) {
      held.set(businessId, { who, at: now });
      if (held.size > maxKeys) {
        const first = held.keys().next().value;
        if (first !== undefined) held.delete(first);
      }
    },
    evict(businessId) { held.delete(businessId); },
  };
}
