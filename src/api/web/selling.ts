import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import {
  profileOf, sellingAnswers, SELLING_DEFAULTS, type SellingAnswers, type SellingOverrides, type SellingProfile,
} from '../../core/owner/sellingStyle.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';
import { esc, back } from './layout.js';
import { flashBanner, type Flash } from './flash.js';

/**
 * RT (0095) — "HOW YOU SELL": the owner's own answers over her kind's.
 *
 * Each question starts at what her kind of business usually does (a shop
 * gives the price of one first; a factory asks how many) and she may say
 * otherwise. Money is the owner's (rule 11): the page and its form are
 * `price_rules`. Every answer she gives is written on the business and on the
 * audit trail; the next turn reads it.
 */

/** The questions this page asks, each a column of 0095. */
export const SELLING_FIELDS = ['quantityFirst'] as const satisfies readonly (keyof SellingAnswers)[];
export type SellingField = (typeof SELLING_FIELDS)[number];

const COLUMN: Readonly<Record<keyof SellingAnswers, string>> = { quantityFirst: 'quantity_first' };

export type SellingView = {
  readonly kind: string | null;
  readonly profile: SellingProfile;
  readonly own: SellingOverrides;
  readonly answers: SellingAnswers;
};

export async function loadSelling(db: Db, businessIdRaw: string): Promise<SellingView | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const r = (await sql<{ kind: string | null; quantity_first: boolean | null }>`
      select kind, quantity_first from businesses where id = ${bid.value}`.execute(tx)).rows[0];
    if (!r) return null;
    const own: SellingOverrides = { quantityFirst: r.quantity_first };
    return { kind: r.kind, profile: profileOf(r.kind), own, answers: sellingAnswers(r.kind, own) };
  });
}

/** Her answer to one question; audited once, and only when it changes what is in force or what she stated. */
export async function saveSelling(db: Db, businessIdRaw: string, actor: string, field: string, value: string): Promise<'saved' | 'unchanged' | 'invalid'> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !(SELLING_FIELDS as readonly string[]).includes(field) || (value !== 'yes' && value !== 'no')) return 'invalid';
  const f = field as SellingField;
  const on = value === 'yes';
  return withTenantTx(db, bid.value, async (tx) => {
    const col = sql.ref(COLUMN[f]);
    const before = (await sql<{ v: boolean | null }>`select ${col} as v from businesses where id = ${bid.value} for update`.execute(tx)).rows[0];
    if (!before) return 'invalid' as const;
    if (before.v === on) return 'unchanged' as const;
    await sql`update businesses set ${col} = ${on} where id = ${bid.value}`.execute(tx);
    await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
              values (${bid.value}, null, 'selling_set', ${actor}, ${JSON.stringify({ field: f, from: before.v, to: on })}::jsonb)`.execute(tx);
    return 'saved' as const;
  });
}

export function renderSelling(v: SellingView, locale: Locale, flash: Flash | null): string {
  const name = assistantName(locale);
  const usual = SELLING_DEFAULTS[v.profile];
  const question = (f: SellingField) => {
    const current = v.answers[f];
    const option = (yes: boolean) => {
      const label = t(locale, `selling.${f}.${yes ? 'yes' : 'no'}` as MessageKey, { name });
      const mark = usual[f] === yes ? ` <span class="muted small">${esc(t(locale, `selling.usual.${v.profile}` as MessageKey))}</span>` : '';
      return `<label class="pcheck"><input type="radio" name="value" value="${yes ? 'yes' : 'no'}"${current === yes ? ' checked' : ''} /> <span>${esc(label)}${mark}</span></label>`;
    };
    return `<div class="block">
      <h2>${esc(t(locale, `selling.${f}.q` as MessageKey, { name }))}</h2>
      <form method="post" action="/app/business/selling">
        <input type="hidden" name="field" value="${f}" />
        <fieldset class="choices">${option(false)}${option(true)}</fieldset>
        <p class="muted small">${esc(t(locale, `selling.${f}.hint` as MessageKey, { name }))}</p>
        <button class="btn" type="submit">${esc(t(locale, 'selling.save'))}</button>
      </form>
    </div>`;
  };
  return `<h1 class="page">${esc(t(locale, 'selling.title'))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, 'selling.lede'))}</p>
    ${SELLING_FIELDS.map(question).join('')}
    ${back('/app/business', t(locale, 'selling.back'))}`;
}
