import { sql } from 'kysely';
import { type Db, withTenantTx } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { BUSINESS_KINDS, canonicalCountry, countryOptions, isBusinessKind, isCountryCode, normalizeWebsite } from '../../core/owner/business.js';
import { esc } from './layout.js';
import { fieldRow, keptError, keptInvalid, type Kept } from './rows.js';


/**
 * A2 — what kind of business this is, after sign-up.
 *
 * Sign-up asks once; Business profile's section "Type and website" is where the answer changes, and where a
 * workspace made before sign-up asked (the first one, and every invitation
 * spent before 0056) gives it for the first time. Three things only: the kind,
 * the country and the website. Team size and "where buyers write today" were
 * asked for whoever sells Nomi, and have no page of their own.
 */
export type BusinessKindView = { readonly kind: string | null; readonly country: string | null; readonly website: string | null };

export async function loadBusinessKind(db: Db, businessIdRaw: string): Promise<BusinessKindView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { kind: null, country: null, website: null };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = (await sql<{ kind: string | null; country: string | null; website: string | null }>`
      select kind, country, website from businesses where id = ${bid.value}`.execute(tx)).rows[0];
    return { kind: r?.kind ?? null, country: r?.country ?? null, website: r?.website ?? null };
  });
}

/**
 * The warmth run, phase 9 (w4-settings-a-11) — which of the three answers is
 * wrong, first one first; null when all three are right. The save refuses
 * exactly when this names one, so the page can say which and keep the rest.
 */
export function businessKindProblem(input: { readonly kind: string; readonly country: string; readonly website: string }): 'kind' | 'country' | 'website' | null {
  if (!isBusinessKind(input.kind.trim())) return 'kind';
  if (!isCountryCode(input.country.trim().toUpperCase())) return 'country';
  return normalizeWebsite(input.website).ok ? null : 'website';
}

export async function saveBusinessKind(
  db: Db, businessIdRaw: string, input: { readonly kind: string; readonly country: string; readonly website: string }, actor: string,
): Promise<'saved' | 'invalid'> {
  const bid = parseBusinessId(businessIdRaw);
  const kind = input.kind.trim();
  const country = input.country.trim().toUpperCase();
  const website = normalizeWebsite(input.website);
  if (!bid.ok || businessKindProblem(input) !== null || !website.ok) return 'invalid';
  // Whatever she sent, what is WRITTEN is the code in force. A workspace that
  // stored a superseded one leaves this page holding the current one instead.
  const stored = canonicalCountry(country);
  await withTenantTx(db, bid.value, async (tx) => {
    await sql`update businesses set kind = ${kind}, country = ${stored}, website = ${website.value}
               where id = ${bid.value}`.execute(tx);
    // The same verb as the rest of her profile, naming fields and never values.
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${bid.value}, null, 'update_profile', ${actor},
                      ${JSON.stringify({ fields: ['kind', 'country', 'website'] })}::jsonb)`.execute(tx);
  });
  return 'saved';
}

/**
 * The settings overhaul (rule 104) — the kind, the country and the website as rows of Business profile's one form
 * (its section "Type and website"). `kept`: a refused save, with what was typed (`v` then holds the typed values) and
 * the refusal under the field it is about. Nothing here is `required`: the page's one Save is not held up by an
 * answer nobody has given yet; the route says which answer is wrong when one was changed.
 */
export function businessKindRows(v: BusinessKindView, locale: Locale, kept: Kept | null = null): string[] {
  const option = (value: string, label: string, chosen: string | null): string =>
    `<option value="${esc(value)}"${value === chosen ? ' selected' : ''}>${esc(label)}</option>`;
  const pick = `<option value="">${esc(t(locale, 'signup.pick'))}</option>`;
  // Phase 9 (V1-475) — in Chinese 中国 leads the list: in pinyin order it was the 248th of 250.
  const countries = countryOptions(locale);
  const ordered = locale === 'zh' ? [...countries.filter((c) => c.code === 'CN'), ...countries.filter((c) => c.code !== 'CN')] : countries;
  const country = v.country === null || v.country === '' ? null : canonicalCountry(v.country.toUpperCase());
  return [
    // Phase 9 (w4-settings-a-11) — sent back, the answer that was wrong says so under itself; the others are kept.
    fieldRow({ label: t(locale, 'signup.kind'), forId: 'bk-kind', error: keptError(kept, 'kind', 'bk-kind-err'),
      control: `<select id="bk-kind" name="kind"${keptInvalid(kept, 'kind', 'bk-kind-err')}>${pick}${BUSINESS_KINDS.map((k) =>
        option(k, t(locale, `business.kind.${k}` as MessageKey), v.kind)).join('')}</select>` }),
    // Phase 9 (V1-474) — the country, and where the town goes instead: two questions, not one asked twice.
    fieldRow({ label: t(locale, 'signup.country'), forId: 'bk-country', error: keptError(kept, 'country', 'bk-country-err'),
      desc: t(locale, 'business.kind.countryDesc', { location: t(locale, 'settings.field.location'), profile: t(locale, 'settings.profile.title') }),
      control: `<select id="bk-country" name="country" autocomplete="country"${keptInvalid(kept, 'country', 'bk-country-err')}>${pick}${ordered.map((c) =>
        option(c.code, c.name, country)).join('')}</select>` }),
    fieldRow({ label: t(locale, 'signup.website'), forId: 'bk-website', error: keptError(kept, 'website', 'bk-website-err'),
      control: `<input id="bk-website" type="text" name="website" value="${esc(v.website ?? '')}" maxlength="200"
        inputmode="url" autocapitalize="none" spellcheck="false" autocomplete="url"${keptInvalid(kept, 'website', 'bk-website-err')} />` }),
  ];
}

/** Whether what the form sent for the three is what is stored: then there is nothing of theirs to save (or to refuse). */
export function businessKindUnchanged(stored: BusinessKindView, typed: { readonly kind: string; readonly country: string; readonly website: string }): boolean {
  const country = stored.country === null ? '' : canonicalCountry(stored.country);
  const typedCountry = typed.country.trim().toUpperCase();
  return typed.kind.trim() === (stored.kind ?? '')
    && (typedCountry === country || (isCountryCode(typedCountry) && canonicalCountry(typedCountry) === country))
    && typed.website.trim() === (stored.website ?? '');
}
