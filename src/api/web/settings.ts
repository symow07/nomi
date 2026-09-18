import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { type Locale, LOCALES, LOCALE_LABEL } from '../../core/owner/i18n/locale.js';
import { t, type MessageKey, EMPLOYEE_NAME } from '../../core/owner/i18n/messages.js';
import { validateOwnerPhone } from '../../pipeline/notify.js';
import { FORBIDDEN_FLOOR } from '../../core/safety/forbiddenWords.js';
import { type OwnerRate, type RateError, validateRate } from '../../core/commerce/exchange.js';
import { type FactoryClosure, type ClosureError, validateClosure, closureDate } from '../../core/commerce/closures.js';
import { type SamplePolicy, type SamplePolicyError, validateSamplePolicy } from '../../core/commerce/samples.js';
import {
  type TradeTerms, type TradeTermsError, validateTradeTerms, MAX_PAYMENT_TERMS,
} from '../../core/commerce/terms.js';
import { INCOTERM_KEYS } from '../../core/safety/claims.js';
import { tenantRepos } from '../../db/repos.js';
import { parseCurrency } from '../../core/types/money.js';
import { formatDate, formatMoney, formatRelative } from '../../core/owner/i18n/format.js';
import { deeper, esc } from './layout.js';

/**
 * M11.1 — Business Profile & Owner Settings. A VIEW + edit over the EXISTING
 * businesses row (no second business model). Field labels localize via t();
 * the VALUES are business data, stored verbatim, never translated. Product
 * categories are DERIVED from products.category (reuse the catalog). Working
 * hours are free text; languages_served is informational (no behavior gating).
 */

export type ProfileInput = {
  readonly name: string; readonly description: string; readonly location: string;
  readonly workingHours: string; readonly contactEmail: string; readonly contactPhone: string;
  readonly languagesServed: readonly string[];
};

type ProfileValue = {
  readonly name: string; readonly description: string | null; readonly location: string | null;
  readonly workingHours: string | null; readonly contactEmail: string | null;
  readonly contactPhone: string | null; readonly languagesServed: readonly string[];
};

const CAP = { name: 200, location: 200, workingHours: 200, description: 1000 };
const nz = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * M20.4 (F-07) — which field, and why. The old validator returned a bare
 * `{ok:false}`, so the route could only say "check what you entered" and then
 * re-render from the DATABASE — discarding everything the owner had typed. A
 * Chinese landline without a leading "+" therefore silently threw away the
 * description, location, hours, e-mail and languages alongside it.
 */
export type ProfileField = 'name' | 'description' | 'location' | 'workingHours' | 'contactEmail' | 'contactPhone';
export type ProfileError = 'required' | 'tooLong' | 'emailShape' | 'phoneShape';
export type ProfileErrors = Partial<Record<ProfileField, ProfileError>>;

/** Pure validation. Reports EVERY bad field at once, so one fix-and-retry is enough. */
export function validateProfile(
  input: ProfileInput,
): { ok: true; value: ProfileValue } | { ok: false; errors: ProfileErrors } {
  const errors: ProfileErrors = {};
  const name = input.name.trim();
  if (name.length === 0) errors.name = 'required';
  else if (name.length > CAP.name) errors.name = 'tooLong';
  if (input.description.trim().length > CAP.description) errors.description = 'tooLong';
  if (input.location.trim().length > CAP.location) errors.location = 'tooLong';
  if (input.workingHours.trim().length > CAP.workingHours) errors.workingHours = 'tooLong';

  const email = input.contactEmail.trim();
  if (email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.contactEmail = 'emailShape';
  const phone = validateOwnerPhone(input.contactPhone);   // reuse: empty clears, else E.164-ish
  if (!phone.ok) errors.contactPhone = 'phoneShape';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (!phone.ok) return { ok: false, errors };

  const langs = input.languagesServed.filter((l): l is Locale => l === 'en' || l === 'zh' || l === 'ar');
  return {
    ok: true,
    value: {
      name, description: nz(input.description), location: nz(input.location),
      workingHours: nz(input.workingHours), contactEmail: email === '' ? null : email,
      contactPhone: phone.value, languagesServed: langs,
    },
  };
}

export type BusinessProfile = {
  readonly name: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly workingHours: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly languagesServed: readonly string[];
  readonly categories: readonly string[];        // derived from products.category
};

export async function loadBusinessProfile(db: Db, businessIdRaw: string): Promise<BusinessProfile> {
  const empty: BusinessProfile = {
    name: '', description: null, location: null, workingHours: null, contactEmail: null,
    contactPhone: null, languagesServed: [], categories: [],
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;

  return withTenantTx(db, bid.value, async (tx) => {
    const b = (await sql<{
      name: string; description: string | null; location: string | null; working_hours: string | null;
      contact_email: string | null; contact_phone: string | null; languages_served: string[] | null;
    }>`select name, description, location, working_hours, contact_email, contact_phone, languages_served
         from businesses where id = ${bid.value}`.execute(tx)).rows[0] ?? null;
    if (!b) return empty;

    const categories = (await sql<{ category: string }>`
      select distinct category from products where category is not null order by category`.execute(tx))
      .rows.map((r) => r.category);

    return {
      name: b.name, description: b.description, location: b.location, workingHours: b.working_hours,
      contactEmail: b.contact_email, contactPhone: b.contact_phone,
      languagesServed: b.languages_served ?? [], categories,
    };
  });
}

const langsSql = (langs: readonly string[]) =>
  langs.length ? sql`array[${sql.join(langs.map((l) => sql`${l}`), sql`, `)}]::text[]` : sql`array[]::text[]`;

export async function saveBusinessProfile(
  db: Db, businessIdRaw: string, input: ProfileInput, actor: string,
): Promise<{ code: 'saved' } | { code: 'invalid'; errors: ProfileErrors }> {
  const v = validateProfile(input);
  if (!v.ok) return { code: 'invalid', errors: v.errors };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'invalid', errors: {} };

  await withTenantTx(db, bid.value, async (tx) => {
    const cur = (await sql<{
      name: string; description: string | null; location: string | null; working_hours: string | null;
      contact_email: string | null; contact_phone: string | null; languages_served: string[] | null;
    }>`select name, description, location, working_hours, contact_email, contact_phone, languages_served
         from businesses where id = ${bid.value}`.execute(tx)).rows[0];

    await sql`update businesses set
        name = ${v.value.name}, description = ${v.value.description}, location = ${v.value.location},
        working_hours = ${v.value.workingHours}, contact_email = ${v.value.contactEmail},
        contact_phone = ${v.value.contactPhone}, languages_served = ${langsSql(v.value.languagesServed)}
      where id = ${bid.value}`.execute(tx);

    // Audit only the field NAMES that changed — never sensitive values.
    const eq = (a: string | null | undefined, b: string | null | undefined) => (a ?? '') === (b ?? '');
    const changed: string[] = [];
    if (cur) {
      if (!eq(cur.name, v.value.name)) changed.push('name');
      if (!eq(cur.description, v.value.description)) changed.push('description');
      if (!eq(cur.location, v.value.location)) changed.push('location');
      if (!eq(cur.working_hours, v.value.workingHours)) changed.push('working_hours');
      if (!eq(cur.contact_email, v.value.contactEmail)) changed.push('contact_email');
      if (!eq(cur.contact_phone, v.value.contactPhone)) changed.push('contact_phone');
      if ((cur.languages_served ?? []).join(',') !== v.value.languagesServed.join(',')) changed.push('languages_served');
    }
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid.value}, null, 'update_profile', ${actor}, ${JSON.stringify({ fields: changed })}::jsonb)`.execute(tx);
  });
  return { code: 'saved' };
}

/** ── Renderer (pure, mobile-first, localized, escaped) ────────────────────── */

/** What the owner just typed, so a rejected save re-renders THEIR words. */
export type ProfileDraft = Partial<Record<ProfileField, string>> & { readonly languagesServed?: readonly string[] };

export function renderSettings(
  p: BusinessProfile, locale: Locale, flash: string | null,
  draft: ProfileDraft = {}, errors: ProfileErrors = {},
): string {
  // M20.4 (F-07) — the submitted value wins over the stored one, so nothing the
  // owner typed is lost when one field is wrong.
  const val = (f: ProfileField, stored: string | null): string => draft[f] ?? stored ?? '';
  const errLine = (f: ProfileField): string => {
    const e = errors[f];
    if (!e) return '';
    const detail = e === 'tooLong' ? { n: CAP[f as keyof typeof CAP] ?? 200 } : {};
    return `<span class="fielderr" role="alert">${esc(t(locale, `settings.err.${e}` as MessageKey, detail))}</span>`;
  };
  const field = (id: string, label: MessageKey, f: ProfileField, stored: string | null, ph = '') =>
    `<label class="fld ${errors[f] ? 'bad' : ''}"><span class="muted">${esc(t(locale, label))}</span>
      <input name="${id}" value="${esc(val(f, stored))}"${ph ? ` placeholder="${esc(ph)}"` : ''} />${errLine(f)}</label>`;

  const languages = `<div class="fld"><span class="muted">${esc(t(locale, 'settings.field.languages'))}</span>
    <div class="langs">${LOCALES.map((l) =>
      `<label class="chkbox"><input type="checkbox" name="lang_${l}"${(draft.languagesServed ?? p.languagesServed).includes(l) ? ' checked' : ''} /> ${esc(LOCALE_LABEL[l])}</label>`).join('')}</div></div>`;

  const form = `<div class="block"><h2>${esc(t(locale, 'settings.profile.title'))}</h2>
    <form method="post" action="/app/settings" class="pform">
      ${field('name', 'settings.field.name', 'name', p.name)}
      <label class="fld"><span class="muted">${esc(t(locale, 'settings.field.description'))}</span>
        <textarea name="description" rows="3">${esc(val('description', p.description))}</textarea>${errLine('description')}</label>
      ${field('location', 'settings.field.location', 'location', p.location)}
      ${field('working_hours', 'settings.field.workingHours', 'workingHours', p.workingHours, t(locale, 'settings.workingHours.ph'))}
      ${languages}
      ${field('contact_email', 'settings.field.contactEmail', 'contactEmail', p.contactEmail)}
      ${field('contact_phone', 'settings.field.contactPhone', 'contactPhone', p.contactPhone, t(locale, 'settings.alerts.placeholder'))}
      <button class="btn send" type="submit">${esc(t(locale, 'settings.alerts.save'))}</button>
    </form>
  </div>`;

  const categories = `<div class="block"><h2>${esc(t(locale, 'settings.field.categories'))}</h2>
    ${p.categories.length
      ? `<div class="cats">${p.categories.map((c) => `<span class="cat">${esc(c)}</span>`).join('')}</div>`
      : `<div class="muted empty">${esc(t(locale, 'settings.categories.empty'))}</div>`}
  </div>`;

  return `<h1 class="page">${esc(t(locale, 'settings.profile.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    ${form}${categories}
    ${deeper('/app/settings/forbidden',
      t(locale, 'forbidden.title', { name: EMPLOYEE_NAME[locale] }))}
    ${deeper('/app/settings/rate', t(locale, 'rate.title'))}
    ${deeper('/app/settings/closures', t(locale, 'closures.title'))}
    ${deeper('/app/settings/samples', t(locale, 'samples.title'))}
    ${deeper('/app/settings/terms', t(locale, 'terms.title'))}
    ${deeper('/app/settings/people', t(locale, 'people.title'))}
    ${deeper('/app/settings/account', t(locale, 'account.title'))}
    ${SETTINGS_STYLE}`;
}

const SETTINGS_STYLE = `<style>
  .fielderr { color:var(--color-warn); font-size:var(--font-size-caption); }
  .fld.bad input, .fld.bad textarea { border-color:var(--color-warn-line); }
  .ok-line { color:var(--color-ok); font-weight:600; margin-bottom:var(--space-12); }
  .pform input, .pform textarea { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; resize:vertical; }
  .langs { display:flex; flex-wrap:wrap; gap:var(--space-12); padding-top:2px; }
  .cats { display:flex; flex-wrap:wrap; gap:var(--space-8); }
  .cat { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:5px 12px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  
</style>
  `;

/* ── M37.5 · the words she may never say ─────────────────────────────────── */

/**
 * The owner's own forbidden list, plus the floor she cannot remove.
 *
 * The floor is RENDERED, not hidden: she should be able to see that "never
 * curse at a buyer" is enforced without her having typed it, and that she
 * cannot switch it off. A guarantee the owner cannot see is a guarantee she
 * cannot rely on.
 */
export type ForbiddenView = {
  /**
   * G8 — with her note: why she added it, in her words. The column existed
   * since 0029 and nothing wrote it; it is hers, and never shown to a buyer.
   */
  readonly own: readonly { readonly id: string; readonly term: string; readonly note?: string | null }[];
  readonly floor: readonly string[];
};

/** Long enough for a reason; short enough to stay a note. */
export const MAX_FORBIDDEN_NOTE = 200;

export async function loadForbidden(db: Db, businessIdRaw: string): Promise<ForbiddenView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { own: [], floor: FORBIDDEN_FLOOR };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string; term: string; note: string | null }>`
      select id, term, note from forbidden_terms
       where business_id = ${bid.value}::uuid and archived_at is null
       order by created_at desc`.execute(tx);
    return { own: r.rows, floor: FORBIDDEN_FLOOR };
  });
}

export async function addForbidden(
  db: Db, businessIdRaw: string, term: string, note = '',
): Promise<{ code: 'added' | 'empty' | 'duplicate' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const clean = term.trim();
  if (!clean) return { code: 'empty' };
  const why = note.trim().slice(0, MAX_FORBIDDEN_NOTE) || null;
  return withTenantTx(db, bid.value, async (tx) => {
    const existing = await sql<{ id: string }>`
      select id from forbidden_terms
       where business_id = ${bid.value}::uuid and lower(btrim(term)) = lower(btrim(${clean}))
         and archived_at is null`.execute(tx);
    if (existing.rows[0]) return { code: 'duplicate' as const };
    // A term she archived and adds again is a NEW row: the old one keeps its
    // record of when it was forbidden and why. (0029's comment says re-adding
    // "revives" the archived row; it never did, and history is the better rule.)
    await sql`insert into forbidden_terms (business_id, term, note)
              values (${bid.value}::uuid, ${clean}, ${why})`.execute(tx);
    return { code: 'added' as const };
  });
}

/** Archive, never erase — the record of what was once forbidden survives. */
export async function removeForbidden(
  db: Db, businessIdRaw: string, id: string,
): Promise<{ code: 'removed' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update forbidden_terms set archived_at = now()
       where id = ${id}::uuid and business_id = ${bid.value}::uuid and archived_at is null
      returning id`.execute(tx);
    return { code: r.rows[0] ? 'removed' as const : 'failed' as const };
  });
}

export function renderForbidden(v: ForbiddenView, locale: Locale, flash: string | null): string {
  const name = EMPLOYEE_NAME[locale];
  return `<h1 class="page">${esc(t(locale, 'forbidden.title', { name }))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">
      <p class="muted">${esc(t(locale, 'forbidden.intro', { name }))}</p>
      <form method="post" action="/app/settings/forbidden" class="fld">
        <label><span class="muted">${esc(t(locale, 'forbidden.add.label'))}</span>
          <input name="term" required maxlength="80"
            placeholder="${esc(t(locale, 'forbidden.add.placeholder'))}" /></label>
        <label><span class="muted">${esc(t(locale, 'forbidden.add.note'))}</span>
          <input name="note" maxlength="${MAX_FORBIDDEN_NOTE}"
            placeholder="${esc(t(locale, 'forbidden.add.notePlaceholder'))}" /></label>
        <button class="btn send" type="submit">${esc(t(locale, 'forbidden.add.button'))}</button>
      </form>
      ${v.own.length === 0
        ? `<p class="muted empty-p">${esc(t(locale, 'forbidden.empty'))}</p>`
        : `<ul class="fterms">${v.own.map((x) => `<li>
            <span><bdi>${esc(x.term)}</bdi>${x.note
              ? `<span class="fnote muted"><bdi>${esc(x.note)}</bdi></span>` : ''}</span>
            <form method="post" action="/app/settings/forbidden/${esc(x.id)}/remove" class="inline">
              <button class="btn" type="submit">${esc(t(locale, 'forbidden.remove'))}</button>
            </form></li>`).join('')}</ul>`}
    </section>
    <section class="block">
      <h2>${esc(t(locale, 'forbidden.floor.title'))}</h2>
      <p class="muted">${esc(t(locale, 'forbidden.floor.body', { name }))}</p>
      <ul class="fterms floor">${v.floor.map((x) => `<li><bdi>${esc(x)}</bdi></li>`).join('')}</ul>
    </section>
    <style>
      .fterms { list-style:none; margin:var(--space-12) 0 0; padding:0; }
      .fterms li { display:flex; align-items:center; justify-content:space-between;
                   gap:var(--space-12); padding:var(--space-8) 0;
                   border-bottom:1px solid var(--color-border); }
      .fterms li:last-child { border-bottom:0; }
      .fterms.floor li { color:var(--color-ink-secondary); }
      .fterms .fnote { display:block; font-size:var(--font-size-caption); margin-top:var(--space-4); }
    </style>`;
}

/* ── M43b · the rate she will honour ─────────────────────────────────────── */

/**
 * Her stated rate, and the ones she stated before it.
 *
 * The DATE is not decoration. A rate she set eight months ago is a real risk
 * and it is still her rate; refusing it would mean inventing a staleness
 * threshold, which is an invented number wearing a responsible-looking hat. So
 * the date is shown wherever the rate is, and she decides.
 */
export type RateView = {
  readonly current: OwnerRate | null;
  /** Previously stated rates, newest first. History, never overwritten. */
  readonly previous: readonly OwnerRate[];
};

const toRate = (r: { from_currency: string; to_currency: string; rate: string; stated_at: Date }): OwnerRate | null => {
  const from = parseCurrency(r.from_currency);
  const to = parseCurrency(r.to_currency);
  // A pair this build cannot price is not shown as one it can. Same rule as
  // every other currency read: drop it, never default it.
  return from === null || to === null
    ? null
    : { from, to, rate: Number(r.rate), statedAt: r.stated_at };
};

/**
 * The one rate in force, inside a transaction the caller already has.
 *
 * Shaped like `loadProofLinkState`: any surface that shows a figure in her
 * money needs the rate AND its date, and neither should cost a second
 * connection or arrive without the other.
 */
export async function loadCurrentRate(tx: Tx, businessId: BusinessId): Promise<OwnerRate | null> {
  const r = await sql<{ from_currency: string; to_currency: string; rate: string; stated_at: Date }>`
    select from_currency, to_currency, rate, stated_at from owner_rates
     where business_id = ${businessId}::uuid and from_currency = 'USD' and to_currency = 'CNY'
     order by stated_at desc limit 1`.execute(tx);
  return r.rows[0] ? toRate(r.rows[0]) : null;
}

export async function loadRates(db: Db, businessIdRaw: string): Promise<RateView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { current: null, previous: [] };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ from_currency: string; to_currency: string; rate: string; stated_at: Date }>`
      select from_currency, to_currency, rate, stated_at from owner_rates
       where business_id = ${bid.value}::uuid and from_currency = 'USD' and to_currency = 'CNY'
       order by stated_at desc limit 20`.execute(tx);
    const all = r.rows.map(toRate).filter((x): x is OwnerRate => x !== null);
    return { current: all[0] ?? null, previous: all.slice(1) };
  });
}

/** Stating a rate INSERTS. It never updates: a quote given in March was
 *  converted at March's rate, and the row that did it stays to say so. */
export async function setRate(
  db: Db, businessIdRaw: string, raw: string | null | undefined, now: Date,
): Promise<{ code: 'set'; rate: OwnerRate } | { code: RateError | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const v = validateRate({ from: 'USD', to: 'CNY', rate: raw, now });
  if (!v.ok) return { code: v.error };
  return withTenantTx(db, bid.value, async (tx) => {
    await sql`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at)
              values (${bid.value}::uuid, 'USD', 'CNY', ${v.value.rate}, ${v.value.statedAt})`.execute(tx);
    return { code: 'set' as const, rate: v.value };
  });
}

export function renderRate(v: RateView, locale: Locale, flash: string | null): string {
  const name = EMPLOYEE_NAME[locale];
  const stated = (r: OwnerRate): string =>
    `${esc(t(locale, 'rate.current', { rate: r.rate }))} <span class="muted">· ${esc(t(locale, 'rate.setOn', { date: formatDate(locale, r.statedAt) }))}</span>`;
  return `<h1 class="page">${esc(t(locale, 'rate.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">
      <p class="muted">${esc(t(locale, 'rate.intro', { name }))}</p>
      ${v.current
        ? `<p class="stated-now"><bdi>${stated(v.current)}</bdi></p>`
        : `<p class="muted empty-p">${esc(t(locale, 'rate.empty'))}</p>`}
      <form method="post" action="/app/settings/rate" class="fld">
        <label><span class="muted">${esc(t(locale, 'rate.add.label'))}</span>
          <input name="rate" inputmode="decimal" required
            placeholder="${esc(t(locale, 'rate.add.placeholder'))}" /></label>
        <button class="btn send" type="submit">${esc(t(locale, 'rate.add.button'))}</button>
      </form>
    </section>
    ${v.previous.length
      ? `<section class="block"><h2>${esc(t(locale, 'rate.history.title'))}</h2>
         <ul class="rate-hist">${v.previous.map((r) => `<li><bdi>${stated(r)}</bdi></li>`).join('')}</ul>
         </section>`
      : ''}
    <style>
      .rate-hist { list-style:none; margin:var(--space-12) 0 0; padding:0; }
      .rate-hist li { padding:var(--space-8) 0; border-bottom:1px solid var(--color-border);
                      color:var(--color-ink-secondary); font-size:var(--font-size-note); }
      .rate-hist li:last-child { border-bottom:0; }
    </style>`;
}

/* ── M44 · the days the factory is shut ──────────────────────────────────── */

/**
 * Her closures, as she stated them.
 *
 * There is no built-in holiday calendar behind this and there must never be
 * one: the dates are lunar and move, and the LENGTH is a business decision one
 * factory makes differently from the next. What is shown here is what she
 * typed, and it is the only thing that blocks a delivery promise.
 */
export type ClosureRow = FactoryClosure & { readonly id: string };
export type ClosureView = { readonly closures: readonly ClosureRow[] };

export async function loadClosures(db: Db, businessIdRaw: string): Promise<ClosureView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { closures: [] };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string; label: string; starts_on: Date; ends_on: Date }>`
      select id, label, starts_on, ends_on from factory_closures
       where business_id = ${bid.value}::uuid and archived_at is null
       order by starts_on`.execute(tx);
    return {
      closures: r.rows.map((x) => ({
        id: x.id, label: x.label, from: closureDate(x.starts_on), to: closureDate(x.ends_on),
      })),
    };
  });
}

export async function addClosure(
  db: Db, businessIdRaw: string,
  input: { label?: string | null; from?: string | null; to?: string | null },
): Promise<{ code: 'added'; label: string } | { code: ClosureError | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const v = validateClosure({ label: input.label, from: input.from, to: input.to });
  if (!v.ok) return { code: v.error };
  return withTenantTx(db, bid.value, async (tx) => {
    await sql`insert into factory_closures (business_id, label, starts_on, ends_on)
              values (${bid.value}::uuid, ${v.value.label},
                      ${v.value.from.toISOString().slice(0, 10)},
                      ${v.value.to.toISOString().slice(0, 10)})`.execute(tx);
    return { code: 'added' as const, label: v.value.label };
  });
}

/** Archive, never erase — a past closure still explains a quote that promised
 *  no date in January. */
export async function removeClosure(
  db: Db, businessIdRaw: string, id: string,
): Promise<{ code: 'removed' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update factory_closures set archived_at = now()
       where id = ${id}::uuid and business_id = ${bid.value}::uuid and archived_at is null
      returning id`.execute(tx);
    return { code: r.rows[0] ? 'removed' as const : 'failed' as const };
  });
}

export function renderClosures(v: ClosureView, locale: Locale, flash: string | null): string {
  const name = EMPLOYEE_NAME[locale];
  const range = (c: FactoryClosure) =>
    t(locale, 'closures.range', { from: formatDate(locale, c.from), to: formatDate(locale, c.to) });
  return `<h1 class="page">${esc(t(locale, 'closures.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">
      <p class="muted">${esc(t(locale, 'closures.intro', { name }))}</p>
      <form method="post" action="/app/settings/closures" class="pform">
        <label class="fld"><span class="muted">${esc(t(locale, 'closures.add.label'))}</span>
          <input name="label" required maxlength="80"
            placeholder="${esc(t(locale, 'closures.add.placeholder'))}" />
          <span class="muted">${esc(t(locale, 'closures.add.shown'))}</span></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'closures.add.from'))}</span>
          <input name="from" type="date" required /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'closures.add.to'))}</span>
          <input name="to" type="date" required /></label>
        <button class="btn send" type="submit">${esc(t(locale, 'closures.add.button'))}</button>
      </form>
      ${v.closures.length === 0
        ? `<p class="muted empty-p">${esc(t(locale, 'closures.empty', { name }))}</p>`
        : `<ul class="closures">${v.closures.map((c) => `<li>
            <span><bdi>${esc(c.label)}</bdi> <span class="muted">${esc(range(c))}</span></span>
            <form method="post" action="/app/settings/closures/${esc(c.id)}/remove" class="inline">
              <button class="btn" type="submit">${esc(t(locale, 'closures.remove'))}</button>
            </form></li>`).join('')}</ul>`}
    </section>
    <style>
      .closures { list-style:none; margin:var(--space-12) 0 0; padding:0; }
      .closures li { display:flex; align-items:center; justify-content:space-between;
                     gap:var(--space-12); padding:var(--space-8) 0;
                     border-bottom:1px solid var(--color-border); }
      .closures li:last-child { border-bottom:0; }
    </style>`;
}

/* ── M45 · samples ───────────────────────────────────────────────────────── */

/**
 * What she has said about samples, and who is waiting for one.
 *
 * ONE PAGE, TWO HALVES, on purpose. The policy without the requests is a
 * setting nobody visits; the requests without the policy are a list she cannot
 * act on. A buyer waiting for a sample is the reason to state the price, and
 * the price is what lets Nomi answer the next one.
 */
export type SampleRequestRow = {
  readonly id: string;
  readonly conversationId: string;
  readonly buyer: string | null;
  readonly askedText: string;
  readonly requestedAt: Date;
  readonly address: string | null;
};
export type SamplesView = {
  readonly policy: SamplePolicy | null;
  /** Open requests, oldest first — the one waiting longest is the one to do. */
  readonly waiting: readonly SampleRequestRow[];
};

export async function loadSamples(db: Db, businessIdRaw: string): Promise<SamplesView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { policy: null, waiting: [] };
  return withTenantTx(db, bid.value, async (tx) => {
    const policy = await tenantRepos(tx, bid.value).catalog.samplePolicy();
    const r = await sql<{
      id: string; conversation_id: string; buyer: string | null;
      asked_text: string; requested_at: Date; address: string | null;
    }>`
      select sr.id, sr.conversation_id, cl.display_name as buyer,
             sr.asked_text, sr.requested_at, sr.address
        from sample_requests sr
        join conversations c on c.id = sr.conversation_id
        left join clients cl on cl.id = c.client_id
       where sr.business_id = ${bid.value}::uuid and sr.handled_at is null
       order by sr.requested_at asc limit 50`.execute(tx);
    return {
      policy,
      waiting: r.rows.map((x) => ({
        id: x.id, conversationId: x.conversation_id, buyer: x.buyer,
        askedText: x.asked_text, requestedAt: x.requested_at, address: x.address,
      })),
    };
  });
}

/** Stating a policy INSERTS: what she promised in March is still on the record. */
export async function saveSamplePolicy(
  db: Db, businessIdRaw: string,
  input: { price?: string | null; credited: boolean; now: Date },
): Promise<{ code: 'saved' | SamplePolicyError | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const v = validateSamplePolicy({
    price: input.price, creditedOnFirstOrder: input.credited,
    // One tenant currency today, named where the pair is assembled rather than
    // assumed at the row.
    currency: 'USD', now: input.now,
  });
  if (!v.ok) return { code: v.error };
  return withTenantTx(db, bid.value, async (tx) => {
    await sql`insert into sample_policy (business_id, price_amount, currency, credited_on_first_order, stated_at)
              values (${bid.value}::uuid, ${v.value.price.amount}, ${v.value.price.currency},
                      ${v.value.creditedOnFirstOrder}, ${v.value.statedAt})`.execute(tx);
    return { code: 'saved' as const };
  });
}

/** ── G6 · her terms on a proforma ──────────────────────────────────────── */

export type TermsView = { readonly terms: TradeTerms | null };

export async function loadTerms(db: Db, businessIdRaw: string): Promise<TermsView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { terms: null };
  return withTenantTx(db, bid.value, async (tx) =>
    ({ terms: await tenantRepos(tx, bid.value).catalog.tradeTerms() }));
}

/**
 * Stating terms INSERTS: what an order was confirmed under is still on the
 * record. And the delivery term she puts on her proformas is one her employee
 * may also SAY — the same decision, written where the claims guard reads it,
 * so a proforma saying FOB and a reply refused for saying FOB cannot coexist.
 */
export async function saveTerms(
  db: Db, businessIdRaw: string,
  input: { payment?: string | null; incoterm?: string | null; actor: string; now: Date },
): Promise<{ code: 'saved' | TradeTermsError | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const v = validateTradeTerms({ payment: input.payment ?? null, incoterm: input.incoterm ?? null, now: input.now });
  if (!v.ok) return { code: v.error };
  return withTenantTx(db, bid.value, async (tx) => {
    await sql`insert into trade_terms (business_id, payment_terms, incoterm, stated_at, stated_by)
              values (${bid.value}::uuid, ${v.value.paymentTerms}, ${v.value.incoterm},
                      ${v.value.statedAt}, ${input.actor})`.execute(tx);
    await sql`
      insert into claims_policy (business_id, kind, claim_key, allowed)
      values (${bid.value}, 'incoterm', ${v.value.incoterm}, true)
      on conflict (business_id, kind, claim_key) do update set allowed = true, updated_at = now()
    `.execute(tx);
    return { code: 'saved' as const };
  });
}

export function renderTerms(v: TermsView, locale: Locale, flash: string | null): string {
  const name = EMPLOYEE_NAME[locale];
  const stated = v.terms
    ? `<p class="stated-now"><bdi>${esc(v.terms.incoterm)}</bdi> · <bdi>${esc(v.terms.paymentTerms)}</bdi></p>
       <p class="muted">${esc(t(locale, 'terms.setOn', { date: formatDate(locale, v.terms.statedAt) }))}</p>`
    : `<p class="muted empty-p">${esc(t(locale, 'terms.none', { name }))}</p>`;
  const options = INCOTERM_KEYS.map((k) =>
    `<option value="${esc(k)}"${v.terms?.incoterm === k ? ' selected' : ''}>${esc(k)}</option>`).join('');
  return `<h1 class="page">${esc(t(locale, 'terms.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">
      <p class="muted">${esc(t(locale, 'terms.intro', { name }))}</p>
      ${stated}
      <form method="post" action="/app/settings/terms" class="pform">
        <label class="fld"><span class="muted">${esc(t(locale, 'terms.payment.label'))}</span>
          <input name="payment" required maxlength="${MAX_PAYMENT_TERMS}"
            placeholder="${esc(t(locale, 'terms.payment.placeholder'))}"
            value="${v.terms ? esc(v.terms.paymentTerms) : ''}" /></label>
        <label class="fld"><span class="muted">${esc(t(locale, 'terms.incoterm.label'))}</span>
          <select name="incoterm" required>
            ${v.terms ? '' : `<option value="" selected disabled></option>`}${options}
          </select>
          <span class="muted">${esc(t(locale, 'terms.incoterm.hint', { name }))}</span></label>
        <button class="btn send" type="submit">${esc(t(locale, 'terms.save'))}</button>
      </form>
    </section>`;
}

/** The address SHE captured. Never inferred from a message. */
export async function saveSampleAddress(
  db: Db, businessIdRaw: string, id: string, address: string,
): Promise<{ code: 'saved' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  const clean = address.trim();
  if (!clean) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update sample_requests set address = ${clean}
       where id = ${id}::uuid and business_id = ${bid.value}::uuid returning id`.execute(tx);
    return { code: r.rows[0] ? 'saved' as const : 'failed' as const };
  });
}

/** Dealt with. What that means is hers — this product does not model a courier. */
export async function markSampleHandled(
  db: Db, businessIdRaw: string, id: string, actor: string, now: Date,
): Promise<{ code: 'done' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update sample_requests set handled_at = ${now}, handled_by = ${actor}
       where id = ${id}::uuid and business_id = ${bid.value}::uuid and handled_at is null
      returning id`.execute(tx);
    return { code: r.rows[0] ? 'done' as const : 'failed' as const };
  });
}

export function renderSamples(v: SamplesView, locale: Locale, flash: string | null, now: Date): string {
  const name = EMPLOYEE_NAME[locale];
  const stated = v.policy
    ? `<p class="stated-now">${
        v.policy.price.amount === 0
          ? esc(t(locale, 'samples.current.free'))
          : esc(t(locale, 'samples.current.paid', { price: formatMoney(v.policy.price) }))
      } <span class="muted">${esc(t(locale, v.policy.creditedOnFirstOrder
        ? 'samples.current.credited' : 'samples.current.notCredited'))}</span></p>
      <p class="muted">${esc(t(locale, 'samples.setOn', { date: formatDate(locale, v.policy.statedAt) }))}</p>`
    : `<p class="muted empty-p">${esc(t(locale, 'samples.empty', { name }))}</p>`;

  const waiting = v.waiting.length === 0
    ? `<p class="muted empty-p">${esc(t(locale, 'samples.requests.empty'))}</p>`
    : `<ul class="sreqs">${v.waiting.map((r) => `<li>
        <div class="sreq-h"><b><bdi>${esc(r.buyer ?? t(locale, 'common.buyer'))}</bdi></b>
          <span class="muted">${esc(t(locale, 'samples.requests.asked', { when: formatRelative(locale, r.requestedAt, now) }))}</span></div>
        <div class="muted sreq-q"><bdi>${esc(r.askedText.slice(0, 160))}</bdi></div>
        <form method="post" action="/app/settings/samples/${esc(r.id)}/address" class="sreq-a">
          <label class="fld"><span class="muted">${esc(t(locale, 'samples.requests.address.label'))}</span>
            <textarea name="address" rows="2" placeholder="${esc(t(locale, 'samples.requests.address.placeholder'))}">${esc(r.address ?? '')}</textarea></label>
          <button class="btn" type="submit">${esc(t(locale, 'samples.requests.address.save'))}</button>
        </form>
        <div class="sreq-do">
          <a class="deeper" href="/app/inbox/${esc(r.conversationId)}">${esc(t(locale, 'samples.requests.open'))}<span class="go" aria-hidden="true">›</span></a>
          <form method="post" action="/app/settings/samples/${esc(r.id)}/handled" class="inline">
            <button class="btn" type="submit">${esc(t(locale, 'samples.requests.handled'))}</button>
          </form>
        </div>
      </li>`).join('')}</ul>`;

  return `<h1 class="page">${esc(t(locale, 'samples.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    <section class="block">
      <p class="muted">${esc(t(locale, 'samples.intro', { name }))}</p>
      ${stated}
      <form method="post" action="/app/settings/samples" class="pform">
        <label class="fld"><span class="muted">${esc(t(locale, 'samples.price.label'))}</span>
          <input name="price" inputmode="decimal" required
            value="${v.policy ? esc(String(v.policy.price.amount)) : ''}" /></label>
        <label class="chkbox"><input type="checkbox" name="credited" ${v.policy?.creditedOnFirstOrder ? 'checked' : ''} />
          ${esc(t(locale, 'samples.credited.label'))}</label>
        <button class="btn send" type="submit">${esc(t(locale, 'samples.save'))}</button>
      </form>
    </section>
    <section class="block">
      <h2>${esc(t(locale, 'samples.requests.title'))}</h2>
      ${waiting}
    </section>
    <style>
      .sreqs { list-style:none; margin:var(--space-12) 0 0; padding:0;
               display:flex; flex-direction:column; gap:var(--space-24); }
      .sreq-h { display:flex; align-items:baseline; gap:var(--space-8); flex-wrap:wrap; }
      .sreq-q { font-size:var(--font-size-note); margin-top:var(--space-4); max-width:var(--measure-prose); }
      .sreq-a { display:flex; flex-direction:column; gap:var(--space-8);
                margin-top:var(--space-8); max-width:var(--measure-form); }
      .sreq-a textarea { background:var(--color-paper-sunk); border:1px solid var(--color-border);
                border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; }
      .sreq-do { display:flex; align-items:center; gap:var(--space-16); flex-wrap:wrap; }
    </style>`;
}
