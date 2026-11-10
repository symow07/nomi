import { esc, deeper, conversationUrl, signalMark } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
import { fieldRow } from './rows.js';
import { flashBanner, type Flash } from './flash.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
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

export function renderShopifyOrdersPage(locale: Locale, view: {
  readonly owner: boolean;
  readonly connection: ShopifyConnection | null;
  readonly lookups: readonly LookupRecord[];
  readonly flash: Flash | null;
  readonly refused?: { readonly code: ShopifyConnectRefusal; readonly address: string } | null;
}): string {
  const text = (k: MessageKey, p?: Record<string, string | number>) => esc(t(locale, k, p));
  const c = view.connection;
  const head = `<h1 class="page">${text('shopifyOrders.title')}</h1>${flashBanner(view.flash)}
    <p class="lede">${text('shopifyOrders.lede')}</p><p>${text('shopifyOrders.rule')}</p><p class="caption">${text('shopifyOrders.drafts')}</p>`;
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
  const switchRow = `<section class="block" id="switch"><h2>${text('shopifyOrders.switch.title')}</h2>
    <p><span class="pill${on ? ' ok' : ''}">${text(on ? 'shopifyOrders.switch.on' : 'shopifyOrders.switch.off')}</span></p>
    ${view.owner ? `<form method="post" action="${SHOPIFY_ORDERS_PAGE}/switch" class="inline"><input type="hidden" name="on" value="${on ? '0' : '1'}" />
      <button class="btn${on ? ' ghost' : ' send'}" type="submit">${text(on ? 'shopifyOrders.switch.turnOff' : 'shopifyOrders.switch.turnOn')}</button></form>`
      : `<p class="caption">${text('staff.ownerDecides')}</p>`}</section>`;
  const disconnect = view.owner ? `<form method="post" action="${SHOPIFY_ORDERS_PAGE}/disconnect" class="inline"><button class="btn danger" type="submit"
      onclick="return confirm(this.dataset.confirm)" data-confirm="${text('shopifyOrders.disconnectAsk')}">${text('shopifyOrders.disconnect')}</button></form>` : '';
  return `${head}${state}${switchRow}${lookupList(locale, view.lookups)}${disconnect}`;
}

function lookupList(locale: Locale, rows: readonly LookupRecord[]): string {
  const now = new Date();
  const items = rows.map((r) => {
    const what = r.outcome === 'verified' && r.orderName
      ? t(locale, 'shopifyOrders.outcome.verified', { order: r.orderName })
      : t(locale, `shopifyOrders.outcome.${r.outcome === 'verified' ? 'not_found' : r.outcome}` as MessageKey);
    return `<li class="setrow"><div class="fr-l"><span class="fr-name"><bdi>${esc(what)}</bdi></span><span class="fr-desc">${show.when(locale, r.at, now)}</span></div>
      <div class="fr-c">${deeper(conversationUrl(r.conversationId), t(locale, 'shopifyOrders.lookups.open'))}</div></li>`;
  }).join('');
  return `<section class="block" id="lookups"><h2>${esc(t(locale, 'shopifyOrders.lookups.title'))}</h2>${rows.length === 0
    ? `<p class="muted">${esc(t(locale, 'shopifyOrders.lookups.none'))}</p>` : `<ul class="scard">${items}</ul>`}</section>`;
}

function connectForm(locale: Locale, refused: { readonly code: ShopifyConnectRefusal; readonly address: string } | null): string {
  const text = (k: MessageKey) => esc(t(locale, k));
  const address = refused && /^(?:https:\/\/)?[a-z0-9][a-z0-9-]*\.myshopify\.com\/?$/i.test(refused.address) ? refused.address : '';
  const secret = (field: 'token' | 'client_id' | 'client_secret', key: MessageKey) => fieldRow({
    label: t(locale, key), forId: `shopify-${field}`,
    control: `<input id="shopify-${field}" name="${field}" type="password" value="" autocomplete="off" spellcheck="false" autocapitalize="off" dir="ltr" />`,
  });
  return `<section class="block" id="connect"><h2>${text('shopifyOrders.connect.title')}</h2>
    ${refused ? `<p class="perr" role="alert">${text(REFUSAL_WORDS[refused.code])}</p>` : ''}
    <form method="post" action="${SHOPIFY_ORDERS_PAGE}/connect" class="pform" autocomplete="off">
      ${fieldRow({ label: t(locale, 'storeToken.shop'), forId: 'shopify-address', desc: t(locale, 'storeToken.shop.hint'),
        control: `<input id="shopify-address" name="address" type="text" inputmode="url" dir="ltr" placeholder="myshop.myshopify.com" value="${esc(address)}" />` })}
      <fieldset><legend>${text('storeToken.legacy.legend')}</legend>${secret('token', 'storeToken.token')}</fieldset>
      <p class="st-or">${text('storeToken.or')}</p>
      <fieldset><legend>${text('storeToken.dev.legend')}</legend>${secret('client_id', 'storeToken.clientId')}${secret('client_secret', 'storeToken.clientSecret')}</fieldset>
      <p class="caption">${text('shopifyOrders.connect.needs')}</p>
      <button class="btn send" type="submit">${text('shopifyOrders.connect.save')}</button>
      <p class="caption muted">${text('shopifyOrders.connect.kept')}</p>
    </form></section>`;
}
