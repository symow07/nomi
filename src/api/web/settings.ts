import { settingsHref } from './settingsNavigation.js';
import { zoneChoices, zoneLabel, zoneLabelsAmong, zonePlace, zoneKept, zoneCity, zonesKeptApart, countryOfZone, regionOf, isZone, ALL_ZONES, SHOP_ZONES, ZONE_GROUPS } from '../../core/owner/zones.js';
import { sql } from 'kysely';
import { withTenantTx, type Db, type Tx } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import { type Locale, LOCALES, LOCALE_LABEL, SERVED_LANGUAGES, SERVED_LABEL } from '../../core/owner/i18n/locale.js';
import { type MessageKey, countryName } from '../../core/owner/i18n/messages.js';
import { datePartOrder, monthNames } from '../../core/owner/i18n/format.js';
import { t, tn, assistantName, setupState, businessName } from './say.js';
import { icon, type IconId, GO } from './icons.js';
import { validateOwnerPhone } from '../../pipeline/notify.js';
import { FORBIDDEN_FLOOR, FLOOR_BY_LANGUAGE } from '../../core/safety/forbiddenWords.js';
import { type OwnerRate, type RateError, validateRate } from '../../core/commerce/exchange.js';
import { type FactoryClosure, type ClosureError, validateClosure, closureDate } from '../../core/commerce/closures.js';
import { type SamplePolicy, type SamplePolicyError, validateSamplePolicy } from '../../core/commerce/samples.js';
import {
  type TradeTerms, type TradeTermsError, validateTradeTerms, MAX_PAYMENT_TERMS,
} from '../../core/commerce/terms.js';
import { INCOTERM_KEYS, isProductCategory, type ProductCategory } from '../../core/safety/claims.js';
import { questionsFor } from '../../core/owner/howYouSell.js';
import { profileOf } from '../../core/owner/sellingStyle.js';
import { tenantRepos } from '../../db/repos.js';
import { type Currency, isZero, parseCurrency } from '../../core/types/money.js';
import { decimal } from '../../core/types/decimal.js';
import { currencyLabel, currencyInLine, CURRENCY_CHOICES } from '../../core/owner/currencies.js';
import { currencyOf, hasPrices, ratePairOf } from '../../db/currency.js';

import { switcher, deeper, back, esc, conversationUrl, ASSISTANT_HOME } from './layout.js';
import { agentMark } from './agentMark.js';
import { fieldRow, rowsCard, cardActs, keptValue, keptError, keptInvalid, type Kept } from './rows.js';
import { pageHead, setSection, setRow, setNotice, saveForm, saveActs, rowAction, searchList, listRow } from './settingsPage.js';
import { businessKindRows, type BusinessKindView } from './businessKind.js';
import { flashBanner, type Flash } from './flash.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { validateIdentifiers, keepsMoroccanBooks, ICE_POSITIONS, type Identifiers, type IdentifiersInput, type IdentifierField, type IdentifierError } from '../../core/books/identifiers.js';
import * as show from './values.js';

/**
 * Phase 7 — My business › How you sell: the menu the terms, samples, closures
 * and rate pages are opened from, and lead back to (factory.ts names it
 * `BUSINESS_SCREEN_PATH.how`; written out here, as factory.ts reads this file).
 */
const HOW_YOU_SELL = '/app/business/how-you-sell';
import { alertWayName } from './phoneAlerts.js';

/** Phase 4 — in place of a form only the owner may send: the values stay
 *  on the page to read, and this says whose decision they are. */
const ownerDecides = (locale: Locale): string =>
  `<p class="muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`;

/**
 * M11.1 — Business Profile & Owner Settings. A VIEW + edit over the EXISTING
 * businesses row (no second business model). Field labels localize via t();
 * the VALUES are business data, stored verbatim, never translated. Working
 * hours are free text; languages_served is informational (no behavior gating).
 *
 * The warmth run, phase 9 (V1-006, V1-525, w4-settings-b-outreach-07) — what
 * the business sells is the one category the owner sets: How you sell's
 * "What do you sell" (`businesses.product_category`), named in the owner's
 * language, with the door to that question. The page used to list
 * `products.category`, which only the demo's seed ever wrote — raw English
 * codes no page shows or edits — under a line sending the owner to a product
 * page that has no category.
 */

export type ProfileInput = {
  readonly name: string; readonly description: string; readonly location: string;
  readonly workingHours: string; readonly contactEmail: string; readonly contactPhone: string;
  readonly languagesServed: readonly string[];
  /**
   * 0133 — the business's postal address, for the footer of every first e-mail and follow-up. Absent (a form that
   * does not carry the field, such as one from before it): left as it is, never cleared by omission.
   */
  readonly postalAddress?: string;
};

type ProfileValue = {
  readonly name: string; readonly description: string | null; readonly location: string | null;
  readonly workingHours: string | null; readonly contactEmail: string | null;
  readonly contactPhone: string | null; readonly languagesServed: readonly string[];
  /** Absent: unchanged. */
  readonly postalAddress?: string | null;
};

const CAP = { name: 200, location: 200, workingHours: 200, description: 1000, postalAddress: 400 };
const nz = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * M20.4 (F-07) — which field, and why. The old validator returned a bare
 * `{ok:false}`, so the route could only say "check what you entered" and then
 * re-render from the DATABASE — discarding everything the owner had typed. A
 * Chinese landline without a leading "+" therefore silently threw away the
 * description, location, hours, e-mail and languages alongside it.
 */
export type ProfileField = 'name' | 'description' | 'location' | 'workingHours' | 'contactEmail' | 'contactPhone' | 'postalAddress';
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
  if (input.postalAddress !== undefined && input.postalAddress.trim().length > CAP.postalAddress) errors.postalAddress = 'tooLong';

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
      ...(input.postalAddress !== undefined ? { postalAddress: nz(input.postalAddress) } : {}),
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
  /** 0133 — the postal address every first e-mail and follow-up carries; null: none yet, and none is sent. */
  readonly postalAddress?: string | null;
  /** 0068 — whether the business writes first at all: the postal address is marked as needed only then. */
  readonly outreachArea?: boolean;
  /**
   * What the business sells, as How you sell asks it (`product_category`):
   * `category` null until answered. Absent where How you sell does not ask it
   * (a business with no catalogue), so the page draws no row for it.
   */
  readonly whatYouSell?: { readonly category: ProductCategory | null } | null;
  /**
   * E2 (0206) — the business's own ICE, IF and RC with its court, as its books and its FEC carry them. Asked of a
   * business in Morocco, and shown wherever one is held. Absent where neither.
   */
  readonly identifiers?: Identifiers | null;
};

/** How you sell's question about what the business sells (HS_BASE in howYouSell.ts, which reads this file). */
const WHAT_YOU_SELL = '/app/business/selling/product_claims';

export async function loadBusinessProfile(db: Db, businessIdRaw: string): Promise<BusinessProfile> {
  const empty: BusinessProfile = {
    name: '', description: null, location: null, workingHours: null, contactEmail: null,
    contactPhone: null, languagesServed: [], whatYouSell: null,
  };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return empty;

  return withTenantTx(db, bid.value, async (tx) => {
    const b = (await sql<{
      name: string; description: string | null; location: string | null; working_hours: string | null;
      contact_email: string | null; contact_phone: string | null; languages_served: string[] | null;
      kind: string | null; prices_to_owner: boolean | null; product_category: string | null;
      postal_address: string | null; outreach_area: boolean | null;
      country: string | null; legal_ice: string | null; legal_if: string | null; legal_rc: string | null; legal_rc_court: string | null;
    }>`select name, description, location, working_hours, contact_email, contact_phone, languages_served,
              kind, prices_to_owner, product_category, postal_address, outreach_area,
              country, legal_ice, legal_if, legal_rc, legal_rc_court
         from businesses where id = ${bid.value}`.execute(tx)).rows[0] ?? null;
    if (!b) return empty;

    // Asked only of a business with a catalogue (How you sell's own rule, `questionsFor`).
    const asked = questionsFor(profileOf(b.kind), b.prices_to_owner ?? false).includes('product_claims');
    return {
      name: b.name, description: b.description, location: b.location, workingHours: b.working_hours,
      contactEmail: b.contact_email, contactPhone: b.contact_phone,
      languagesServed: b.languages_served ?? [],
      postalAddress: b.postal_address, outreachArea: b.outreach_area === true,
      whatYouSell: asked ? { category: b.product_category && isProductCategory(b.product_category) ? b.product_category : null } : null,
      identifiers: keepsMoroccanBooks({ country: b.country, ice: b.legal_ice, taxId: b.legal_if, rc: b.legal_rc })
        ? { ice: b.legal_ice, taxId: b.legal_if, rc: b.legal_rc, rcCourt: b.legal_rc_court } : null,
    };
  });
}

/**
 * E2 (0206) — the business's identifiers saved: validated where an official source sets a rule (src/core/books/
 * identifiers.ts), the names of the fields that changed written to the audit, never their values.
 */
export async function saveIdentifiers(
  db: Db, businessIdRaw: string, input: IdentifiersInput, actor: string,
): Promise<{ code: 'saved' } | { code: 'invalid'; errors: Partial<Record<IdentifierField, IdentifierError>> }> {
  const v = validateIdentifiers(input);
  if (!v.ok) return { code: 'invalid', errors: v.errors };
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { code: 'invalid', errors: {} };
  await withTenantTx(db, bid.value, async (tx) => {
    const cur = (await sql<{ legal_ice: string | null; legal_if: string | null; legal_rc: string | null; legal_rc_court: string | null }>`
      select legal_ice, legal_if, legal_rc, legal_rc_court from businesses where id = ${bid.value}`.execute(tx)).rows[0];
    await sql`update businesses set legal_ice = ${v.value.ice}, legal_if = ${v.value.taxId}, legal_rc = ${v.value.rc}, legal_rc_court = ${v.value.rcCourt}
      where id = ${bid.value}`.execute(tx);
    const changed = cur ? ([['legal_ice', cur.legal_ice, v.value.ice], ['legal_if', cur.legal_if, v.value.taxId], ['legal_rc', cur.legal_rc, v.value.rc],
      ['legal_rc_court', cur.legal_rc_court, v.value.rcCourt]] as const).filter(([, a, b]) => (a ?? '') !== (b ?? '')).map(([k]) => k) : [];
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
      values (${bid.value}, null, 'update_profile', ${actor}, ${JSON.stringify({ fields: changed })}::jsonb)`.execute(tx);
  });
  return { code: 'saved' };
}

/**
 * E2 — the identifiers, as a section of the profile's one form (rule 104): the owner's (`business_identifiers`);
 * anyone else sees the values and that the owner decides. What was typed stays in the form when a field is refused.
 */
function identifiersSection(
  ids: Identifiers, locale: Locale, viewer: Viewer,
  draft: IdentifiersInput | null, errors: Partial<Record<IdentifierField, IdentifierError>>,
): string {
  const rows: [IdentifierField, string, MessageKey, MessageKey | null][] = [
    ['ice', 'ice', 'settings.ids.ice', 'settings.ids.iceWhy'],
    ['taxId', 'tax_id', 'settings.ids.if', 'settings.ids.ifWhy'],
    ['rc', 'rc', 'settings.ids.rc', 'settings.ids.rcWhy'],
    ['rcCourt', 'rc_court', 'settings.ids.rcCourt', null],
  ];
  const stored = (f: IdentifierField) => ids[f] ?? '';
  if (!viewer.isOwner) {
    return setSection({ id: 'identifiers', title: t(locale, 'settings.ids.title'), rows: [
      ...rows.map(([f, , label]) => fieldRow({ label: t(locale, label),
        control: `<span class="fr-value">${stored(f) ? `<bdi dir="ltr">${esc(stored(f))}</bdi>` : `<span class="muted">${esc(t(locale, 'settings.ids.none'))}</span>`}</span>` })),
      ownerDecides(locale)] });
  }
  const err = (f: IdentifierField) => {
    const e = errors[f];
    return e ? `<span class="fielderr" role="alert" id="ids-${f}-err">${esc(t(locale, `settings.ids.err.${e}` as MessageKey, { n: ICE_POSITIONS }))}</span>` : undefined;
  };
  return setSection({ id: 'identifiers', title: t(locale, 'settings.ids.title'), help: t(locale, 'settings.ids.sources'),
    rows: rows.map(([f, name, label, why]) => fieldRow({ label: t(locale, label), forId: `ids-${name}`, error: err(f),
      ...(why ? { desc: t(locale, why) } : {}),
      control: `<input id="ids-${name}" name="${name}" dir="ltr" value="${esc(draft ? draft[f] : stored(f))}"${errors[f] ? ` aria-invalid="true" aria-describedby="ids-${f}-err"` : ''} />` })) });
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
      postal_address: string | null;
    }>`select name, description, location, working_hours, contact_email, contact_phone, languages_served, postal_address
         from businesses where id = ${bid.value}`.execute(tx)).rows[0];

    // 0160 (the owner, on PR 344) — a list the owner CHANGED is theirs from then on: setting up asks for product names
    // in its languages. The default list nobody touched never is (`scriptNeeds`, src/db/setup.ts).
    const langsChanged = !!cur && (cur.languages_served ?? []).join(',') !== v.value.languagesServed.join(',');
    await sql`update businesses set
        name = ${v.value.name}, description = ${v.value.description}, location = ${v.value.location},
        working_hours = ${v.value.workingHours}, contact_email = ${v.value.contactEmail},
        contact_phone = ${v.value.contactPhone}, languages_served = ${langsSql(v.value.languagesServed)}
        ${langsChanged ? sql`, languages_chosen_at = coalesce(languages_chosen_at, now())` : sql``}
        ${v.value.postalAddress !== undefined ? sql`, postal_address = ${v.value.postalAddress}` : sql``}
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
      if (langsChanged) changed.push('languages_served');
      if (v.value.postalAddress !== undefined && !eq(cur.postal_address, v.value.postalAddress)) changed.push('postal_address');
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
 * THE WARMTH RUN (2026-10-03), phase 7 — THE SETTINGS MODEL: one row of a
 * menu. Its shape, its name (and a line under it only where the value cannot
 * say the whole thing), what it is set to now, and the door. A row with no
 * door (`href: null`) is one only the owner may open (rule 11): a sales
 * assistant reads where it stands and is offered no door to a refusal.
 *
 * A row is 56 px; one with a line under it is 64 px (`sr-two`).
 */
export type MenuRow = {
  readonly href: string | null;
  readonly icon?: IconId;
  readonly label: string;
  readonly desc?: string | null;
  /** The line under the name, already escaped — for a line that isolates an address or a number. */
  readonly descHtml?: string;
  readonly value?: string | null;
  /** A value that is a STATE carries its signal (phase 4); one that only names something carries none. */
  readonly tone?: 'ok' | 'warn' | 'bad' | undefined;
  /** The advisor run — the row IS the assistant: its own slot (`agentMark`) stands where a row's shape does. */
  readonly agent?: true;
  /**
   * UI Block 7 (F34) — a channel's states, each named: the first pair is the row's value (its connection, with the
   * value's tone), then whether it can answer now and who gets replies; and the one next step, if there is one.
   * They stand under the name, inside the same door.
   */
  readonly states?: { readonly items: readonly (readonly [label: string, value: string])[]; readonly next: string | null;
    /** The text pass — a calm row shows its connection alone, as one pill, with at most one note beside it. */
    readonly calm?: true; readonly note?: string };
};

export const menuRow = (r: MenuRow): string => {
  const line = r.descHtml ?? (r.desc ? esc(r.desc) : '');
  if (r.states && r.href) {
    const [first, ...rest] = r.states.items;
    const pair = (label: string, value: string, cls: string) =>
      `<span class="ch-state"><span class="ch-k">${esc(label)}</span><span class="${cls}"><bdi>${esc(value)}</bdi></span></span>`;
    const states = r.states.calm
      ? `<span class="ch-states ch-one">${first ? `<span class="sr-value${r.tone ? ` ${r.tone}` : ''}"><bdi>${esc(first[1])}</bdi></span>` : ''}${r.states.note ? `<span class="ch-v"><bdi>${esc(r.states.note)}</bdi></span>` : ''}</span>`
      : `<span class="ch-states">${first ? pair(first[0], first[1], `sr-value${r.tone ? ` ${r.tone}` : ''}`) : ''}${rest.map(([k, v]) => pair(k, v, 'ch-v')).join('')}</span>`;
    return `<li class="ch-row"><a class="srow sr-menu sr-two" href="${settingsHref(r.href)}">${r.icon ? icon(r.icon) : ''}<span class="sr-main"><span class="sr-label">${esc(r.label)}</span>${line ? `<span class="sr-desc">${line}</span>` : ''}${states}${r.states.next ? `<span class="ch-next">${esc(r.states.next)}</span>` : ''}</span>${GO}</a></li>`;
  }
  // Phase 9 of the warmth run (w4-today-setup-24, w4-whole-08) — the value's
  // cell takes the PAGE's direction, so its state mark stands where reading
  // starts (on the right in Arabic) and the cell lines up at the row's end;
  // the `<bdi>` alone isolates the words, so an e-mail address or a Latin name
  // keeps its own order. (`dir="auto"` on the cell skipped the text inside the
  // `<bdi>` and resolved every Arabic value left to right.) Nothing is cut
  // (w4-today-setup-23): a value that does not fit wraps under itself.
  const inner = `${r.agent ? agentMark(24, 'ni') : r.icon ? icon(r.icon) : ''}<span class="sr-main"><span class="sr-label">${esc(r.label)}</span>${line ? `<span class="sr-desc">${line}</span>` : ''}</span>`
    + `${r.value ? `<span class="sr-value${r.tone ? ` ${r.tone}` : ''}"><bdi>${esc(r.value)}</bdi></span>` : ''}`;
  const cls = `srow sr-menu${line ? ' sr-two' : ''}`;
  return r.href
    ? `<li><a class="${cls}" href="${settingsHref(r.href)}">${inner}${GO}</a></li>`
    : `<li><div class="${cls}">${inner}</div></li>`;
};

/** A group of rows: one card, under a short heading (none where the screen's own name says it). A group with no row is not drawn. */
export const menuGroup = (id: string, title: string | null, rows: readonly string[]): string =>
  rows.length === 0 ? ''
    : title === null ? `<div class="sgroup"><ul class="scard">${rows.join('')}</ul></div>`
    : `<section class="sgroup" aria-labelledby="sg-${id}"><h2 class="sgroup-h" id="sg-${id}">${esc(title)}</h2>
        <ul class="scard">${rows.join('')}</ul></section>`;

/**
 * THE WARMTH RUN (2026-10-03), phase 7 — SETUP: how the app is wired for the
 * owner, as a menu of two short cards (it was six labelled groups, a search
 * and a switch). Setting up: the guide and its steps, what is checked before
 * going live, alerts on this phone, the language. Your account: who works
 * here, how you sign in, billing, your data.
 *
 * What is ABOUT the business moved to My business, its one home: the profile,
 * the kind of business, How you sell — and where customers reach you, which
 * is a fact about this business and where an owner looks for it. The five
 * steps of setting up are one tap down, on Getting started (`/app/guide`),
 * the row that says how many are done; the channels step there opens My
 * business's channels screen (`STEP_LINK`). The search went with the length:
 * eight rows in two cards are read faster than they are searched. Log out is
 * Settings' foot.
 */
export type SetupView = {
  /** How many people work here. */
  readonly people: number;
  /** Phase 3 — alerts on this person's phones: whether this installation can send them, and how many phones. */
  /** The warmth run, phase 8 — `way`: how notifications reach this reader now (null: nothing does). */
  readonly alerts?: { readonly available: boolean; readonly phones: number; readonly way?: 'email' | 'browser' | 'whatsapp' | null } | null;
  /** Phase 3 — how this person signs in: their e-mail, or the access code when they have no login. */
  readonly signIn?: { readonly email: string | null } | null;
  /** Phase 3 — billing as it stands (the owner's); null for staff. */
  readonly billing?: { readonly configured: boolean; readonly exempt: boolean; readonly status: string } | null;
  /** Phase 3 — customers' deletion requests waiting for the owner; null for staff. */
  readonly dataWaiting?: number | null;
  /** Phase 7 — who is looking. Who works here, billing and your data are the owner's pages (rule 11). Absent: the owner. */
  readonly viewer?: Viewer;
  /** 0130 — this person's advisor history is kept now. Absent: it is not. */
  readonly advisorKept?: boolean;
};

export function renderSetup(v: SetupView, locale: Locale, flash: Flash | null): string {
  const setup = setupState();
  const owner = (v.viewer ?? OWNER_VIEW).isOwner;
  const step = (k: string): boolean | null => setup?.steps.find((x) => x.step === k)?.done ?? null;
  const toneOf = (done: boolean | null): 'ok' | 'warn' | undefined => done === null ? undefined : done ? 'ok' : 'warn';
  const named = step('name');
  const billingTone = !v.billing || !v.billing.configured ? undefined
    : v.billing.exempt || ['cardSaved', 'trial', 'active'].includes(v.billing.status) ? 'ok' as const
    : ['past_due', 'lapsed'].includes(v.billing.status) ? 'bad' as const : undefined;
  const billing = v.billing
    ? (!v.billing.configured ? t(locale, 'setup.value.notSetUp')
      : v.billing.exempt ? t(locale, 'setup.value.billing.exempt')
      : (['none', 'cardSaved', 'trial', 'active', 'past_due', 'lapsed'] as const).includes(v.billing.status as never)
        ? t(locale, `setup.value.billing.${v.billing.status}` as MessageKey) : '')
    : '';
  const start = [
    // The guided path, with where setting up stands: its five steps are one tap down.
    menuRow({ href: '/app/guide', icon: 'guide', label: t(locale, 'guide.title'),
      value: setup ? (setup.next === null ? t(locale, 'setup.state.done') : t(locale, 'nav.setup.progress', { done: setup.done, total: setup.total })) : null,
      tone: setup ? toneOf(setup.next === null) : undefined }),
    menuRow({ href: '/app/onboarding', icon: 'setup', label: t(locale, 'nav.onboarding'),
      value: named === null ? null : t(locale, named ? 'setup.value.nameConfirmed' : 'setup.value.nameNotConfirmed'), tone: toneOf(named) }),
    // The warmth run, phase 8 — Notifications: the row says how they reach this reader now;
    // phase 9 (w4-settings-a-02) — and, when nothing does, says that, not a way that cannot reach them.
    menuRow({ href: '/app/settings/alerts', icon: 'alerts', label: t(locale, 'alerts.title'),
      desc: v.alerts?.way === null ? t(locale, 'setup.alerts.nothing') : null,
      value: !v.alerts ? null : v.alerts.way !== undefined ? (v.alerts.way ? alertWayName(locale, v.alerts.way) : null)
        : !v.alerts.available ? t(locale, 'setup.value.unavailable')
        : v.alerts.phones === 0 ? t(locale, 'setup.value.off') : tn(locale, 'setup.value.phones', v.alerts.phones),
      tone: v.alerts?.way === null ? 'warn' : v.alerts?.way === undefined && v.alerts?.available && v.alerts.phones > 0 ? 'ok' : undefined }),
    // The switch, a tap down: the row says which language is in force, in its own name.
    menuRow({ href: '/app/settings/language', icon: 'language', label: t(locale, 'settings.language.title'), value: LOCALE_LABEL[locale] }),
  ];
  const account = [
    menuRow({ href: owner ? '/app/settings/people' : null, icon: 'people', label: t(locale, 'people.title'), value: tn(locale, 'setup.state.people', v.people) }),
    menuRow({ href: '/app/settings/account', icon: 'account', label: t(locale, 'account.title'),
      value: !v.signIn ? null : v.signIn.email ?? t(locale, 'setup.value.accessCode') }),
    ...(owner ? [
      menuRow({ href: '/app/settings/billing', icon: 'billing', label: t(locale, 'billing.title'), value: billing, tone: billingTone }),
      menuRow({ href: '/app/settings/data', icon: 'data', label: t(locale, 'data.title'),
        value: v.dataWaiting === null || v.dataWaiting === undefined ? null
          : v.dataWaiting === 0 ? t(locale, 'setup.value.nothingWaiting') : tn(locale, 'setup.value.requests', v.dataWaiting),
        tone: v.dataWaiting ? 'warn' : undefined }),
    ] : []),
    // 0130 — each person's own advisor history: their switch and their download (D4); the owner's workspace and team.
    menuRow({ href: '/app/settings/advisor-history', icon: 'data', label: t(locale, 'advisor.history.title'),
      value: t(locale, v.advisorKept ? 'advisor.history.valueOn' : 'advisor.history.valueOff') }),
  ];
  return `<h1 class="page">${esc(t(locale, 'nav.setup'))}</h1>
    ${flashBanner(flash)}
    ${/* Phase 9 (V1-153) — the screen's own name says what this card is: no third name for setting up above it. */ ''}${menuGroup('start', null, start)}
    ${menuGroup('account', t(locale, 'setup.group.yours'), account)}`;
}

// The language switch is Settings › You › Account's `#language` section (rule 104): one select, saved with the page.

/**
 * THE WARMTH RUN (2026-10-03), phase 1 — SETTINGS: the screen the rail's
 * Settings opens. Two rows, each with its shape and where it stands — My
 * business (the business's name) and Setup (its steps, while any is left) —
 * and Log out at the foot, apart from them: it is the one row that does
 * something rather than opening something.
 *
 * THE ADVISOR RUN (2026-10-06) — the assistant's page moved here, whole: the first row is the assistant (its
 * name, its own slot), and the line under it says how much it does alone as it stands, so that control keeps
 * its prominence one level in. Absent (`assistant` not given): the two rows as before.
 */
export function renderSettingsHome(locale: Locale, flash: Flash | null, assistant?: { readonly alone: string }): string {
  const setup = setupState();
  const progress = setup ? (setup.next === null ? t(locale, 'setup.state.done') : t(locale, 'nav.setup.progress', { done: setup.done, total: setup.total })) : '';
  // One row as every menu draws it (`menuRow`). A step still to do carries the to-do ○ in the
  // secondary ink (`.sr-value.warn`, w4-whole-06), never the waiting signal.
  const row = (href: string, shape: Parameters<typeof icon>[0], label: string, value: string, tone?: 'ok' | 'warn') =>
    menuRow({ href, icon: shape, label, value, ...(tone ? { tone } : {}) });
  // Phase 9 (w4-today-setup-28) — My business carries no value: the business's name is printed just above the heading.
  return `<h1 class="page">${esc(t(locale, 'nav.settings'))}</h1>
    ${flashBanner(flash)}
    <ul class="scard">
      ${assistant ? menuRow({ href: ASSISTANT_HOME, agent: true, label: assistantName(locale), desc: assistant.alone }) : ''}
      ${row('/app/business', 'business', t(locale, 'nav.factory'), '')}
      ${row('/app/settings/setup', 'setup', t(locale, 'nav.setup'), progress, setup ? (setup.next === null ? 'ok' : 'warn') : undefined)}
    </ul>
    <form class="scard sr-foot" method="post" action="/logout">
      <button class="srow sr-menu sr-out" type="submit">${icon('logout')}<span class="sr-main"><span class="sr-label">${esc(t(locale, 'header.logout'))}</span></span></button>
    </form>`;
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

const INTL_LOCALE: Record<Locale, string> = { en: 'en', zh: 'zh-CN', ar: 'ar', es: 'es', fr: 'fr' };

/** TZ — the zone, as a row of the profile's one form (phase 3: one save, not three). */
function zoneRow(c: ZoneChoice, locale: Locale): string {
  const own = zoneChoices(c.country ?? '');
  const option = (z: string, label: string) => `<option value="${esc(z)}"${z === c.zone ? ' selected' : ''}>${esc(label)}</option>`;
  // Block 1 #9 (2026-11-06) — the 59 workspaces made before sign-up asked (0151) kept Shanghai's clock; a zone that is not
  // one its country keeps is flagged here, so the owner sees the question sign-up never put to them.
  const unconfirmed = c.country && own.length > 0 && own !== ALL_ZONES && !own.includes(c.zone);
  const desc = unconfirmed ? `${t(locale, 'settings.zone.why')} ${t(locale, 'settings.zone.unconfirmed')}` : t(locale, 'settings.zone.why');
  const row = (control: string) => fieldRow({ label: t(locale, 'settings.zone.label'), forId: 'pf-zone', desc, control });
  // A country narrows the list to its own zones, told apart by their places.
  if (own.length > 0 && own !== ALL_ZONES) {
    // The warmth run (V1-522) — zones that keep the same clock all year are one choice.
    const all = zonesKeptApart(own.includes(c.zone) ? own : [c.zone, ...own], c.zone);
    const label = zoneLabelsAmong(locale, all);
    return row(`<select id="pf-zone" name="zone">${all.map((z) => option(z, label(z))).join('')}</select>`);
  }
  // Phase 9 (V1-522, V1-528) — without one, every zone a shop keeps (no
  // research stations), under its region, named by its country in the
  // owner's language; the city only where a country keeps several.
  const open = (zh: boolean, s: string) => (zh ? `（${s}）` : ` (${s})`);
  // The warmth run (V1-522) — zones of one country that keep the same clock
  // all year are one choice (Argentina's twelve are one); within a country,
  // the city — in the owner's language (`zoneCity`) — only where two of the
  // choices keep the same time, or the time has no name; the zone a country
  // is named by needs none.
  const zones = zonesKeptApart(SHOP_ZONES, c.zone);
  const shared = new Map<string, number>();
  for (const z of zones) { const cc = countryOfZone(z); const k = zoneKept(locale, z); if (cc && k) shared.set(`${cc}|${k}`, (shared.get(`${cc}|${k}`) ?? 0) + 1); }
  const named = (z: string): string => {
    const cc = countryOfZone(z);
    const country = cc ? countryName(locale, cc) : null;
    const kept = zoneKept(locale, z);
    const needsCity = !kept || (shared.get(`${cc}|${kept}`) ?? 0) > 1;
    const city = needsCity ? zoneCity(locale, z) : null;
    const place = country ? (city ? `${country}${open(locale === 'zh', city)}` : country) : zoneCity(locale, z) ?? zonePlace(z);
    return kept ? `${place} — ${kept}` : place;
  };
  const order = new Intl.Collator(locale).compare;
  const lone = zones.includes(c.zone) ? '' : option(c.zone, zoneLabel(locale, c.zone));
  const continents = new Intl.DisplayNames([INTL_LOCALE[locale]], { type: 'region' });
  const groups = ZONE_GROUPS.map((g) => {
    const zs = zones.filter((z) => g.regions.some((r) => regionOf(z) === r)).map((z) => ({ z, label: named(z) })).sort((a, b) => order(a.label, b.label));
    const label = g.m49 ? continents.of(g.m49) ?? '' : t(locale, `settings.zone.region.${g.key}` as MessageKey);
    return `<optgroup label="${esc(label)}">${zs.map((x) => option(x.z, x.label)).join('')}</optgroup>`;
  }).join('');
  return row(`<select id="pf-zone" name="zone">${lone}${groups}</select>`);
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

/** Where the business profile is drawn, and where its one Save is sent (rule 104). */
export const PROFILE_PAGE = '/app/settings/business/profile';

/**
 * THE SETTINGS OVERHAUL (rule 104) — Business profile in the one template: every field always on the page, in four
 * sections (the business, contact, legal identifiers, type and website), and ONE Save for all of them
 * (`POST PROFILE_PAGE`: it validates everything, then calls the save functions that were always there). A refused
 * save comes back with everything typed kept and each refusal under its field (M20.4).
 *
 * What left for its ONE home: working hours and the time zone are on Hours and closures, the currency on Currency;
 * the page says where each is. "What you sell" is answered in How you sell and stays a value with its door.
 * `_zone` and `_currency` are no longer drawn here (kept in the signature for the callers that pass them).
 */
export function renderProfile(
  p: BusinessProfile, locale: Locale, flash: Flash | null,
  draft: ProfileDraft = {}, errors: ProfileErrors = {},
  _zone: ZoneChoice | null = null,
  _currency: CurrencyChoice | null = null,
  viewer: Viewer = OWNER_VIEW,
  ids: { readonly draft?: IdentifiersInput; readonly errors?: Partial<Record<IdentifierField, IdentifierError>> } = {},
  kind: { readonly view: BusinessKindView; readonly kept?: Kept | null } | null = null,
): string {
  const name = assistantName(locale);
  // M20.4 (F-07) — the submitted value wins over the stored one, so nothing the
  // owner typed is lost when one field is wrong.
  const val = (f: ProfileField, stored: string | null): string => draft[f] ?? stored ?? '';
  const errLine = (f: ProfileField): string => {
    const e = errors[f];
    if (!e) return '';
    const detail = e === 'tooLong' ? { n: CAP[f as keyof typeof CAP] ?? 200 } : {};
    return `<span class="fielderr" role="alert">${esc(t(locale, `settings.err.${e}` as MessageKey, detail))}</span>`;
  };
  // Phase 9 (V1-523) — what the setup step still needs, marked where it is
  // missing: a description, a location, and one way to be reached (setup.ts).
  const needs = {
    description: !p.description, location: !p.location, contact: !p.contactEmail && !p.contactPhone,
  };
  const field = (id: string, label: MessageKey, f: ProfileField, stored: string | null, ph = '', extra: { needed?: boolean; mark?: string | undefined; desc?: string } = {}) => setRow(locale, {
    label: t(locale, label), forId: `pf-${id}`, error: errLine(f) || undefined, desc: extra.desc,
    ...(extra.needed ? { needed: true } : {}), ...(extra.mark ? { mark: extra.mark } : {}),
    control: `<input id="pf-${id}" name="${id}" value="${esc(val(f, stored))}"${ph ? ` placeholder="${esc(ph)}"` : ''} />` });

  const languages = fieldRow({ label: t(locale, 'settings.field.languages'), desc: t(locale, 'ws.profile.languages'),
    control: `<div class="langs">${SERVED_LANGUAGES.map((l) =>
      `<label class="chkbox"><input type="checkbox" name="lang_${l}"${(draft.languagesServed ?? p.languagesServed).includes(l) ? ' checked' : ''} /> <bdi lang="${l}">${esc(SERVED_LABEL[l])}</bdi></label>`).join('')}</div>` });
  // Phase 9 (V1-524) — who reads what: the description reaches the assistant
  // (speakerContext's "what it sells"); the contact details reach nobody.
  const description = setRow(locale, { label: t(locale, 'settings.field.description'), forId: 'pf-description', error: errLine('description') || undefined,
    needed: needs.description, desc: t(locale, 'settings.desc.description', { name }),
    control: `<textarea id="pf-description" name="description" rows="3">${esc(val('description', p.description))}</textarea>` });
  // The warmth run (V1-006, V1-525, -07) — what the business sells, in the owner's words for it, and the door to the one
  // place it is answered (How you sell): a value here, never a field.
  const sells = p.whatYouSell ? [fieldRow({ label: t(locale, 'settings.field.whatYouSell'),
    control: `<span class="fr-value">${p.whatYouSell.category
      ? esc(t(locale, `hs.category.${p.whatYouSell.category}` as MessageKey))
      : `<span class="muted">${esc(t(locale, 'setup.state.notAnswered'))}</span>`}</span> ${deeper(WHAT_YOU_SELL, t(locale, 'hs.q.product_claims'))}` })] : [];
  // 0133 — the address every first e-mail and follow-up carries: ONE line on the page (the long form is in the page's
  // help). Marked as needed where the business writes first, since none goes without it.
  const postalNeeded = !!p.outreachArea && !(draft.postalAddress ?? p.postalAddress ?? '').trim();
  const postal = setRow(locale, { label: t(locale, 'settings.field.postalAddress'), forId: 'pf-postal', error: errLine('postalAddress') || undefined,
    needed: postalNeeded, desc: t(locale, 'ws.profile.postal'),
    control: `<textarea id="pf-postal" name="postal_address" rows="3" maxlength="400" dir="auto">${esc(val('postalAddress', p.postalAddress ?? null))}</textarea>` });

  const about = setSection({ id: 'about', title: t(locale, 'profile.group.business'), rows: [
    field('name', 'settings.field.name', 'name', p.name), description, ...sells,
    field('location', 'settings.field.location', 'location', p.location, '', { needed: needs.location }),
    languages,
  ] });
  // The warmth run (w4-settings-b-outreach-06) — either one finishes the step (setup.ts), and each field says so.
  const contact = setSection({ id: 'contact', title: t(locale, 'profile.group.contact'), rows: [
    field('contact_email', 'settings.field.contactEmail', 'contactEmail', p.contactEmail, '', { mark: needs.contact ? t(locale, 'ws.profile.orPhone') : undefined, desc: t(locale, 'settings.desc.contact', { name }) }),
    field('contact_phone', 'settings.field.contactPhone', 'contactPhone', p.contactPhone, t(locale, 'settings.alerts.placeholder'), { mark: needs.contact ? t(locale, 'ws.profile.orEmail') : undefined }),
    postal,
  ] });
  const identifiers = p.identifiers ? identifiersSection(p.identifiers, locale, viewer, ids.draft ?? null, ids.errors ?? {}) : '';
  const type = kind ? setSection({ id: 'business-kind', title: t(locale, 'ws.profile.typeWebsite'), rows: businessKindRows(kind.view, locale, kind.kept ?? null) }) : '';
  // A setting has ONE home: the page says where the three that left are set, by the page's own name.
  const elsewhere = setNotice({ text: t(locale, 'ws.profile.hoursAt', { page: t(locale, 'settingsArea.hours') }), door: { href: '/app/settings/business/hours', label: t(locale, 'settingsArea.hours') } })
    + setNotice({ text: t(locale, 'ws.profile.currencyAt', { page: t(locale, 'settingsArea.currency') }), door: { href: '/app/settings/business/currency', label: t(locale, 'settingsArea.currency') } });

  const missing = needs.description || needs.location || needs.contact;
  return `${pageHead(t(locale, 'settingsArea.profile'), t(locale, 'ws.profile.lede', { name }))}
    ${flashBanner(flash)}
    ${missing ? setNotice({ id: 'profile-needs', text: t(locale, 'settings.profile.needs') }) : ''}
    ${saveForm(PROFILE_PAGE, `${about}${contact}${identifiers}${type}${saveActs(locale)}`, { id: 'profile-form' })}
    ${elsewhere}`;
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

/**
 * Phase 9 (V1-502) — the floor as the page shows it: by the language each word
 * is in, one line a language, so its words are a few lines to scan rather than
 * a column 1,800 px long. The groups are the floor's own (forbiddenWords.ts):
 * since V1-504 the floor is written by language, so the page cannot drift from it.
 */
export { FLOOR_BY_LANGUAGE };
// Phase 9 of the warmth run (w4-settings-a-19) — a language's name starts its line as a label: capitalised
// where the script has case (French and Spanish write "anglais", "inglés" mid-sentence).
const languageOf = (locale: Locale, code: string): string => {
  let n = code;
  try { n = new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code; } catch { /* the code itself */ }
  return n.charAt(0).toLocaleUpperCase(locale) + n.slice(1);
};
const LIST_GAP: Readonly<Record<Locale, string>> = { en: ', ', zh: '、', ar: '، ', es: ', ', fr: ', ' };

/**
 * The settings overhaul (rule 104) — WORDS TO AVOID, a section of Settings › Assistant › Promises and words (it was a
 * page of its own). The rule is on the page in one line; a word is ADDED with the list's own Add form and REMOVED by
 * its row, at once (the notice that follows offers Undo); the built-in list is read-only, folded. How a word is
 * matched is said under the field it concerns (V1-504: on the page itself).
 */
export function forbiddenSection(v: ForbiddenView, locale: Locale, kept: Kept | null = null): string {
  const name = assistantName(locale);
  const add = `<form method="post" action="/app/settings/forbidden" class="set-add">
      ${fieldRow({ label: t(locale, 'forbidden.add.label'), forId: 'fb-term', desc: t(locale, 'forbidden.howMatched'), error: keptError(kept, 'term', 'fb-term-err'),
        control: `<input id="fb-term" name="term" required maxlength="80" placeholder="${esc(t(locale, 'forbidden.add.placeholder'))}" value="${keptValue(kept, 'term')}"${keptInvalid(kept, 'term', 'fb-term-err')} />` })}
      ${fieldRow({ label: t(locale, 'forbidden.add.note'), forId: 'fb-note',
        control: `<input id="fb-note" name="note" maxlength="${MAX_FORBIDDEN_NOTE}" placeholder="${esc(t(locale, 'forbidden.add.notePlaceholder'))}" value="${keptValue(kept, 'note')}" />` })}
      ${cardActs(`<button class="btn" type="submit">${esc(t(locale, 'forbidden.add.button'))}</button>`)}
    </form>`;
  const own = v.own.length === 0
    ? `<p class="set-none muted">${esc(t(locale, 'forbidden.empty'))}</p>`
    : searchList(locale, `<table class="team-table as-words"><thead><tr><th scope="col">${esc(t(locale, 'forbidden.add.label'))}</th><th scope="col">${esc(t(locale, 'as.words.note'))}</th><th scope="col"></th></tr></thead><tbody>${v.own.map((x) =>
        `<tr class="tm"${listRow(`${x.term} ${x.note ?? ''}`)}><th scope="row"><bdi>${esc(x.term)}</bdi></th><td>${x.note ? `<bdi>${esc(x.note)}</bdi>` : ''}</td><td class="as-act">${rowAction({
          action: `/app/settings/forbidden/${x.id}/remove`, label: t(locale, 'forbidden.remove'), ariaLabel: `${t(locale, 'forbidden.remove')}: ${x.term}` })}</td></tr>`).join('')}</tbody></table>`);
  // The floor is a fact, not a setting: what it is and that it cannot be switched off are said; the words are folded.
  const floor = `<h3 class="sgroup-h">${esc(t(locale, 'forbidden.floor.title'))}</h3>
      <p class="set-help">${esc(t(locale, 'forbidden.floor.body', { name }))}</p>
      <details class="floor-fold">
        <summary>${esc(tn(locale, 'forbidden.floor.count', v.floor.length))}</summary>
        <dl class="floor-langs">${FLOOR_BY_LANGUAGE.map((g) => `<div><dt>${esc(languageOf(locale, g.language))}</dt><dd>${
          g.words.filter((w) => v.floor.includes(w)).map((w) => `<bdi>${esc(w)}</bdi>`).join(esc(LIST_GAP[locale]))}</dd></div>`).join('')}</dl>
      </details>`;
  return setSection({ id: 'words', title: t(locale, 'settingsArea.words'), help: t(locale, 'forbidden.intro', { name }), rows: `${add}${own}${floor}` });
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
    : { from, to, rate: decimal(r.rate), statedAt: r.stated_at };
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

/** Where Currency is drawn, and where its one Save is sent (rule 104). */
export const CURRENCY_PAGE = '/app/settings/business/currency';

/**
 * THE SETTINGS OVERHAUL (rule 104) — Currency: the ONE home of the currency the workspace sells in (a choice only for
 * the owner, and only until the first price) and of the rate the owner will honour; one Save for both
 * (`POST CURRENCY_PAGE`). "Never a rate from anywhere else" stays on the page, beside the rate. Anyone else reads
 * the values and that the owner decides. `kept`: a refused rate, said under its field with what was typed.
 */
export function renderCurrency(v: RateView, c: CurrencyChoice | null, locale: Locale, flash: Flash | null, viewer: Viewer = OWNER_VIEW, kept: Kept | null = null): string {
  const name = assistantName(locale);
  const stated = (r: OwnerRate): string =>
    `${esc(t(locale, 'rate.current', { rate: r.rate, from: r.from, to: r.to }))} <span class="muted">· ${esc(t(locale, 'rate.setOn', { date: show.date(locale, r.statedAt) }))}</span>`;
  const selling = c ? setSection({ id: 'currency', title: t(locale, 'biz.now.currency'), rows: [currencyRow(c, locale, viewer)] }) : '';
  // Phase 9 (V1-529, V1-531, V1-532, new-06) — nothing to convert is a state, drawn as one: the currency by its name.
  const rate = !v.pair
    ? setSection({ id: 'rate', title: t(locale, 'rate.title'), rows: `<div class="empty notset" role="status">${esc(t(locale, 'rate.none', { from: currencyInLine(locale, v.currency) }))}</div>` })
    : setSection({ id: 'rate', title: t(locale, 'rate.title'), rows: [
      setNotice({ text: t(locale, 'rate.intro', { name, from: v.pair.from, to: v.pair.to }) }),
      v.current ? `<p class="stated-now"><bdi>${stated(v.current)}</bdi></p>`
        : `<div class="empty notset">${esc(t(locale, 'rate.empty', { to: v.pair.to }))}</div>`,
      ...(viewer.isOwner ? [fieldRow({ label: t(locale, 'rate.add.label', { from: v.pair.from, to: v.pair.to }), forId: 'rt-rate', error: keptError(kept, 'rate', 'rt-rate-err'),
        control: `<input id="rt-rate" name="rate" inputmode="decimal" value="${keptValue(kept, 'rate')}"${keptInvalid(kept, 'rate', 'rt-rate-err')} />` })] : []),
    ] });
  const fields = viewer.isOwner && ((c !== null && !c.fixed) || v.pair !== null);
  const history = v.previous.length
    ? setSection({ title: t(locale, 'rate.history.title'), rows: `<ul class="rate-hist">${v.previous.map((r) => `<li><bdi>${stated(r)}</bdi></li>`).join('')}</ul>` })
    : '';
  return `${pageHead(t(locale, 'settingsArea.currency'), t(locale, 'settingsArea.currencyHint'))}
    ${flashBanner(flash)}
    ${fields ? saveForm(CURRENCY_PAGE, `${selling}${rate}${saveActs(locale)}`, { id: 'currency-form' })
      : `${selling}${rate}${viewer.isOwner || !v.pair ? '' : ownerDecides(locale)}`}
    ${history}`;
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

/** Digits as typed on any keyboard the five languages use (Arabic-Indic, Persian, full-width) read as 0–9. */
const asciiDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xFF10));

/**
 * The warmth run, phase 9 (V1-008) — a closure's date as the form sends it:
 * three parts, `<name>_d`, `<name>_m` and `<name>_y`, put back together as the
 * one YYYY-MM-DD the server has always validated (`validateClosure`, which
 * still decides). A date posted whole (`<name>`, an older page) is read as it
 * was. Nothing given is missing; parts that make no date are not a date.
 */
export function closureDateField(body: Readonly<Record<string, string | undefined>>, name: 'from' | 'to'): string | null {
  const whole = body[name];
  if (typeof whole === 'string' && whole.trim()) return whole;
  const [d, m, y] = (['d', 'm', 'y'] as const).map((p) => asciiDigits(String(body[`${name}_${p}`] ?? '')).trim());
  if (!d && !m && !y) return null;
  if (!/^\d{1,2}$/.test(d!) || !/^\d{1,2}$/.test(m!) || !/^\d{4}$/.test(y!)) return 'not-a-date';
  return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
}

/**
 * The date field, drawn in the owner's language: the day, the month by its
 * name, the year, in the order that language writes a date, each part with its
 * own label, the three one group named by the row. The browser's own date
 * control drew "yyyy/mm/dd" in Latin, left to right, on an Arabic page. What
 * was typed comes back in it when the form is sent back.
 */
function dateParts(locale: Locale, name: 'from' | 'to', label: string, kept: Kept | null, errId: string): string {
  const id = `cl-${name}`;
  const typed = kept?.values ?? {};
  const whole = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typed[name] ?? '');
  const value = { day: whole?.[3] ?? typed[`${name}_d`] ?? '', month: whole?.[2] ?? typed[`${name}_m`] ?? '', year: whole?.[1] ?? typed[`${name}_y`] ?? '' };
  const bad = kept?.field === name;
  const months = monthNames(locale);
  const parts = datePartOrder(locale).map((part, i) => {
    // The first part takes the cursor when the field was the one refused.
    const mark = bad ? (i === 0 ? keptInvalid(kept, name, errId) : ` aria-invalid="true" aria-describedby="${esc(errId)}"`) : '';
    const word = esc(t(locale, `closures.date.${part}` as MessageKey));
    if (part === 'month') {
      const chosen = Number(value.month);
      return `<label class="dpart dpart-m"><span class="dpart-n">${word}</span><select id="${id}-m" name="${name}_m" required${mark}>
          <option value="">${esc(t(locale, 'signup.pick'))}</option>${months.map((mo, k) =>
            `<option value="${String(k + 1).padStart(2, '0')}"${chosen === k + 1 ? ' selected' : ''}>${esc(mo)}</option>`).join('')}</select></label>`;
    }
    const short = part === 'day';
    return `<label class="dpart dpart-${short ? 'd' : 'y'}"><span class="dpart-n">${word}</span><input id="${id}-${short ? 'd' : 'y'}" name="${name}_${short ? 'd' : 'y'}" inputmode="numeric" autocomplete="off" required maxlength="${short ? 2 : 4}" value="${esc(value[part])}"${mark} /></label>`;
  }).join('');
  return `<div class="dparts" role="group" aria-label="${esc(label)}">${parts}</div>`;
}

/** Where Hours and closures is drawn, and where its one Save is sent (rule 104). */
export const HOURS_PAGE = '/app/settings/business/hours';
export type HoursView = { readonly workingHours: string | null; readonly zone: ZoneChoice | null; readonly closures: readonly ClosureRow[] };

/**
 * THE SETTINGS OVERHAUL (rule 104) — Hours and closures: the ONE home of the working hours and the time zone (fields,
 * saved by the page's one Save: `POST HOURS_PAGE`) and of the days the business is closed (a list: each Remove acts
 * at once and asks first; "Add these days" is the list's own Add). No date is promised through closed days: that line
 * stays on the page, beside the list. `kept`: a closure refused, under its field; `hours`: working hours refused.
 */
export function renderHours(
  v: HoursView, locale: Locale, flash: Flash | null, kept: Kept | null = null,
  hours: { readonly typed: string; readonly error?: string | undefined } | null = null,
): string {
  const name = assistantName(locale);
  const range = (c: FactoryClosure) =>
    t(locale, 'closures.range', { from: show.date(locale, c.from), to: show.date(locale, c.to) });
  // Phase 9 (V1-482) — the words a customer gets, as the reply is told to say
  // them (`closureNote`): the closure's name, and that no date can be promised.
  // Phase 9 of the warmth run (w4-settings-a-13) — with no closure yet, the sample is said as it reads mid-sentence.
  const example = t(locale, 'closures.example', { name, label: v.closures[0]?.label ?? t(locale, 'closures.example.sample') });
  // A row's Remove acts at once (the one saving rule), asks first, and can still be undone from its notice.
  const closureList = v.closures.length === 0
    ? `<div class="empty whole">${esc(t(locale, 'closures.empty', { name }))}</div>`
    : `<ul class="closures">${v.closures.map((c) => `<li>
          <span><bdi>${esc(c.label)}</bdi> <span class="muted">${esc(range(c))}</span></span>
          ${rowAction({ action: `/app/settings/closures/${c.id}/remove`, label: t(locale, 'closures.remove'), danger: true,
            confirm: t(locale, 'ws.hours.removeAsk', { label: c.label }), ariaLabel: `${t(locale, 'closures.remove')} ${c.label}` })}</li>`).join('')}</ul>`;
  const closed = setSection({ id: 'closures', title: t(locale, 'closures.title'), rows: [
    setNotice({ text: t(locale, 'ws.hours.closedNote', { name }) }),
    // Read-only detail may fold (rule 104): what a customer is told, in the words the reply is given.
    `<details class="note-fold closure-said"><summary>${esc(t(locale, 'closures.example.sum'))}</summary><p class="measure-prose">${esc(example)}</p></details>`,
    `<h3 class="sgroup-h">${esc(t(locale, 'biz.closures.now'))}</h3>${closureList}`,
  ] });
  const add = `<form method="post" action="/app/settings/closures" class="biz-form" id="add-closure">${setSection({ title: t(locale, 'biz.closures.add'), rows: [
      fieldRow({ label: t(locale, 'closures.add.label'), forId: 'cl-label', desc: t(locale, 'closures.add.shown'), error: keptError(kept, 'label', 'cl-label-err'),
        control: `<input id="cl-label" name="label" required maxlength="80" placeholder="${esc(t(locale, 'closures.add.placeholder'))}" value="${keptValue(kept, 'label')}"${keptInvalid(kept, 'label', 'cl-label-err')} />` }),
      // The warmth run, phase 9 (V1-008) — each date in the owner's language: day, month by name, year.
      fieldRow({ label: t(locale, 'closures.add.from'), error: keptError(kept, 'from', 'cl-from-err'),
        control: dateParts(locale, 'from', t(locale, 'closures.add.from'), kept, 'cl-from-err') }),
      fieldRow({ label: t(locale, 'closures.add.to'), error: keptError(kept, 'to', 'cl-to-err'),
        control: dateParts(locale, 'to', t(locale, 'closures.add.to'), kept, 'cl-to-err') }),
      cardActs(`<button class="btn" type="submit">${esc(t(locale, 'closures.add.button'))}</button>`),
    ] })}</form>`;
  const hoursErr = hours?.error ? `<span class="fielderr" role="alert" id="pf-working_hours-err">${esc(hours.error)}</span>` : undefined;
  const when = setSection({ id: 'hours', title: t(locale, 'biz.now.hours'), rows: [
    fieldRow({ label: t(locale, 'settings.field.workingHours'), forId: 'pf-working_hours', error: hoursErr,
      control: `<input id="pf-working_hours" name="working_hours" value="${esc(hours ? hours.typed : v.workingHours ?? '')}" placeholder="${esc(t(locale, 'settings.workingHours.ph'))}"${hoursErr ? ' aria-invalid="true" aria-describedby="pf-working_hours-err"' : ''} />` }),
    ...(v.zone ? [zoneRow(v.zone, locale)] : []),
  ] });
  return `${pageHead(t(locale, 'settingsArea.hours'), t(locale, 'settingsArea.hoursHint'))}
    ${flashBanner(flash)}
    ${closed}
    ${add}
    ${saveForm(HOURS_PAGE, `${when}${saveActs(locale)}`, { id: 'hours-form' })}`;
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
  /** Phase 9 (V1-535) — the workspace's one currency, named on the price field; absent, the stated policy's. */
  readonly currency?: Currency;
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
      policy, currency: await currencyOf(tx, bid.value),
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
 *
 * Phase 9 of the warmth run (V1-537) — with no delivery term, nothing is
 * allowed to be said: the guard stays as it was. A term allowed before is not
 * taken back here, as choosing a second term never took back the first; what
 * the assistant may say is How you sell's and the guard's to change.
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
    if (v.value.incoterm !== null) {
      await sql`
        insert into claims_policy (business_id, kind, claim_key, allowed)
        values (${bid.value}, 'incoterm', ${v.value.incoterm}, true)
        on conflict (business_id, kind, claim_key) do update set allowed = true, updated_at = now()
      `.execute(tx);
    }
    return { code: 'saved' as const };
  });
}

/**
 * Phase 9 (V1-537, V1-006-terms) — the delivery terms an owner chooses from,
 * each with what it means, in the order of how much the seller takes on. DDU
 * left the Incoterms in 2010 (DAP replaced it): the guard still knows it, so
 * a workspace that chose it keeps it, but it is not offered to anyone new.
 */
export const OFFERED_INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'] as const;
export const incotermMeaning = (locale: Locale, code: string): string =>
  INCOTERM_KEYS.includes(code) ? `${code} — ${t(locale, `terms.incoterm.${code}` as MessageKey)}` : code;

/**
 * Phase 9 of the warmth run (V1-537) — the delivery terms as options, the
 * first being none at all: a shop whose customers collect, or that delivers
 * in its own area, ships under no Incoterm. A workspace that chose DDU keeps it.
 * The terms page and How you sell's payment question draw the same list.
 */
export function incotermOptions(locale: Locale, chosen: string | null): string {
  const choices: readonly string[] = chosen && !(OFFERED_INCOTERMS as readonly string[]).includes(chosen)
    ? [...OFFERED_INCOTERMS, chosen] : OFFERED_INCOTERMS;
  return `<option value=""${chosen === null ? ' selected' : ''}>${esc(t(locale, 'terms.incoterm.none'))}</option>${
    choices.map((k) => `<option value="${esc(k)}"${chosen === k ? ' selected' : ''}>${esc(incotermMeaning(locale, k))}</option>`).join('')}`;
}

/** Where How you sell is drawn, and where the one Save of its terms and samples sections is sent (rule 104). */
export const SELLING_PAGE = '/app/settings/business/selling';

/**
 * THE SETTINGS OVERHAUL (rule 104) — the payment and delivery terms and the sample policy are SECTIONS of How you
 * sell (they were two pages), drawn only where the workspace keeps export settings (`exportSettingsShown()`), and
 * saved by that page's one Save (`POST SELLING_PAGE`). The owner's (price rules): anyone else reads what is stated
 * and that the owner decides. "Never makes them up" and what an unstated policy means stay on the page.
 * `kept`: a refused field, under it, with everything typed kept.
 */
export function sellingTermsSections(terms: TermsView, samples: SamplesView, locale: Locale, viewer: Viewer = OWNER_VIEW, kept: Kept | null = null): string {
  const name = assistantName(locale);
  // V1-537 — payment terms stated alone say so, and what follows from it.
  const statedTerms = terms.terms
    ? `<p class="stated-now">${terms.terms.incoterm ? `<bdi>${esc(terms.terms.incoterm)}</bdi> · ` : ''}<bdi>${esc(terms.terms.paymentTerms)}</bdi></p>
       <p class="muted">${esc(terms.terms.incoterm ? incotermMeaning(locale, terms.terms.incoterm) : t(locale, 'terms.stated.noIncoterm'))}</p>
       <p class="muted">${esc(t(locale, 'terms.setOn', { date: show.date(locale, terms.terms.statedAt) }))}</p>`
    : `<div class="empty notset">${esc(t(locale, 'terms.none', { name }))}</div>`;
  const kept0 = kept?.values['incoterm'];
  const chosen = kept0 !== undefined ? (kept0.trim().toUpperCase() || null) : terms.terms?.incoterm ?? null;
  const termsSec = setSection({ id: 'terms', title: t(locale, 'terms.title'), rows: [
    setNotice({ text: t(locale, 'terms.intro', { name }) }),
    statedTerms,
    ...(viewer.isOwner ? [
      /* Phase 9 (V1-539) — the example is a line under the name, which wraps; a placeholder was cut off on a phone. */ fieldRow({ label: t(locale, 'terms.payment.label'), forId: 'tm-payment', desc: t(locale, 'terms.payment.example'), error: keptError(kept, 'payment', 'tm-payment-err'),
        control: `<input id="tm-payment" name="payment" maxlength="${MAX_PAYMENT_TERMS}"
          value="${kept ? keptValue(kept, 'payment') : terms.terms ? esc(terms.terms.paymentTerms) : ''}"${keptInvalid(kept, 'payment', 'tm-payment-err')} />` }),
      fieldRow({ label: t(locale, 'terms.incoterm.label'), forId: 'tm-incoterm', desc: t(locale, 'terms.incoterm.hint', { name }), error: keptError(kept, 'incoterm', 'tm-incoterm-err'),
        control: `<select id="tm-incoterm" name="incoterm"${keptInvalid(kept, 'incoterm', 'tm-incoterm-err')}>${incotermOptions(locale, chosen)}</select>` }),
    ] : []),
  ] });

  const statedSamples = samples.policy
    ? `<p class="stated-now">${
        isZero(samples.policy.price)
          ? esc(t(locale, 'samples.current.free'))
          : esc(t(locale, 'samples.current.paid', { price: show.money(locale, samples.policy.price) }))
      } <span class="muted">${esc(t(locale, samples.policy.creditedOnFirstOrder
        ? 'samples.current.credited' : 'samples.current.notCredited'))}</span></p>
      <p class="muted">${esc(t(locale, 'samples.setOn', { date: show.date(locale, samples.policy.statedAt) }))}</p>`
    : `<div class="empty notset">${esc(t(locale, 'samples.empty', { name }))}</div>`;
  const currency = samples.currency ?? samples.policy?.price.currency ?? null;
  const credited = kept ? kept.values['credited'] === 'on' : samples.policy?.creditedOnFirstOrder === true;
  const samplesSec = setSection({ id: 'samples', title: t(locale, 'settingsArea.samplesPolicy'), rows: [
    setNotice({ text: t(locale, 'samples.intro', { name }), door: { href: '/app/customers/samples', label: t(locale, 'settingsArea.sampleRequests') } }),
    statedSamples,
    ...(viewer.isOwner ? [
      /* Phase 9 (V1-535) — the price says which money it is in. */ fieldRow({ label: t(locale, 'samples.price.label'), forId: 'sm-price', error: keptError(kept, 'price', 'sm-price-err'),
        desc: currency ? t(locale, 'samples.price.desc', { currency: currencyInLine(locale, currency) }) : t(locale, 'samples.price.free'),
        control: `<input id="sm-price" name="price" inputmode="decimal" value="${kept ? keptValue(kept, 'price') : samples.policy ? esc(String(samples.policy.price.amount)) : ''}"${keptInvalid(kept, 'price', 'sm-price-err')} />` }),
      /* Phase 9 (new-08) — the tick at the start of its column, its label the 44px target. */ fieldRow({ label: t(locale, 'samples.credited.label'), forId: 'sm-credited',
        control: `<span class="chkbox"><input id="sm-credited" type="checkbox" name="credited" ${credited ? 'checked' : ''} /></span>` }),
    ] : []),
  ] });
  return viewer.isOwner
    ? saveForm(SELLING_PAGE, `${termsSec}${samplesSec}${saveActs(locale)}`, { id: 'selling-form' })
    : `${termsSec}${samplesSec}${ownerDecides(locale)}`;
}

/**
 * What the one Save of How you sell's two sections was sent, read as two answers. A section nobody filled and that
 * states nothing yet is not an answer (`null`): the Save is never held up by it. A section sent exactly as it is
 * stated is not one either: stating INSERTS (what was promised in March stays on record), so saying the same thing
 * again would only add a row that says nothing new.
 */
export function sellingAnswers(terms: TermsView, samples: SamplesView, b: Readonly<Record<string, string | undefined>>): {
  readonly terms: { readonly payment: string; readonly incoterm: string } | null;
  readonly samples: { readonly price: string; readonly credited: boolean } | null;
} {
  const payment = String(b['payment'] ?? '').trim(), incoterm = String(b['incoterm'] ?? '').trim().toUpperCase();
  const sameTerms = terms.terms ? payment === terms.terms.paymentTerms && incoterm === (terms.terms.incoterm ?? '') : payment === '' && incoterm === '';
  const price = String(b['price'] ?? '').trim(), credited = b['credited'] === 'on';
  const sameSamples = samples.policy
    ? price === String(samples.policy.price.amount) && credited === samples.policy.creditedOnFirstOrder
    : price === '' && !credited;
  return { terms: sameTerms ? null : { payment, incoterm }, samples: sameSamples ? null : { price, credited } };
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

/**
 * Customers › Sample requests: who is waiting for a sample, oldest first. (What a sample costs is a section of How
 * you sell since rule 104; this page leads there.)
 */
export function renderSampleRequests(v: SamplesView, locale: Locale, flash: Flash | null, now: Date): string {
  const waiting = v.waiting.length === 0
    ? `<div class="empty whole">${esc(t(locale, 'samples.requests.empty'))}</div>`
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
  return `${back('/app/customers', t(locale, 'nav.customers'))}
    <h1 class="page">${esc(t(locale, 'settingsArea.sampleRequests'))}</h1>
    ${flashBanner(flash)}
    <section class="block">
      <h2>${esc(t(locale, 'samples.requests.title'))}</h2>
      ${waiting}
    </section>${deeper('/app/settings/business/selling#samples', t(locale, 'settingsArea.samplesPolicy'))}`;
}
