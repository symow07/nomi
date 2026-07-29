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

/** Pure validation. name is required; email/phone shapes; length caps; langs ⊆ {en,zh,ar}. */
export function validateProfile(input: ProfileInput): { ok: true; value: ProfileValue } | { ok: false } {
  const name = input.name.trim();
  if (name.length === 0 || name.length > CAP.name) return { ok: false };
  if (input.description.trim().length > CAP.description) return { ok: false };
  if (input.location.trim().length > CAP.location) return { ok: false };
  if (input.workingHours.trim().length > CAP.workingHours) return { ok: false };

  const email = input.contactEmail.trim();
  if (email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false };
  const phone = validateOwnerPhone(input.contactPhone);   // reuse: empty clears, else E.164-ish
  if (!phone.ok) return { ok: false };

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

export type ChecklistItem = { readonly label: MessageKey; readonly done: boolean };

export type BusinessProfile = {
  readonly name: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly workingHours: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly languagesServed: readonly string[];
  readonly categories: readonly string[];        // derived from products.category
  readonly checklist: readonly ChecklistItem[];
};

export async function loadBusinessProfile(db: Db, businessIdRaw: string): Promise<BusinessProfile> {
  const empty: BusinessProfile = {
    name: '', description: null, location: null, workingHours: null, contactEmail: null,
    contactPhone: null, languagesServed: [], categories: [], checklist: [],
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

    const checklist: ChecklistItem[] = [
      { label: 'settings.field.name', done: b.name.trim() !== '' },
      { label: 'settings.field.description', done: !!b.description },
      { label: 'settings.field.location', done: !!b.location },
      { label: 'settings.field.workingHours', done: !!b.working_hours },
      { label: 'settings.field.contactEmail', done: !!(b.contact_email || b.contact_phone) },
      { label: 'settings.field.categories', done: categories.length > 0 },
    ];

    return {
      name: b.name, description: b.description, location: b.location, workingHours: b.working_hours,
      contactEmail: b.contact_email, contactPhone: b.contact_phone,
      languagesServed: b.languages_served ?? [], categories, checklist,
    };
  });
}

const langsSql = (langs: readonly string[]) =>
  langs.length ? sql`array[${sql.join(langs.map((l) => sql`${l}`), sql`, `)}]::text[]` : sql`array[]::text[]`;

export async function saveBusinessProfile(db: Db, businessIdRaw: string, input: ProfileInput, actor: string): Promise<{ code: 'saved' | 'invalid' }> {
  const v = validateProfile(input);
  if (!v.ok) return { code: 'invalid' };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'invalid' };

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

export function renderSettings(p: BusinessProfile, locale: Locale, flash: string | null): string {
  const allDone = p.checklist.every((c) => c.done);
  const checklist = `<div class="card"><h2>${esc(t(locale, 'settings.checklist.title'))}</h2>
    ${allDone ? `<div class="ok-line">✓ ${esc(t(locale, 'settings.checklist.allSet'))}</div>` : ''}
    <ul class="chk">${p.checklist.map((c) =>
      `<li class="${c.done ? 'done' : ''}">${c.done ? '✓' : '○'} ${esc(t(locale, c.label))}</li>`).join('')}</ul>
  </div>`;

  const field = (id: string, label: MessageKey, value: string | null, ph = '') =>
    `<label class="fld"><span class="muted">${esc(t(locale, label))}</span>
      <input name="${id}" value="${esc(value ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''} /></label>`;

  const languages = `<div class="fld"><span class="muted">${esc(t(locale, 'settings.field.languages'))}</span>
    <div class="langs">${LOCALES.map((l) =>
      `<label class="chkbox"><input type="checkbox" name="lang_${l}"${p.languagesServed.includes(l) ? ' checked' : ''} /> ${esc(LOCALE_LABEL[l])}</label>`).join('')}</div></div>`;

  const form = `<div class="card"><h2>${esc(t(locale, 'settings.profile.title'))}</h2>
    <form method="post" action="/app/settings" class="pform">
      ${field('name', 'settings.field.name', p.name)}
      <label class="fld"><span class="muted">${esc(t(locale, 'settings.field.description'))}</span>
        <textarea name="description" rows="3">${esc(p.description ?? '')}</textarea></label>
      ${field('location', 'settings.field.location', p.location)}
      ${field('working_hours', 'settings.field.workingHours', p.workingHours, t(locale, 'settings.workingHours.ph'))}
      ${languages}
      ${field('contact_email', 'settings.field.contactEmail', p.contactEmail)}
      ${field('contact_phone', 'settings.field.contactPhone', p.contactPhone, t(locale, 'settings.alerts.placeholder'))}
      <button class="btn send" type="submit">${esc(t(locale, 'settings.alerts.save'))}</button>
    </form>
  </div>`;

  const categories = `<div class="card"><h2>${esc(t(locale, 'settings.field.categories'))}</h2>
    ${p.categories.length
      ? `<div class="cats">${p.categories.map((c) => `<span class="cat">${esc(c)}</span>`).join('')}</div>`
      : `<div class="muted empty">${esc(t(locale, 'settings.categories.empty'))}</div>`}
  </div>`;

  return `<h1 class="page">${esc(t(locale, 'settings.profile.title'))}</h1>
    ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
    ${checklist}${form}${categories}${SETTINGS_STYLE}`;
}

const SETTINGS_STYLE = `<style>
  .chk { list-style:none; padding:0; margin:0; } .chk li { padding:8px 0; border-bottom:1px solid #1c2026; font-size:14px; color:#8b929c; }
  .chk li:last-child { border-bottom:none; } .chk li.done { color:#4ade80; }
  .ok-line { color:#4ade80; font-weight:600; margin-bottom:10px; }
  .pform { display:flex; flex-direction:column; gap:14px; }
  .fld { display:flex; flex-direction:column; gap:6px; font-size:14px; }
  .pform input, .pform textarea { background:#0f1216; border:1px solid #2b313a; border-radius:10px; color:#fff; padding:10px 14px; font:inherit; resize:vertical; }
  .langs { display:flex; flex-wrap:wrap; gap:14px; padding-top:2px; }
  .chkbox { display:inline-flex; align-items:center; gap:6px; font-size:14px; color:#e6e8eb; }
  .cats { display:flex; flex-wrap:wrap; gap:8px; }
  .cat { background:#0f1216; border:1px solid #23272e; border-radius:999px; padding:5px 12px; font-size:13px; color:#b9c0c9; }
  .flash { background:#0f2e1c; color:#4ade80; border-radius:10px; padding:10px 14px; margin-bottom:14px; font-size:14px; }
  .empty { padding:10px 0; }
  .btn { padding:10px 18px; border:0; border-radius:9px; background:#2a313c; color:#fff; font-size:14px; font-weight:600; cursor:pointer; align-self:flex-start; }
  .btn.send { background:#2563eb; } .btn.send:hover { background:#1d4ed8; }
  input:focus-visible, textarea:focus-visible, button:focus-visible { outline:2px solid #60a5fa; outline-offset:2px; }
</style>`;
