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
import {
  ALERT_CHANNELS, alertChannelFor, defaultAlertChannel, ownerWhatsAppOpen, parseAlertChannel, storedAlertChoice, type AlertChannel,
} from '../../core/owner/alertChannel.js';
import { alertPerson, ownerAlertFacts, saveAlertChoice } from '../../db/alertChannel.js';

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
  /** The warmth run, phase 8 — how notifications reach this person; absent, the page draws the phones alone. */
  readonly ways?: AlertWaysView | null;
};

/**
 * THE WARMTH RUN (2026-10-03), phase 8 — this person's way out of Nomi, as
 * Notifications draws it: what they chose (null: the default), who they are,
 * where an e-mail would go, and where WhatsApp stands for them:
 *   open      the owner's WhatsApp path is open (`ownerWhatsAppOpen`);
 *   review    Meta has not approved Nomi yet — the honest line says so;
 *   number    approved, but no alert number on a live channel;
 *   owner     a colleague: the alert number is the owner's.
 */
export type AlertWaysView = {
  readonly choice: AlertChannel | null;
  readonly isOwner: boolean;
  readonly email: string | null;
  readonly whatsapp: 'open' | 'review' | 'number' | 'owner';
  readonly ownerPhone: string | null;
};

/** What WhatsApp is for this person now. */
const whatsappFor = (isOwner: boolean, approved: boolean, open: boolean): AlertWaysView['whatsapp'] =>
  !isOwner ? 'owner' : open ? 'open' : approved ? 'number' : 'review';

/** This person's way, and the facts it is drawn with. Null: no person row to keep a choice on. */
export async function loadAlertWays(db: Db, businessIdRaw: string, sessionPersonId: string, approved: boolean): Promise<AlertWaysView | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const [person, facts] = await Promise.all([alertPerson(tx, bid.value, sessionPersonId), ownerAlertFacts(tx, bid.value)]);
    if (!person || !facts) return null;
    const open = ownerWhatsAppOpen({ approved, ownerPhone: facts.ownerPhone, channelLive: facts.channelLive });
    return { choice: person.choice, isOwner: person.isOwner, email: person.email,
      whatsapp: whatsappFor(person.isOwner, approved, open), ownerPhone: open ? facts.ownerPhone : null };
  });
}

/**
 * Save the way chosen on Notifications. Refused (false, nothing written) when
 * it is not a way, or not one this person can take now: WhatsApp only for the
 * owner with the path open; Browser only where this installation sends phone
 * alerts. The owner choosing the default stores "the default" (`storedAlertChoice`).
 */
export async function chooseAlertWay(
  db: Db, businessIdRaw: string, sessionPersonId: string, raw: unknown, o: { readonly approved: boolean; readonly pushOn: boolean },
): Promise<AlertChannel | null> {
  const chosen = parseAlertChannel(raw);
  const bid = parseBusinessId(businessIdRaw);
  if (!chosen || !bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const [person, facts] = await Promise.all([alertPerson(tx, bid.value, sessionPersonId), ownerAlertFacts(tx, bid.value)]);
    if (!person || !facts) return null;
    const open = person.isOwner && ownerWhatsAppOpen({ approved: o.approved, ownerPhone: facts.ownerPhone, channelLive: facts.channelLive });
    if ((chosen === 'whatsapp' && !open) || (chosen === 'browser' && !o.pushOn)) return null;
    return await saveAlertChoice(tx, bid.value, person.id, storedAlertChoice(chosen, person.isOwner, open)) ? chosen : null;
  });
}

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

/**
 * THE WARMTH RUN (2026-10-03), phase 8 — the way out, as a choice of three
 * (the radio rows Billing's plans use), each saying where it goes or why it
 * cannot be chosen now, and that e-mail carries anything the way chosen
 * cannot. WhatsApp is shown while it waits for approval, disabled, with one
 * honest line. A colleague who has not chosen hears nothing outside Nomi yet,
 * and the page says so.
 */
/** A way's name: WhatsApp is the platform's own name, as everywhere a channel is named. */
export const alertWayName = (locale: Locale, way: AlertChannel): string =>
  t(locale, way === 'whatsapp' ? 'conv.channel.whatsapp' : way === 'browser' ? 'alerts.way.browser' : 'alerts.way.email');

/** The way checked on the page: the choice, or the owner's default; a colleague who chose nothing has none. */
const checkedWay = (w: AlertWaysView): AlertChannel | null => w.choice ?? (w.isOwner ? defaultAlertChannel(w.whatsapp === 'open') : null);

/** The way a notification would take to this person now (Setup's row says it); null: none reaches them. */
export function alertWayNow(w: AlertWaysView, v: Pick<PhoneAlertsView, 'publicKey' | 'phones'>): AlertChannel | null {
  const checked = checkedWay(w);
  return checked ? alertChannelFor(checked, { whatsapp: w.whatsapp === 'open', browser: v.publicKey !== null && v.phones.length > 0 }) : null;
}

function waysForm(w: AlertWaysView, v: PhoneAlertsView, locale: Locale): string {
  const pushOn = v.publicKey !== null;
  const checked = checkedWay(w);
  const now = alertWayNow(w, v);
  const note: Record<AlertChannel, string> = {
    email: w.email ? t(locale, 'alerts.way.email.to', { email: w.email }) : t(locale, 'alerts.way.email.none'),
    browser: !pushOn ? t(locale, 'alerts.phone.off')
      : v.phones.length ? t(locale, 'alerts.way.browser.on') : t(locale, 'alerts.way.browser.none'),
    whatsapp: w.whatsapp === 'open' ? t(locale, 'alerts.way.whatsapp.to', { phone: w.ownerPhone ?? '' })
      // A colleague's line is said ABOUT the owner: a `staff.*` line, as every such line is.
      : w.whatsapp === 'owner' ? t(locale, 'staff.whatsappAlerts')
      : t(locale, `alerts.way.whatsapp.${w.whatsapp}` as 'alerts.way.whatsapp.review'),
  };
  const can: Record<AlertChannel, boolean> = { email: true, browser: pushOn, whatsapp: w.whatsapp === 'open' };
  const option = (c: AlertChannel) => `<label class="check"><input type="radio" name="channel" value="${c}"${
    checked === c ? ' checked' : ''}${can[c] ? '' : ' disabled'} />
          <span><b>${esc(alertWayName(locale, c))}</b><br><span class="muted">${esc(note[c])}</span></span></label>`;
  // The way chosen cannot carry it now (Browser with no phone on): say what will.
  const instead = checked && now !== checked ? `<p class="fwarn">${esc(t(locale, 'alerts.way.instead'))}</p>` : '';
  return `<section class="block" aria-labelledby="alerts-way">
      <h2 id="alerts-way">${esc(t(locale, 'alerts.way.title'))}</h2>
      ${checked ? '' : `<p class="muted">${esc(t(locale, 'alerts.way.notYet'))}</p>`}
      <form method="post" action="/app/settings/alerts/channel" class="pform">
        <fieldset class="choices ways" aria-labelledby="alerts-way">
        ${ALERT_CHANNELS.map(option).join('')}
        </fieldset>
        ${instead}
        <button class="btn send" type="submit">${esc(t(locale, 'alerts.way.save'))}</button>
        <p class="caption muted">${esc(t(locale, 'alerts.way.fallback'))}</p>
      </form>
    </section>`;
}

/**
 * The Notifications page (it was "Alerts on your phone", G5b): what reaches
 * anyone outside Nomi — the two things, said plainly — how it reaches this
 * person, and the phones and browsers that turned alerts on.
 */
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
  // section says so FIRST, then what it will do.
  // Phase 9 (V1-468) — the way back drawn as on its sibling pages, so the heading sits where theirs does.
  return `${back('/app/settings/setup', t(locale, 'nav.setup'))}
    <h1 class="page">${esc(t(locale, 'alerts.title'))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, 'alerts.lede'))}</p>
    <ul class="two-ways">
      <li>${esc(t(locale, 'alerts.two.order'))}</li>
      <li>${esc(t(locale, 'alerts.two.handover'))}</li>
    </ul>
    <p class="muted measure-prose">${esc(t(locale, 'alerts.rest'))}</p>
    ${v.ways ? waysForm(v.ways, v, locale) : ''}
    <section class="block" aria-labelledby="alerts-phones">
      <h2 id="alerts-phones">${esc(t(locale, 'alerts.phone.title'))}</h2>
      <p class="measure-prose">${esc(t(locale, v.publicKey ? 'alerts.phone.lede' : 'alerts.phone.ledeOff'))}</p>
      ${turnOn}
      ${v.publicKey || v.phones.length ? `<h3>${esc(t(locale, 'alerts.phone.yours'))}</h3>${phones}` : ''}
    </section>`;
}
