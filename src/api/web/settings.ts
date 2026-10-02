import { zoneChoices, zoneLabel, isZone, ALL_ZONES } from '../../core/owner/zones.js';
import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { type Locale, LOCALES, LOCALE_LABEL, SERVED_LANGUAGES, SERVED_LABEL } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, tn, assistantName, setupState } from './say.js';
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
import { type Currency, parseCurrency } from '../../core/types/money.js';
import { currencyLabel, CURRENCY_CHOICES } from '../../core/owner/currencies.js';
import { currencyOf, hasPrices, ratePairOf } from '../../db/currency.js';

import { switcher, deeper, back, esc, conversationUrl } from './layout.js';
import { fieldRow, rowsCard, saveBar, cardActs, keptValue, keptError, keptInvalid, type Kept } from './rows.js';
import { flashBanner, type Flash } from './flash.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import * as show from './values.js';

/** Phase 4 — in place of a form only the owner may send: the values stay
 *  on the page to read, and this says whose decision they are. */
const ownerDecides = (locale: Locale): string =>
  `<p class="muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`;

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

  const langs = input.languagesServed.filter((l) => (SERVED_LANGUAGES as readonly string[]).includes(l));
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

/**
 * PHASE 3 OF THE UI REBUILD (2026-10-02) — Setup in labelled groups. Each
 * group is one card of rows; each row says what the setting is (its name and
 * one line under it), what it is set to now, and opens it. A search finds a
 * row by its name, its line or its value, in the owner's language, without
 * the script: the page is filtered on the server.
 *
 * The groups (my call, named by the owner as mine to decide): setting up;
 * your business; customers and alerts; people and sign-in; billing and data.
 * The language switch leads, the one thing here an owner looks for in a hurry.
 * "How it looks" — the components gallery — is a developer's page and is no
 * longer listed; its address still works for whoever builds the product.
 * Log out is the rail's, and here only on a phone.
 */
export type SetupView = {
  /** "What kind of business" as the owner last answered it; null = not yet. */
  readonly kind: string | null;
  /** How many people work here. */
  readonly people: number;
  /** HS — how many of How you sell's questions are answered; null for staff (the page is the owner's). */
  readonly howYouSell?: { readonly answered: number; readonly total: number } | null;
  /** Phase 3 — alerts on this person's phones: whether this installation can send them, and how many phones. */
  readonly alerts?: { readonly available: boolean; readonly phones: number } | null;
  /** Phase 3 — how this person signs in: their e-mail, or the access code when they have no login. */
  readonly signIn?: { readonly email: string | null } | null;
  /** Phase 3 — billing as it stands (the owner's); null for staff. */
  readonly billing?: { readonly configured: boolean; readonly exempt: boolean; readonly status: string } | null;
  /** Phase 3 — customers' deletion requests waiting for the owner; null for staff. */
  readonly dataWaiting?: number | null;
  /** The search, as typed. */
  readonly query?: string;
};

/**
 * Phase 4 — a value that is a STATE carries its signal (✓ done or on, ○ waits
 * for you, ✕ did not happen); a value that only names something (a kind, an
 * e-mail, a count of people) carries none.
 */
type SetupRow = { readonly href: string; readonly label: string; readonly desc: string; readonly value: string; readonly tone?: 'ok' | 'warn' | 'bad' | undefined };

/** Lower case, width-folded, so a search matches what is shown whatever way it was typed. */
const fold = (s: string): string => s.normalize('NFKC').toLocaleLowerCase();

export function renderSetup(v: SetupView, locale: Locale, flash: Flash | null): string {
  const setup = setupState();
  const step = (k: string): boolean | null => setup?.steps.find((x) => x.step === k)?.done ?? null;
  const state = (done: boolean | null, yes: MessageKey, no: MessageKey): string =>
    done === null ? '' : t(locale, done ? yes : no);
  const toneOf = (done: boolean | null): 'ok' | 'warn' | undefined => done === null ? undefined : done ? 'ok' : 'warn';
  const billingTone = !v.billing || !v.billing.configured ? undefined
    : v.billing.exempt || ['cardSaved', 'trial', 'active'].includes(v.billing.status) ? 'ok' as const
    : ['past_due', 'lapsed'].includes(v.billing.status) ? 'bad' as const : undefined;
  const ready = setup
    ? (setup.next === null ? t(locale, 'setup.state.done') : t(locale, 'nav.setup.progress', { done: setup.done, total: setup.total }))
    : '';
  const billing = v.billing
    ? (!v.billing.configured ? t(locale, 'setup.value.notSetUp')
      : v.billing.exempt ? t(locale, 'setup.value.billing.exempt')
      : (['none', 'cardSaved', 'trial', 'active', 'past_due', 'lapsed'] as const).includes(v.billing.status as never)
        ? t(locale, `setup.value.billing.${v.billing.status}` as MessageKey) : '')
    : '';
  const groups: readonly { readonly id: string; readonly title: string; readonly rows: readonly SetupRow[] }[] = [
    { id: 'start', title: t(locale, 'setup.group.start'), rows: [
      { href: '/app/guide', label: t(locale, 'guide.title'), desc: t(locale, 'setup.desc.guide'), value: ready,
        tone: setup ? toneOf(setup.next === null) : undefined },
      { href: '/app/onboarding', label: t(locale, 'nav.onboarding'), desc: t(locale, 'setup.desc.onboarding'),
        value: state(step('name'), 'setup.value.nameConfirmed', 'setup.value.nameNotConfirmed'), tone: toneOf(step('name')) },
    ] },
    { id: 'business', title: t(locale, 'setup.group.business'), rows: [
      { href: '/app/settings/profile', label: t(locale, 'settings.profile.title'), desc: t(locale, 'setup.desc.profile'),
        value: state(step('profile'), 'setup.state.done', 'setup.state.toDo'), tone: toneOf(step('profile')) },
      { href: '/app/settings/business', label: t(locale, 'business.kind.label'), desc: t(locale, 'setup.desc.kind'),
        value: v.kind ?? t(locale, 'setup.state.notAnswered') },
      ...(v.howYouSell ? [{ href: '/app/business/selling', label: t(locale, 'hs.title'), desc: t(locale, 'setup.desc.selling'),
        value: t(locale, 'hs.progress', { done: v.howYouSell.answered, total: v.howYouSell.total }) }] : []),
    ] },
    { id: 'reach', title: t(locale, 'setup.group.reach'), rows: [
      { href: '/app/channels', label: t(locale, 'nav.channels'), desc: t(locale, 'setup.desc.channels'),
        value: state(step('channels'), 'setup.state.connected', 'setup.state.notConnected'), tone: toneOf(step('channels')) },
      { href: '/app/settings/alerts', label: t(locale, 'alerts.phone.title'), desc: t(locale, 'setup.desc.alerts'),
        value: !v.alerts ? '' : !v.alerts.available ? t(locale, 'setup.value.unavailable')
          : v.alerts.phones === 0 ? t(locale, 'setup.value.off') : tn(locale, 'setup.value.phones', v.alerts.phones),
        tone: v.alerts?.available && v.alerts.phones > 0 ? 'ok' : undefined },
    ] },
    { id: 'people', title: t(locale, 'setup.group.people'), rows: [
      { href: '/app/settings/people', label: t(locale, 'people.title'), desc: t(locale, 'setup.desc.people'),
        value: tn(locale, 'setup.state.people', v.people) },
      { href: '/app/settings/account', label: t(locale, 'account.title'), desc: t(locale, 'setup.desc.account'),
        value: !v.signIn ? '' : v.signIn.email ?? t(locale, 'setup.value.accessCode') },
    ] },
    { id: 'account', title: t(locale, 'setup.group.account'), rows: [
      { href: '/app/settings/billing', label: t(locale, 'billing.title'), desc: t(locale, 'setup.desc.billing'), value: billing, tone: billingTone },
      { href: '/app/settings/data', label: t(locale, 'data.title'), desc: t(locale, 'setup.desc.data'),
        value: v.dataWaiting === null || v.dataWaiting === undefined ? ''
          : v.dataWaiting === 0 ? t(locale, 'setup.value.nothingWaiting') : tn(locale, 'setup.value.requests', v.dataWaiting),
        tone: v.dataWaiting ? 'warn' : undefined },
    ] },
  ];

  const q = (v.query ?? '').trim();
  const hit = (...words: string[]): boolean => q === '' || words.some((w) => fold(w).includes(fold(q)));
  const row = (r: SetupRow): string => `<li><a class="srow" href="${r.href}">
      <span class="sr-main"><span class="sr-label">${esc(r.label)}</span><span class="sr-desc">${esc(r.desc)}</span></span>
      ${r.value ? `<span class="sr-value${r.tone ? ` ${r.tone}` : ''}"><bdi>${esc(r.value)}</bdi></span>` : ''}<span class="go" aria-hidden="true">›</span></a></li>`;
  const shown = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => hit(g.title, r.label, r.desc, r.value)) })).filter((g) => g.rows.length > 0);
  const language = hit(t(locale, 'settings.language.title'))
    ? `<section class="sgroup" aria-labelledby="sg-language"><h2 class="sgroup-h" id="sg-language">${esc(t(locale, 'settings.language.title'))}</h2>
        <div class="scard"><div class="srow"><span class="sr-ctl">${switcher(locale, '/app/settings')}</span></div></div></section>` : '';
  const search = `<form class="search" method="get" action="/app/settings" role="search">
      <input type="search" name="q" value="${esc(q)}" placeholder="${esc(t(locale, 'setup.search.placeholder'))}" aria-label="${esc(t(locale, 'setup.search.label'))}" />
      <button class="btn" type="submit">${esc(t(locale, 'buyers.search.go'))}</button>
      ${q ? `<a class="clear" href="/app/settings">${esc(t(locale, 'buyers.search.clear'))}</a>` : ''}
    </form>`;
  const body = shown.length === 0 && !language
    ? `<div class="empty" role="status">${esc(t(locale, 'setup.search.none', { q }))}</div>`
    : `${language}${shown.map((g) => `<section class="sgroup" aria-labelledby="sg-${g.id}"><h2 class="sgroup-h" id="sg-${g.id}">${esc(g.title)}</h2>
        <ul class="scard">${g.rows.map(row).join('')}</ul></section>`).join('')}`;
  return `<h1 class="page">${esc(t(locale, 'nav.settings'))}</h1>
    ${flashBanner(flash)}
    ${search}
    ${body}
    <div class="block signout"><form method="post" action="/logout">
      <button class="btn ghost" type="submit">${esc(t(locale, 'header.logout'))}</button>
    </form></div>`;
}

/** The business profile, on its own page (it was inline among Setup's doors). */
/** TZ — the workspace's zone and the country its choices come from. */
export type ZoneChoice = { readonly zone: string; readonly country: string | null };

export async function loadZoneChoice(db: Db, businessIdRaw: string): Promise<ZoneChoice | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const r = (await sql<{ zone: string; country: string | null }>`
      select timezone as zone, country from businesses where id = ${bid.value}`.execute(tx)).rows[0];
    return r ? { zone: r.zone, country: r.country } : null;
  });
}

/** TZ — the owner's zone, changed. Any zone this build knows; the page offers the country's. */
export async function saveZone(db: Db, businessIdRaw: string, zone: string): Promise<'saved' | 'invalid'> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !isZone(zone)) return 'invalid';
  await withTenantTx(db, bid.value, (tx) => sql`update businesses set timezone = ${zone} where id = ${bid.value}`.execute(tx));
  return 'saved';
}

/** TZ — the zone, as a row of the profile's one form (phase 3: one save, not three). */
function zoneRow(c: ZoneChoice, locale: Locale): string {
  const choices = zoneChoices(c.country ?? '').length ? zoneChoices(c.country ?? '') : ALL_ZONES;
  const all = choices.includes(c.zone) ? choices : [c.zone, ...choices];
  return fieldRow({ label: t(locale, 'settings.zone.label'), forId: 'pf-zone', desc: t(locale, 'settings.zone.why'),
    control: `<select id="pf-zone" name="zone">${all.map((z) => `<option value="${esc(z)}"${z === c.zone ? ' selected' : ''}>${esc(zoneLabel(locale, z))}</option>`).join('')}</select>` });
}

/**
 * CUR — the workspace's one currency, and whether it can still change: only
 * until the first price is set (`hasPrices`). After that every figure in the
 * workspace is in it, and nothing converts.
 */
export type CurrencyChoice = { readonly currency: Currency; readonly fixed: boolean };

export async function loadCurrencyChoice(db: Db, businessIdRaw: string): Promise<CurrencyChoice | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) =>
    ({ currency: await currencyOf(tx, bid.value), fixed: await hasPrices(tx, bid.value) }));
}

/** CUR — the owner's currency, changed; refused once a price is set, in the same transaction that checks. */
export async function saveCurrency(db: Db, businessIdRaw: string, raw: string): Promise<'saved' | 'invalid' | 'fixed'> {
  const bid = parseBusinessId(businessIdRaw);
  const c = parseCurrency(raw.trim().toUpperCase());
  if (!bid.ok || !c) return 'invalid';
  return withTenantTx(db, bid.value, async (tx) => {
    // Held for the check and the write, so a price saved between them cannot
    // leave the workspace in two currencies.
    await sql`select 1 from businesses where id = ${bid.value} for update`.execute(tx);
    if ((await currencyOf(tx, bid.value)) === c) return 'saved' as const;
    if (await hasPrices(tx, bid.value)) return 'fixed' as const;
    await sql`update businesses set currency = ${c} where id = ${bid.value}`.execute(tx);
    return 'saved' as const;
  });
}

/** CUR — the currency, as a row of the profile's one form: a choice only for the owner, and only until the first price. */
function currencyRow(c: CurrencyChoice, locale: Locale, viewer: Viewer): string {
  if (c.fixed || !viewer.isOwner) {
    return fieldRow({ label: t(locale, 'settings.currency.label'),
      desc: t(locale, c.fixed ? 'settings.currency.fixed' : 'settings.currency.why'),
      control: `<span class="fr-value"><bdi>${esc(currencyLabel(locale, c.currency))}</bdi></span>${viewer.isOwner ? '' : ownerDecides(locale)}` });
  }
  return fieldRow({ label: t(locale, 'settings.currency.label'), forId: 'pf-currency', desc: t(locale, 'settings.currency.why'),
    control: `<select id="pf-currency" name="currency">${CURRENCY_CHOICES.map((x) => `<option value="${x}"${x === c.currency ? ' selected' : ''}>${esc(currencyLabel(locale, x))}</option>`).join('')}</select>` });
}

export function renderProfile(
  p: BusinessProfile, locale: Locale, flash: Flash | null,
  draft: ProfileDraft = {}, errors: ProfileErrors = {},
  zone: ZoneChoice | null = null,
  currency: CurrencyChoice | null = null,
  viewer: Viewer = OWNER_VIEW,
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
  const field = (id: string, label: MessageKey, f: ProfileField, stored: string | null, ph = '') => fieldRow({
    label: t(locale, label), forId: `pf-${id}`, error: errLine(f) || undefined,
    control: `<input id="pf-${id}" name="${id}" value="${esc(val(f, stored))}"${ph ? ` placeholder="${esc(ph)}"` : ''} />` });

  const languages = fieldRow({ label: t(locale, 'settings.field.languages'),
    control: `<div class="langs">${SERVED_LANGUAGES.map((l) =>
      `<label class="chkbox"><input type="checkbox" name="lang_${l}"${(draft.languagesServed ?? p.languagesServed).includes(l) ? ' checked' : ''} /> <bdi lang="${l}">${esc(SERVED_LABEL[l])}</bdi></label>`).join('')}</div>` });
  const description = fieldRow({ label: t(locale, 'settings.field.description'), forId: 'pf-description', error: errLine('description') || undefined,
    control: `<textarea id="pf-description" name="description" rows="3">${esc(val('description', p.description))}</textarea>` });
  // The categories the import found: what they are, as words — nothing to press.
  const categories = fieldRow({ label: t(locale, 'settings.field.categories'),
    control: `<span class="fr-value">${p.categories.length ? p.categories.map((c) => `<bdi>${esc(c)}</bdi>`).join(' · ')
      : `<span class="muted">${esc(t(locale, 'settings.categories.empty'))}</span>`}</span>` });

  // Phase 3 — ONE form, ONE save: the profile, the zone and the currency
  // were three forms with a Save each; the route saves all three.
  const form = `<form method="post" action="/app/settings" class="sform">
    ${rowsCard(t(locale, 'profile.group.business'), [
      field('name', 'settings.field.name', 'name', p.name), description,
      field('location', 'settings.field.location', 'location', p.location),
      field('working_hours', 'settings.field.workingHours', 'workingHours', p.workingHours, t(locale, 'settings.workingHours.ph')),
      languages,
    ])}
    ${rowsCard(t(locale, 'profile.group.contact'), [
      field('contact_email', 'settings.field.contactEmail', 'contactEmail', p.contactEmail),
      field('contact_phone', 'settings.field.contactPhone', 'contactPhone', p.contactPhone, t(locale, 'settings.alerts.placeholder')),
    ])}
    ${rowsCard(t(locale, 'profile.group.zone'), [
      ...(zone ? [zoneRow(zone, locale)] : []), ...(currency ? [currencyRow(currency, locale, viewer)] : []), categories,
    ], 'zone')}
    ${saveBar(t(locale, 'settings.alerts.save'))}
  </form>`;

  return `${back('/app/settings', t(locale, 'nav.settings'))}
    <h1 class="page">${esc(t(locale, 'settings.profile.title'))}</h1>
    ${flashBanner(flash)}
    ${form}`;
}


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

/**
 * Phase 5 — Undo: a removed word is back on the list, unless the same word was
 * added again since (one live entry per word, 0029's index).
 */
export async function restoreForbidden(
  db: Db, businessIdRaw: string, id: string,
): Promise<{ code: 'restored' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update forbidden_terms f set archived_at = null
       where f.id = ${id}::uuid and f.business_id = ${bid.value}::uuid and f.archived_at is not null
         and not exists (select 1 from forbidden_terms o
                          where o.business_id = f.business_id and o.archived_at is null
                            and lower(btrim(o.term)) = lower(btrim(f.term)))
      returning f.id`.execute(tx);
    return { code: r.rows[0] ? 'restored' as const : 'failed' as const };
  });
}

export function renderForbidden(v: ForbiddenView, locale: Locale, flash: Flash | null, kept: Kept | null = null): string {
  const name = assistantName(locale);
  return `<h1 class="page">${esc(t(locale, 'forbidden.title', { name }))}</h1>
    ${flashBanner(flash)}
    <p class="lede muted">${esc(t(locale, 'forbidden.intro', { name }))}</p>
    <form method="post" action="/app/settings/forbidden">
      ${rowsCard(null, [
        fieldRow({ label: t(locale, 'forbidden.add.label'), forId: 'fb-term', error: keptError(kept, 'term', 'fb-term-err'),
          control: `<input id="fb-term" name="term" required maxlength="80" placeholder="${esc(t(locale, 'forbidden.add.placeholder'))}" value="${keptValue(kept, 'term')}"${keptInvalid(kept, 'term', 'fb-term-err')} />` }),
        fieldRow({ label: t(locale, 'forbidden.add.note'), forId: 'fb-note',
          control: `<input id="fb-note" name="note" maxlength="${MAX_FORBIDDEN_NOTE}" placeholder="${esc(t(locale, 'forbidden.add.notePlaceholder'))}" value="${keptValue(kept, 'note')}" />` }),
        cardActs(`<button class="btn send" type="submit">${esc(t(locale, 'forbidden.add.button'))}</button>`),
      ])}
    </form>
    ${v.own.length === 0
      ? `<div class="empty">${esc(t(locale, 'forbidden.empty'))}</div>`
      : rowsCard(null, v.own.map((x) => fieldRow({ label: x.term,
          control: `${x.note ? `<span class="fr-value muted"><bdi>${esc(x.note)}</bdi></span>` : ''}<form method="post" action="/app/settings/forbidden/${esc(x.id)}/remove" class="inline">
              <button class="btn" type="submit">${esc(t(locale, 'forbidden.remove'))}</button>
            </form>` })))}
    ${/* Phase 3 — the floor is a fact, not the page: folded, with its count, the words inside for whoever opens it. */ ''}<details class="block floor-fold">
      <summary><b>${esc(t(locale, 'forbidden.floor.title'))}</b> <span class="muted">· <bdi>${esc(show.count(locale, v.floor.length))}</bdi></span></summary>
      <p class="muted">${esc(t(locale, 'forbidden.floor.body', { name }))}</p>
      <ul class="fterms floor">${v.floor.map((x) => `<li><bdi>${esc(x)}</bdi></li>`).join('')}</ul>
    </details>`;
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
  /**
   * CUR — what converts into what: the currency the workspace sells in, into
   * the one its country counts in (`ratePairOf`). It was dollars into ￥ for
   * everyone. Null when the two are the same, or the country's is not on the
   * list: then there is nothing to convert, and no rate to set.
   */
  readonly pair: { readonly from: Currency; readonly to: Currency } | null;
  /** The workspace's one currency, for the sentence that says there is nothing to convert. */
  readonly currency: Currency;
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
  const pair = await ratePairOf(tx, businessId);
  if (!pair) return null;
  const r = await sql<{ from_currency: string; to_currency: string; rate: string; stated_at: Date }>`
    select from_currency, to_currency, rate, stated_at from owner_rates
     where business_id = ${businessId}::uuid and from_currency = ${pair.from} and to_currency = ${pair.to}
     order by stated_at desc limit 1`.execute(tx);
  return r.rows[0] ? toRate(r.rows[0]) : null;
}

export async function loadRates(db: Db, businessIdRaw: string): Promise<RateView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { current: null, previous: [], pair: null, currency: 'USD' };
  return withTenantTx(db, bid.value, async (tx) => {
    const pair = await ratePairOf(tx, bid.value);
    const currency = await currencyOf(tx, bid.value);
    if (!pair) return { current: null, previous: [], pair: null, currency };
    const r = await sql<{ from_currency: string; to_currency: string; rate: string; stated_at: Date }>`
      select from_currency, to_currency, rate, stated_at from owner_rates
       where business_id = ${bid.value}::uuid and from_currency = ${pair.from} and to_currency = ${pair.to}
       order by stated_at desc limit 20`.execute(tx);
    const all = r.rows.map(toRate).filter((x): x is OwnerRate => x !== null);
    return { current: all[0] ?? null, previous: all.slice(1), pair, currency };
  });
}

/** Stating a rate INSERTS. It never updates: a quote given in March was
 *  converted at March's rate, and the row that did it stays to say so. */
export async function setRate(
  db: Db, businessIdRaw: string, raw: string | null | undefined, now: Date,
): Promise<{ code: 'set'; rate: OwnerRate } | { code: RateError | 'failed' | 'none' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    // CUR — the workspace's own pair, or nothing to convert.
    const pair = await ratePairOf(tx, bid.value);
    if (!pair) return { code: 'none' as const };
    const v = validateRate({ from: pair.from, to: pair.to, rate: raw, now });
    if (!v.ok) return { code: v.error };
    await sql`insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at)
              values (${bid.value}::uuid, ${pair.from}, ${pair.to}, ${v.value.rate}, ${v.value.statedAt})`.execute(tx);
    return { code: 'set' as const, rate: v.value };
  });
}

export function renderRate(v: RateView, locale: Locale, flash: Flash | null, viewer: Viewer = OWNER_VIEW, kept: Kept | null = null): string {
  const name = assistantName(locale);
  if (!v.pair) {
    return `<h1 class="page">${esc(t(locale, 'rate.title'))}</h1>
    ${flashBanner(flash)}
    <section class="block"><p class="muted">${esc(t(locale, 'rate.none', { from: v.currency }))}</p></section>`;
  }
  const { from, to } = v.pair;
  const stated = (r: OwnerRate): string =>
    `${esc(t(locale, 'rate.current', { rate: r.rate, from: r.from, to: r.to }))} <span class="muted">· ${esc(t(locale, 'rate.setOn', { date: show.date(locale, r.statedAt) }))}</span>`;
  return `<h1 class="page">${esc(t(locale, 'rate.title'))}</h1>
    ${flashBanner(flash)}
    <section class="block">
      <p class="muted">${esc(t(locale, 'rate.intro', { name, from, to }))}</p>
      ${v.current
        ? `<p class="stated-now"><bdi>${stated(v.current)}</bdi></p>`
        : `<div class="empty">${esc(t(locale, 'rate.empty', { to }))}</div>`}
      ${viewer.isOwner ? `<form method="post" action="/app/settings/rate" class="sform">
        ${rowsCard(null, [fieldRow({ label: t(locale, 'rate.add.label', { from, to }), forId: 'rt-rate', error: keptError(kept, 'rate', 'rt-rate-err'),
          control: `<input id="rt-rate" name="rate" inputmode="decimal" required value="${keptValue(kept, 'rate')}"${keptInvalid(kept, 'rate', 'rt-rate-err')} />` })])}
        ${saveBar(t(locale, 'rate.add.button'))}
      </form>` : ownerDecides(locale)}
    </section>
    ${v.previous.length
      ? `<section class="block"><h2>${esc(t(locale, 'rate.history.title'))}</h2>
         <ul class="rate-hist">${v.previous.map((r) => `<li><bdi>${stated(r)}</bdi></li>`).join('')}</ul>
         </section>`
      : ''}`;
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

/** Phase 5 — Undo: a removed closure is on the calendar of shut days again. */
export async function restoreClosure(
  db: Db, businessIdRaw: string, id: string,
): Promise<{ code: 'restored' | 'failed' }> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'failed' };
  return withTenantTx(db, bid.value, async (tx) => {
    const r = await sql<{ id: string }>`
      update factory_closures set archived_at = null
       where id = ${id}::uuid and business_id = ${bid.value}::uuid and archived_at is not null
      returning id`.execute(tx);
    return { code: r.rows[0] ? 'restored' as const : 'failed' as const };
  });
}

export function renderClosures(v: ClosureView, locale: Locale, flash: Flash | null, kept: Kept | null = null): string {
  const name = assistantName(locale);
  const range = (c: FactoryClosure) =>
    t(locale, 'closures.range', { from: show.date(locale, c.from), to: show.date(locale, c.to) });
  return `<h1 class="page">${esc(t(locale, 'closures.title'))}</h1>
    ${flashBanner(flash)}
    <section class="block">
      <p class="muted">${esc(t(locale, 'closures.intro', { name }))}</p>
      <form method="post" action="/app/settings/closures">
        ${rowsCard(null, [
          fieldRow({ label: t(locale, 'closures.add.label'), forId: 'cl-label', desc: t(locale, 'closures.add.shown'), error: keptError(kept, 'label', 'cl-label-err'),
            control: `<input id="cl-label" name="label" required maxlength="80" placeholder="${esc(t(locale, 'closures.add.placeholder'))}" value="${keptValue(kept, 'label')}"${keptInvalid(kept, 'label', 'cl-label-err')} />` }),
          fieldRow({ label: t(locale, 'closures.add.from'), forId: 'cl-from', error: keptError(kept, 'from', 'cl-from-err'),
            control: `<input id="cl-from" name="from" type="date" required value="${keptValue(kept, 'from')}"${keptInvalid(kept, 'from', 'cl-from-err')} />` }),
          fieldRow({ label: t(locale, 'closures.add.to'), forId: 'cl-to', error: keptError(kept, 'to', 'cl-to-err'),
            control: `<input id="cl-to" name="to" type="date" required value="${keptValue(kept, 'to')}"${keptInvalid(kept, 'to', 'cl-to-err')} />` }),
          cardActs(`<button class="btn send" type="submit">${esc(t(locale, 'closures.add.button'))}</button>`),
        ])}
      </form>
      ${v.closures.length === 0
        ? `<div class="empty">${esc(t(locale, 'closures.empty', { name }))}</div>`
        : `<ul class="closures">${v.closures.map((c) => `<li>
            <span><bdi>${esc(c.label)}</bdi> <span class="muted">${esc(range(c))}</span></span>
            <form method="post" action="/app/settings/closures/${esc(c.id)}/remove" class="inline">
              <button class="btn" type="submit">${esc(t(locale, 'closures.remove'))}</button>
            </form></li>`).join('')}</ul>`}
    </section>`;
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
  return withTenantTx(db, bid.value, async (tx) => {
    // CUR — the workspace's one currency, named where the pair is assembled
    // (it was 'USD' here, "one tenant currency today").
    const v = validateSamplePolicy({
      price: input.price, creditedOnFirstOrder: input.credited,
      currency: await currencyOf(tx, bid.value), now: input.now,
    });
    if (!v.ok) return { code: v.error };
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

export function renderTerms(v: TermsView, locale: Locale, flash: Flash | null, viewer: Viewer = OWNER_VIEW, kept: Kept | null = null): string {
  const name = assistantName(locale);
  const stated = v.terms
    ? `<p class="stated-now"><bdi>${esc(v.terms.incoterm)}</bdi> · <bdi>${esc(v.terms.paymentTerms)}</bdi></p>
       <p class="muted">${esc(t(locale, 'terms.setOn', { date: show.date(locale, v.terms.statedAt) }))}</p>`
    : `<div class="empty">${esc(t(locale, 'terms.none', { name }))}</div>`;
  const options = INCOTERM_KEYS.map((k) =>
    `<option value="${esc(k)}"${v.terms?.incoterm === k ? ' selected' : ''}>${esc(k)}</option>`).join('');
  return `<h1 class="page">${esc(t(locale, 'terms.title'))}</h1>
    ${flashBanner(flash)}
    <section class="block">
      <p class="muted">${esc(t(locale, 'terms.intro', { name }))}</p>
      ${stated}
      ${viewer.isOwner ? `<form method="post" action="/app/settings/terms" class="sform">
        ${rowsCard(null, [
          fieldRow({ label: t(locale, 'terms.payment.label'), forId: 'tm-payment', error: keptError(kept, 'payment', 'tm-payment-err'),
            control: `<input id="tm-payment" name="payment" required maxlength="${MAX_PAYMENT_TERMS}"
              placeholder="${esc(t(locale, 'terms.payment.placeholder'))}" value="${kept ? keptValue(kept, 'payment') : v.terms ? esc(v.terms.paymentTerms) : ''}"${keptInvalid(kept, 'payment', 'tm-payment-err')} />` }),
          fieldRow({ label: t(locale, 'terms.incoterm.label'), forId: 'tm-incoterm', desc: t(locale, 'terms.incoterm.hint', { name }), error: keptError(kept, 'incoterm', 'tm-incoterm-err'),
            control: `<select id="tm-incoterm" name="incoterm" required${keptInvalid(kept, 'incoterm', 'tm-incoterm-err')}>${v.terms ? '' : '<option value="" selected disabled></option>'}${options}</select>` }),
        ])}
        ${saveBar(t(locale, 'terms.save'))}
      </form>` : ownerDecides(locale)}
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

export function renderSamples(
  v: SamplesView, locale: Locale, flash: Flash | null, now: Date, viewer: Viewer = OWNER_VIEW, kept: Kept | null = null,
): string {
  const name = assistantName(locale);
  const stated = v.policy
    ? `<p class="stated-now">${
        v.policy.price.amount === 0
          ? esc(t(locale, 'samples.current.free'))
          : esc(t(locale, 'samples.current.paid', { price: show.money(locale, v.policy.price) }))
      } <span class="muted">${esc(t(locale, v.policy.creditedOnFirstOrder
        ? 'samples.current.credited' : 'samples.current.notCredited'))}</span></p>
      <p class="muted">${esc(t(locale, 'samples.setOn', { date: show.date(locale, v.policy.statedAt) }))}</p>`
    : `<div class="empty">${esc(t(locale, 'samples.empty', { name }))}</div>`;

  const waiting = v.waiting.length === 0
    ? `<div class="empty">${esc(t(locale, 'samples.requests.empty'))}</div>`
    : `<ul class="sreqs">${v.waiting.map((r) => `<li>
        <div class="sreq-h"><b><bdi>${esc(r.buyer ?? t(locale, 'common.buyer'))}</bdi></b>
          <span class="muted">${esc(t(locale, 'samples.requests.asked', { when: show.when(locale, r.requestedAt, now) }))}</span></div>
        <div class="muted sreq-q"><bdi>${esc(r.askedText.slice(0, 160))}</bdi></div>
        <form method="post" action="/app/settings/samples/${esc(r.id)}/address" class="sreq-a">
          <label class="fld"><span class="muted">${esc(t(locale, 'samples.requests.address.label'))}</span>
            <textarea name="address" rows="2" placeholder="${esc(t(locale, 'samples.requests.address.placeholder'))}">${esc(r.address ?? '')}</textarea></label>
          <button class="btn" type="submit">${esc(t(locale, 'samples.requests.address.save'))}</button>
        </form>
        <div class="sreq-do">
          ${deeper(conversationUrl(r.conversationId), t(locale, 'samples.requests.open'))}
          <form method="post" action="/app/settings/samples/${esc(r.id)}/handled" class="inline">
            <button class="btn" type="submit">${esc(t(locale, 'samples.requests.handled'))}</button>
          </form>
        </div>
      </li>`).join('')}</ul>`;

  return `<h1 class="page">${esc(t(locale, 'samples.title'))}</h1>
    ${flashBanner(flash)}
    <section class="block">
      <p class="muted">${esc(t(locale, 'samples.intro', { name }))}</p>
      ${stated}
      ${viewer.isOwner ? `<form method="post" action="/app/settings/samples" class="sform">
        ${rowsCard(null, [
          fieldRow({ label: t(locale, 'samples.price.label'), forId: 'sm-price', error: keptError(kept, 'price', 'sm-price-err'),
            control: `<input id="sm-price" name="price" inputmode="decimal" required value="${kept ? keptValue(kept, 'price') : v.policy ? esc(String(v.policy.price.amount)) : ''}"${keptInvalid(kept, 'price', 'sm-price-err')} />` }),
          fieldRow({ label: t(locale, 'samples.credited.label'), forId: 'sm-credited',
            control: `<input id="sm-credited" type="checkbox" name="credited" ${v.policy?.creditedOnFirstOrder ? 'checked' : ''} />` }),
        ])}
        ${saveBar(t(locale, 'samples.save'))}
      </form>` : ownerDecides(locale)}
    </section>
    <section class="block">
      <h2>${esc(t(locale, 'samples.requests.title'))}</h2>
      ${waiting}
    </section>`;
}
