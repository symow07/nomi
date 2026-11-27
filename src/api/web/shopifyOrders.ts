import { esc, deeper, conversationUrl, signalMark } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
import { fieldRow } from './rows.js';
import { setNotice, setRow, rowSwitch, dangerZone } from './settingsPage.js';
import { flashBanner, type Flash } from './flash.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { messageLocale, type MessageKey } from '../../core/owner/i18n/messages.js';
import { SHOPIFY_API_VERSION } from '../../core/onboard/shopifyGraphql.js';
import { orderScopes } from '../../core/commerce/shopifyOrders.js';
import type { LookupRecord, ShopifyConnection } from '../../db/shopifyConnections.js';

/**
 * BLOCK 5.5 — "Order questions from Shopify" (0237), `/app/settings/business/shopify`. Anyone signed in reads it; the
 * owner connects, switches and disconnects (`messaging_activation`: it lets the assistant say something new to a
 * customer). Nothing secret is ever drawn: the address, the scopes Shopify granted, the version it answered with, the
 * switch, and the latest lookups (the order's name only when it was verified). English only, like the redesign.
 */
export const SHOPIFY_ORDERS_PAGE = '/app/settings/business/shopify';

export type ShopifyConnectRefusal = 'not_myshopify' | 'choose_one' | 'spaces' | 'credential_refused' | 'scope_missing_read_orders' | 'unavailable';

const REFUSAL_WORDS: Readonly<Record<ShopifyConnectRefusal, MessageKey>> = {
  not_myshopify: 'storeToken.refused.not_myshopify',
  choose_one: 'storeToken.refused.choose_one',
  spaces: 'storeToken.refused.spaces',
  credential_refused: 'shopifyOrders.refused.credential_refused',
  scope_missing_read_orders: 'shopifyOrders.refused.scope_missing_read_orders',
  unavailable: 'shopifyOrders.refused.unavailable',
};

const WRITE_SCOPE = /^write_/;

/**
 * 5.5's words are English only (listed for native review). On a page in another language a sentence that is still the
 * English one is set apart as English, left to right, so on an Arabic page its full stop and brackets stay on its own
 * side (as 5.4's Comments page does). Its figures are already isolated by `t`. Escaped text; never inside an attribute.
 */
export function sayOnPage(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const words = esc(t(locale, key, params));
  return locale !== 'en' && messageLocale(locale, key) === 'en' ? `<bdi lang="en" dir="ltr">${words}</bdi>` : words;
}
/** A door whose label is still the English one is set apart the same way. */
const doorOnPage = (locale: Locale, href: string, key: MessageKey): string =>
  deeper(href, t(locale, key), '', '', locale !== 'en' && messageLocale(locale, key) === 'en' ? 'en' : undefined);

export function renderShopifyOrdersPage(locale: Locale, view: {
  readonly owner: boolean;
  readonly connection: ShopifyConnection | null;
  readonly lookups: readonly LookupRecord[];
  readonly flash: Flash | null;
  readonly refused?: { readonly code: ShopifyConnectRefusal; readonly address: string } | null;
}): string {
  const text = (k: MessageKey, p?: Record<string, string | number>) => sayOnPage(locale, k, p);
  const c = view.connection;
  // Rule 104 — the one template: the title (the menu's label), one line under it, and the two rules about what a
  // customer is told ON the page, each one line beside what it is about.
  const head = `<h1 class="page">${text('side.shopify')}</h1><p class="lede set-lede">${text('shopifyOrders.lede')}</p>${flashBanner(view.flash)}
    ${setNotice({ html: text('shopifyOrders.rule'), id: 'rule' })}${setNotice({ html: text('shopifyOrders.drafts'), id: 'drafts' })}`;
  if (!c) return `${head}<p><span class="pill">${text('shopifyOrders.notConnected')}</span></p>${view.owner ? connectForm(locale, view.refused ?? null) : `<p class="caption">${text('staff.ownerDecides')}</p>`}`;

  const { readsAllOrders } = orderScopes(c.scopes);
  const writes = c.scopes.some((s) => WRITE_SCOPE.test(s));
  const version = c.apiVersionSeen === null ? `<p class="caption">${text('shopifyOrders.version.none')}</p>`
    // A sentence, so the page's state line, never a pill: a pill does not wrap, and ran 862 px wide on a 390 px phone.
    : c.apiVersionSeen !== SHOPIFY_API_VERSION ? `<p class="stateline" role="status">${signalMark('waiting')} ${text('shopifyOrders.version.other', { version: c.apiVersionSeen })}</p>` : '';
  const state = `<p>${text('shopifyOrders.connected', { shop: c.shop.replace(/^https:\/\//, ''), date: show.date(locale, c.connectedAt) })}</p>
    <p class="caption"><bdi lang="en" dir="ltr">${text('shopifyOrders.scopes', { scopes: c.scopes.length ? c.scopes.join(', ') : '—' })}</bdi></p>
    ${readsAllOrders ? '' : `<p class="caption">${text('shopifyOrders.scopes.recent')}</p>`}
    ${writes ? `<p class="caption">${text('shopifyOrders.scopes.write')}</p>` : ''}${version}`;
  const on = c.answerOrders;
  // Rule 104 — the switch is a row that acts at once (the owner's; a colleague reads where it stands).
  const switchRow = `<section class="set-sec" id="switch"><div class="set-rows">${setRow(locale, { label: t(locale, 'shopifyOrders.switch.title'),
    control: view.owner ? rowSwitch(locale, { action: `${SHOPIFY_ORDERS_PAGE}/switch`, on, label: t(locale, 'shopifyOrders.switch.title') })
      : `<span class="pill${on ? ' ok' : ''}">${text(on ? 'shopifyOrders.switch.on' : 'shopifyOrders.switch.off')}</span><p class="caption">${text('staff.ownerDecides')}</p>` })}</div></section>`;
  // Disconnect is the page's danger zone, last, and asks first.
  const danger = dangerZone(locale, view.owner ? [{ title: t(locale, 'side.shopify'), what: t(locale, 'set.shopify.disconnect.what'),
    action: `${SHOPIFY_ORDERS_PAGE}/disconnect`, verb: t(locale, 'shopifyOrders.disconnect'), confirm: t(locale, 'shopifyOrders.disconnectAsk'), id: 'disconnect' }] : []);
  return `${head}<section class="set-sec" id="store">${state}</section>${switchRow}${lookupList(locale, view.lookups)}${danger}`;
}

function lookupList(locale: Locale, rows: readonly LookupRecord[]): string {
  const now = new Date();
  const items = rows.map((r) => {
    const what = r.outcome === 'verified' && r.orderName
      ? sayOnPage(locale, 'shopifyOrders.outcome.verified', { order: r.orderName })
      : sayOnPage(locale, `shopifyOrders.outcome.${r.outcome === 'verified' ? 'not_found' : r.outcome}` as MessageKey);
    return `<li class="setrow"><div class="fr-l"><span class="fr-name"><bdi>${what}</bdi></span><span class="fr-desc">${show.when(locale, r.at, now)}</span></div>
      <div class="fr-c">${doorOnPage(locale, conversationUrl(r.conversationId), 'shopifyOrders.lookups.open')}</div></li>`;
  }).join('');
  return `<section class="set-sec" id="lookups"><h2 class="set-h">${sayOnPage(locale, 'shopifyOrders.lookups.title')}</h2>${rows.length === 0
    ? `<p class="muted">${sayOnPage(locale, 'shopifyOrders.lookups.none')}</p>` : `<ul class="scard">${items}</ul>`}</section>`;
}

function connectForm(locale: Locale, refused: { readonly code: ShopifyConnectRefusal; readonly address: string } | null): string {
  const text = (k: MessageKey) => sayOnPage(locale, k);
  const address = refused && /^(?:https:\/\/)?[a-z0-9][a-z0-9-]*\.myshopify\.com\/?$/i.test(refused.address) ? refused.address : '';
  const secret = (field: 'token' | 'client_id' | 'client_secret', key: MessageKey) => fieldRow({
    label: t(locale, key), forId: `shopify-${field}`,
    control: `<input id="shopify-${field}" name="${field}" type="password" value="" autocomplete="off" spellcheck="false" autocapitalize="off" dir="ltr" />`,
  });
  // Rule 104 — the form's fields wait for its one button (the connect itself, named by its verb), with Cancel
  // beside it; the form is watched (`data-save`), so leaving with something typed asks first.
  return `<section class="set-sec" id="connect"><h2 class="set-h">${text('shopifyOrders.connect.title')}</h2>
    ${refused ? `<p class="perr" role="alert">${text(REFUSAL_WORDS[refused.code])}</p>` : ''}
    <form method="post" action="${SHOPIFY_ORDERS_PAGE}/connect" class="pform set-form" autocomplete="off" data-save>
      ${fieldRow({ label: t(locale, 'storeToken.shop'), forId: 'shopify-address', desc: t(locale, 'storeToken.shop.hint'),
        control: `<input id="shopify-address" name="address" type="text" inputmode="url" dir="ltr" placeholder="myshop.myshopify.com" value="${esc(address)}" />` })}
      <fieldset><legend>${text('storeToken.legacy.legend')}</legend>${secret('token', 'storeToken.token')}</fieldset>
      <p class="st-or">${text('storeToken.or')}</p>
      <fieldset><legend>${text('storeToken.dev.legend')}</legend>${secret('client_id', 'storeToken.clientId')}${secret('client_secret', 'storeToken.clientSecret')}</fieldset>
      <p class="caption">${text('shopifyOrders.connect.needs')}</p>
      <p class="caption muted">${text('shopifyOrders.connect.kept')}</p>
      <div class="set-save"><button class="btn send" type="submit">${text('shopifyOrders.connect.save')}</button><button class="btn" type="reset">${esc(t(locale, 'common.cancel'))}</button></div>
    </form></section>`;
}
