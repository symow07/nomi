import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale, LOCALES, LOCALE_LABEL } from '../../core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../core/owner/i18n/messages.js';
import { validateOwnerPhone } from '../../pipeline/notify.js';
import { esc } from './layout.js';

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
    ${form}${categories}${SETTINGS_STYLE}`;
}

const SETTINGS_STYLE = `<style>
  .fielderr { color:var(--color-warn); font-size:var(--font-size-caption); }
  .fld.bad input, .fld.bad textarea { border-color:var(--color-warn-line); }
  .ok-line { color:var(--color-ok); font-weight:600; margin-bottom:10px; }
  .pform { display:flex; flex-direction:column; gap:14px; }
  .fld { display:flex; flex-direction:column; gap:6px; font-size:var(--font-size-note); }
  .pform input, .pform textarea { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:10px; color:var(--color-ink); padding:10px 14px; font:inherit; resize:vertical; }
  .langs { display:flex; flex-wrap:wrap; gap:14px; padding-top:2px; }
  .chkbox { display:inline-flex; align-items:center; gap:6px; font-size:var(--font-size-note); color:var(--color-ink); }
  .cats { display:flex; flex-wrap:wrap; gap:8px; }
  .cat { background:var(--color-paper-sunk); border:1px solid var(--color-border); border-radius:999px; padding:5px 12px; font-size:var(--font-size-caption); color:var(--color-ink-secondary); }
  
</style>`;
