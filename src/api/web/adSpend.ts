import { type Locale } from '../../core/owner/i18n/locale.js';
import { t } from './say.js';
import { esc, deeper } from './layout.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import * as show from './values.js';
import { CHANNEL_OF, isNamedPlatform, monthDays, nextReadDue } from '../../core/ads/spend.js';
import type { AdConnection, LastRead, MonthComparison } from '../../db/adSpend.js';
import type { AdAccount } from '../../channels/meta/adSpend.js';

/**
 * 0238 — the Results card: ad spend beside the orders from the same channel's conversations, one month, the
 * account's days. The owner's only; staff are told so and shown no figure. Nothing is drawn where the
 * installation has no ads login.
 */

export type AdSpendView =
  | { readonly kind: 'staff' }
  | { readonly kind: 'off' }
  | {
    readonly kind: 'on'; readonly connection: AdConnection; readonly workspaceZone: string;
    readonly months: readonly string[]; readonly month: string; readonly comparison: MonthComparison | null;
    /** The newest read that finished; `openRead`, when the newest read started and has not finished. */
    readonly lastRead: LastRead | null; readonly openRead?: Date | null; readonly now: Date;
  };

const PLACE_KEY = { instagram: 'adSpend.place.instagram', facebook: 'adSpend.place.facebook', messenger: 'adSpend.place.messenger' } as const satisfies Record<string, MessageKey>;
const ORDERS_KEY = { instagram: 'adSpend.orders.instagram', messenger: 'adSpend.orders.messenger' } as const satisfies Record<string, MessageKey>;
const READ_KEY = { incomplete: 'adSpend.read.incomplete', throttled: 'adSpend.read.throttled', failed: 'adSpend.read.failed' } as const satisfies Record<string, MessageKey>;

/** A placement by its name, or "Other placements: {value}" exactly as Meta sent it. */
export function placeName(locale: Locale, platform: string): string {
  return isNamedPlatform(platform) ? t(locale, PLACE_KEY[platform]) : t(locale, 'adSpend.place.other', { platform });
}

/** `?ads=YYYY-MM.<platform>` — the month and the placement a "Record as a cost" door names, or null. */
export function adsAsked(raw: unknown): { readonly month: string; readonly platform: string } | null {
  if (typeof raw !== 'string') return null;
  const m = /^([0-9]{4}-[0-9]{2})\.(.{1,80})$/su.exec(raw);
  if (!m || !monthDays(m[1]!) || /[\u0000-\u001f\u007f]/u.test(m[2]!)) return null;
  return { month: m[1]!, platform: m[2]! };
}

const figure = (locale: Locale, amount: string, currency: string): string => show.isolate(locale, `${currency} ${amount}`);

export function renderAdSpendCard(locale: Locale, v: AdSpendView): string {
  const head = `<h2 id="ad-spend-h">${esc(t(locale, 'adSpend.title'))}</h2>`;
  const wrap = (body: string) => `<section class="results-section" id="ad-spend" aria-labelledby="ad-spend-h">${head}${body}</section>`;
  if (v.kind === 'staff') return wrap(`<p class="muted">${esc(t(locale, 'adSpend.staff'))}</p>`);
  if (v.kind === 'off') {
    return wrap(`<p class="muted">${esc(t(locale, 'adSpend.off'))}</p>
      <form method="get" action="/app/connect/meta-ads/start"><button type="submit" class="btn">${esc(t(locale, 'adSpend.turnOn'))}</button></form>`);
  }
  const c = v.connection;
  const parts: string[] = [];
  parts.push(`<p>${esc(t(locale, 'adSpend.account', { name: c.name || c.adAccountId, currency: c.currency }))}</p>`);
  if (c.state !== 'active') {
    parts.push(`<p role="status">${esc(t(locale, c.state === 'refused' ? 'adSpend.state.refused' : 'adSpend.state.permission'))}</p>
      <form method="get" action="/app/connect/meta-ads/start"><button type="submit" class="btn">${esc(t(locale, 'adSpend.reconnect'))}</button></form>`);
  }
  if (v.lastRead) {
    parts.push(`<p class="caption muted">${esc(t(locale, 'adSpend.lastRead', { when: show.when(locale, v.lastRead.at, v.now) }))}</p>`);
    const o = v.lastRead.outcome;
    if (o === 'incomplete' || o === 'throttled' || o === 'failed') parts.push(`<p class="caption muted">${esc(t(locale, READ_KEY[o]))}</p>`);
  }
  if (v.openRead) {
    // A read with no end is not a read: it is said as started and not finished, and when the next one is due (a
    // connection is read once a UTC day, so not before the next day's run). Only an active connection is read.
    const open = esc(t(locale, 'adSpend.read.open', { when: show.when(locale, v.openRead, v.now) }));
    const next = c.state === 'active' ? ` ${esc(t(locale, 'adSpend.read.next', { when: show.until(locale, nextReadDue(v.openRead, v.now), v.now) }))}` : '';
    parts.push(`<p class="caption muted">${open}${next}</p>`);
  }
  if (c.timezone !== v.workspaceZone) {
    parts.push(`<p class="caption">${esc(t(locale, 'adSpend.zone', { zone: c.timezone, workspace: v.workspaceZone }))}</p>`);
  }
  const months = v.months.includes(v.month) ? v.months : [v.month, ...v.months];
  parts.push(`<form method="get" action="/app/results#ad-spend"><label>${esc(t(locale, 'adSpend.month'))}
      <select name="month">${months.map((m) => `<option value="${esc(m)}"${m === v.month ? ' selected' : ''}>${esc(show.month(locale, `${m}-01`))}</option>`).join('')}</select></label>
      <button type="submit" class="btn ghost">${esc(t(locale, 'adSpend.show'))}</button></form>`);
  parts.push(`<p class="caption">${esc(t(locale, 'adSpend.label'))}</p><p class="caption muted">${esc(t(locale, 'adSpend.estimated'))}</p>`);
  const cmp = v.comparison;
  if (!cmp || cmp.spend.length === 0) {
    parts.push(`<p class="muted">${esc(t(locale, 'adSpend.none'))}</p>`);
  } else {
    const ordersOf = (ch: 'instagram' | 'messenger') => cmp.orders.find((o) => o.channel === ch)!;
    const rows = cmp.spend.map((s) => {
      const named = isNamedPlatform(s.platform);
      const label = placeName(locale, s.platform);
      const ch = named ? CHANNEL_OF[s.platform] : null;
      let orders: string;
      if (ch) {
        const o = ordersOf(ch);
        orders = `<div class="result-row"><dt>${esc(t(locale, ORDERS_KEY[ch]))}</dt><dd>${o.count === 0 ? esc(t(locale, 'adSpend.orders.none'))
          : `${esc(t(locale, 'adSpend.orders.count', { count: show.count(locale, o.count) }))}${o.totals.map((x) => ` · ${esc(figure(locale, x.value, x.currency))}`).join('')}`}</dd></div>`;
      } else {
        orders = `<p class="caption muted">${esc(t(locale, s.platform === 'facebook' ? 'adSpend.facebookNote' : 'adSpend.otherNote'))}</p>`;
      }
      const recorded = cmp.recorded.has(s.platform);
      const offer = recorded ? `<p class="caption">${esc(t(locale, 'adSpend.recorded'))}</p>`
        : `<p>${deeper(`/app/books/spending?ads=${encodeURIComponent(`${cmp.month}.${s.platform}`)}#bill`, t(locale, 'adSpend.record'))}</p>`;
      return `<div><h3>${esc(label)}</h3><dl class="result-rows">
        <div class="result-row"><dt>${esc(t(locale, 'adSpend.spent'))}</dt><dd>${esc(figure(locale, s.amount, s.currency))}</dd></div>${ch ? orders : ''}</dl>${ch ? '' : orders}${offer}</div>`;
    });
    parts.push(rows.join(''));
  }
  parts.push(`<form method="post" action="/app/connect/meta-ads/disconnect">
    <button type="submit" class="btn ghost" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'adSpend.disconnectAsk'))}">${esc(t(locale, 'adSpend.disconnect'))}</button></form>`);
  return wrap(parts.join(''));
}

/** The one choice: which ad account. The token travels in the signed, encrypted state, never in the page. */
export function renderAdAccountPicker(accounts: readonly AdAccount[], state: string, locale: Locale): string {
  return `<h1 class="page">${esc(t(locale, 'adSpend.choose.title'))}</h1><p class="muted">${esc(t(locale, 'adSpend.choose.lede'))}</p>
    <div class="rows">${accounts.map((a) => `<form method="post" action="/app/connect/meta-ads/choose" class="row">
      <input type="hidden" name="state" value="${esc(state)}"><input type="hidden" name="account_id" value="${esc(a.accountId)}">
      <div><strong><bdi>${esc(a.name || a.accountId)}</bdi></strong>
      <p class="caption muted">${esc(t(locale, 'adSpend.choose.zone', { currency: a.currency, zone: a.timezone }))}</p></div>
      <button type="submit" class="btn">${esc(t(locale, 'adSpend.choose.use'))}</button></form>`).join('')}</div>`;
}

/** `?month=YYYY-MM` when it is a real month, else the account's current month. */
export function chosenMonth(asked: unknown, todayInAccount: string): string {
  return typeof asked === 'string' && monthDays(asked) ? asked : todayInAccount.slice(0, 7);
}
