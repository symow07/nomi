import { AsyncLocalStorage } from 'node:async_hooks';
import { t as sayPlain, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import type { Locale } from '../../core/owner/i18n/locale.js';

/**
 * A5.2 — her name, for THIS request.
 *
 * Every sentence that says `{name}` used to be filled from one constant per
 * language. A business now names its own assistants, so the name is a fact
 * about the request: the main assistant's on a page about the whole business,
 * the conversation's own on a page about one conversation.
 *
 * The catalogue stays pure — it cannot know about requests — so the web layer
 * wraps it. Outside a scope (a test rendering a page directly, a public page)
 * the name is the constant it always was, which is also what an account that
 * never renamed anyone sees.
 */
const scope = new AsyncLocalStorage<{ readonly name: string; readonly several: boolean }>();

/**
 * Run `fn` with this name in force. A blank name leaves things as they were.
 *
 * `several` says whether this business has MORE THAN ONE assistant, which the
 * nav needs: an entry that reads as a person's name is right for a business
 * with one and wrong for a business with four. It rides in the same scope
 * because it is the same fact about the same request, fetched by the same
 * look-up, and a second scope would be a second thing to forget to open.
 */
export const withAssistantName = <T>(
  name: string | null | undefined, fn: () => T, several = false,
): T => (name ? scope.run({ name, several }, fn) : fn());

/** The name in force here, else the product's constant for this language. */
export const assistantName = (locale: Locale): string => scope.getStore()?.name ?? EMPLOYEE_NAME[locale];

/** Does this business have more than one assistant? Outside a scope: no. */
export const assistantsAreSeveral = (): boolean => scope.getStore()?.several ?? false;

/** `t`, with `{name}` filled from the request. An explicit `name` still wins. */
export const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>): string =>
  sayPlain(locale, key, { name: assistantName(locale), ...params });

/**
 * The main assistant's name per business, remembered for a minute so a page
 * costs no extra look-up, and forgotten the moment she renames someone.
 * `null` is a real answer ("no row yet") and is remembered too.
 */
export type WhoAnswers = { readonly name: string | null; readonly several: boolean };

export type NameCache = {
  get(businessId: string, now: number): WhoAnswers | undefined;
  set(businessId: string, who: WhoAnswers, now: number): void;
  evict(businessId: string): void;
};

export function makeNameCache(ttlMs = 60_000, maxKeys = 5000): NameCache {
  const held = new Map<string, { readonly who: WhoAnswers; readonly at: number }>();
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
