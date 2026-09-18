import { sql } from 'kysely';
import { type Db, withTenantTx } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { BUSINESS_KINDS, countryOptions, isBusinessKind, isCountryCode, normalizeWebsite } from '../../core/owner/business.js';
import { back, esc } from './layout.js';

/**
 * A2 — what kind of business this is, after sign-up.
 *
 * Sign-up asks once; this is where she changes her answer, and where a
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

export async function saveBusinessKind(
  db: Db, businessIdRaw: string, input: { readonly kind: string; readonly country: string; readonly website: string }, actor: string,
): Promise<'saved' | 'invalid'> {
  const bid = parseBusinessId(businessIdRaw);
  const kind = input.kind.trim();
  const country = input.country.trim().toUpperCase();
  const website = normalizeWebsite(input.website);
  if (!bid.ok || !isBusinessKind(kind) || !isCountryCode(country) || !website.ok) return 'invalid';
  await withTenantTx(db, bid.value, async (tx) => {
    await sql`update businesses set kind = ${kind}, country = ${country}, website = ${website.value}
               where id = ${bid.value}`.execute(tx);
    // The same verb as the rest of her profile, naming fields and never values.
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${bid.value}, null, 'update_profile', ${actor},
                      ${JSON.stringify({ fields: ['kind', 'country', 'website'] })}::jsonb)`.execute(tx);
  });
  return 'saved';
}

export function renderBusinessKind(v: BusinessKindView, locale: Locale, flash: string | null, backLabel: string): string {
  const option = (value: string, label: string, chosen: string | null): string =>
    `<option value="${esc(value)}"${value === chosen ? ' selected' : ''}>${esc(label)}</option>`;
  const pick = `<option value="">${esc(t(locale, 'signup.pick'))}</option>`;
  return `${back('/app/settings', backLabel)}
    <h1 class="page">${esc(t(locale, 'business.kind.label'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">
      <form method="post" action="/app/settings/business" class="pform">
        <div class="fld"><label for="bk-kind">${esc(t(locale, 'signup.kind'))}</label>
          <select id="bk-kind" name="kind" required>${pick}${BUSINESS_KINDS.map((k) =>
            option(k, t(locale, `business.kind.${k}` as MessageKey), v.kind)).join('')}</select></div>
        <div class="fld"><label for="bk-country">${esc(t(locale, 'signup.country'))}</label>
          <select id="bk-country" name="country" required autocomplete="country">${pick}${countryOptions(locale).map((c) =>
            option(c.code, c.name, v.country)).join('')}</select></div>
        <div class="fld"><label for="bk-website">${esc(t(locale, 'signup.website'))}</label>
          <input id="bk-website" type="text" name="website" value="${esc(v.website ?? '')}" maxlength="200"
            inputmode="url" autocapitalize="none" spellcheck="false" autocomplete="url" /></div>
        <button class="btn send" type="submit">${esc(t(locale, 'business.kind.save'))}</button>
      </form>
    </section>`;
}
