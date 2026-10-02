import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { livePhones, savePhone, archivePhone, markPhoneSent, readSubscription, type PhoneSubscription } from '../../db/pushSubscriptions.js';
import { sendPush, type VapidKeys, type PushFetch } from '../../net/webPush.js';
import { t } from './say.js';
import { esc, back } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import { fieldRow, rowsCard } from './rows.js';
import * as show from './values.js';

/**
 * G5b — "Alerts on your phone": the page a person turns them on from. Anyone
 * who signs in may (an alert is about a customer waiting, and staff answer
 * customers too); each sees and stops their own phones. The button is drawn
 * hidden and the page's script shows it where the browser can take alerts;
 * with scripting off, or a browser that cannot, the page says what to do.
 */

export type PushOut = { readonly keys: VapidKeys; readonly fetch: PushFetch };

export type PhoneAlertsView = {
  /** The installation's public key, when phone alerts are on here. */
  readonly publicKey: string | null;
  readonly phones: readonly PhoneSubscription[];
};

export async function loadPhoneAlerts(db: Db, businessIdRaw: string, personId: string | null, push: PushOut | null): Promise<PhoneAlertsView> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { publicKey: null, phones: [] };
  return { publicKey: push?.keys.publicKey ?? null, phones: await withTenantTx(db, bid.value, (tx) => livePhones(tx, bid.value, personId)) };
}

export async function addPhone(db: Db, businessIdRaw: string, personId: string | null, raw: string, device: string): Promise<boolean> {
  const bid = parseBusinessId(businessIdRaw);
  const sub = readSubscription(raw);
  if (!bid.ok || !sub) return false;
  const label = device.trim().slice(0, 120) || null;
  await withTenantTx(db, bid.value, (tx) => savePhone(tx, bid.value, personId, sub, label));
  return true;
}

export async function removePhone(db: Db, businessIdRaw: string, personId: string | null, id: string): Promise<boolean> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  return withTenantTx(db, bid.value, (tx) => archivePhone(tx, bid.value, id, 'removed', personId));
}

/** A test alert to this person's phones; how many it reached. */
export async function testPhones(db: Db, businessIdRaw: string, personId: string | null, push: PushOut, locale: Locale): Promise<number> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return 0;
  const phones = await withTenantTx(db, bid.value, (tx) => livePhones(tx, bid.value, personId));
  let reached = 0;
  for (const p of phones) {
    // The title is the product's name, the same in every language.
    const r = await sendPush(p, { title: 'Nomi', body: t(locale, 'alerts.phone.testBody'), url: '/app' }, push.keys, push.fetch);
    if (r.kind === 'sent') { reached++; await withTenantTx(db, bid.value, (tx) => markPhoneSent(tx, p.id)); }
    else if (r.kind === 'gone') await withTenantTx(db, bid.value, (tx) => archivePhone(tx, bid.value, p.id, 'gone'));
  }
  return reached;
}

export function renderPhoneAlerts(v: PhoneAlertsView, locale: Locale, flash: Flash | null): string {
  // Phase 9 (settings-a-new-06) — the phones as the settings pages' rows, in a card;
  // (settings-a-new-04) none yet says where to turn them on.
  const phones = v.phones.length === 0
    ? `<div class="empty whole">${esc(t(locale, 'alerts.phone.none'))}</div>`
    : `${rowsCard(null, v.phones.map((p) => fieldRow({
        label: p.device ?? t(locale, 'alerts.phone.unknownDevice'),
        desc: t(locale, 'alerts.phone.since', { date: show.date(locale, p.createdAt) }),
        control: `<form method="post" action="/app/settings/alerts/phone/${esc(p.id)}/remove" class="inline">
          <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)"
                  data-confirm="${esc(t(locale, 'alerts.phone.removeConfirm'))}">${esc(t(locale, 'alerts.phone.remove'))}</button></form>` })))}
      <form method="post" action="/app/settings/alerts/test"><button class="btn" type="submit">${esc(t(locale, 'alerts.phone.test'))}</button></form>`;
  const turnOn = v.publicKey
    ? `<button class="btn send" type="button" hidden data-push-key="${esc(v.publicKey)}" data-push-save="/app/settings/alerts/phone">${esc(t(locale, 'alerts.phone.turnOn'))}</button>
       <p class="fwarn" hidden data-push-cannot>${esc(t(locale, 'alerts.phone.cannot'))}</p>
       <p class="perr" role="alert" hidden data-push-failed>${esc(t(locale, 'alerts.phone.failed'))}</p>
       <p class="caption muted">${esc(t(locale, 'alerts.phone.iphone'))}</p>`
    : '';
  // Phase 9 (settings-a-missed-03) — with no way to send an alert here, the
  // page says so FIRST, then what it will do; it promised "your phone shows
  // it" above a grey "not available here yet", over an empty list of phones.
  // Phase 9 (V1-468) — the way back drawn as on its sibling pages, so the heading sits where theirs does.
  return `${back('/app/settings', t(locale, 'nav.settings'))}
    <h1 class="page">${esc(t(locale, 'alerts.phone.title'))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, v.publicKey ? 'alerts.phone.lede' : 'alerts.phone.ledeOff'))}</p>
    ${turnOn ? `<section class="block">${turnOn}</section>` : ''}
    ${v.publicKey || v.phones.length ? `<section class="block"><h2>${esc(t(locale, 'alerts.phone.yours'))}</h2>${phones}</section>` : ''}`;
}
