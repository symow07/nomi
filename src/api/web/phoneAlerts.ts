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
  ALERT_CHANNELS, alertChannelFor, defaultAlertChannel, ownerWhatsAppDefault, ownerWhatsAppReachable, parseAlertChannel, storedAlertChoice,
  type AlertChannel,
} from '../../core/owner/alertChannel.js';
import { alertPerson, ownerAlertFacts, saveAlertChoice } from '../../db/alertChannel.js';
import { GO } from './icons.js';

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
 *   open      reachable (an alert number on a live channel) and Meta approved
 *             Nomi: WhatsApp may be chosen, and is the default;
 *   early     reachable, not yet approved: it may be chosen (the pilot heard
 *             of hand-overs this way before this page), with one honest line —
 *             a message more than a day after the owner's last one to the
 *             business may not arrive, and e-mail then carries it;
 *   number    not reachable: no alert number, or no live channel;
 *   owner     a colleague: the alert number is the owner's.
 */
export type AlertWaysView = {
  readonly choice: AlertChannel | null;
  readonly isOwner: boolean;
  readonly email: string | null;
  readonly whatsapp: 'open' | 'early' | 'number' | 'owner';
  readonly ownerPhone: string | null;
  /** Meta approved Nomi (the operator's `META_APP_REVIEW`): what the page says of WhatsApp's plan. Absent: not yet. */
  readonly approved?: boolean;
};

/** What WhatsApp is for this person now. */
const whatsappFor = (isOwner: boolean, approved: boolean, reachable: boolean): AlertWaysView['whatsapp'] =>
  !isOwner ? 'owner' : !reachable ? 'number' : approved ? 'open' : 'early';

/** WhatsApp can carry it to this person now (chosen, or the default once approved). */
const whatsappReachableFor = (w: AlertWaysView): boolean => w.whatsapp === 'open' || w.whatsapp === 'early';

/** This person's way, and the facts it is drawn with. Null: no person row to keep a choice on. */
export async function loadAlertWays(db: Db, businessIdRaw: string, sessionPersonId: string, approved: boolean): Promise<AlertWaysView | null> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return null;
  return withTenantTx(db, bid.value, async (tx) => {
    const [person, facts] = await Promise.all([alertPerson(tx, bid.value, sessionPersonId), ownerAlertFacts(tx, bid.value)]);
    if (!person || !facts) return null;
    const reachable = ownerWhatsAppReachable({ ownerPhone: facts.ownerPhone, channelLive: facts.channelLive });
    return { choice: person.choice, isOwner: person.isOwner, email: person.email,
      whatsapp: whatsappFor(person.isOwner, approved, reachable), ownerPhone: reachable ? facts.ownerPhone : null, approved };
  });
}

/**
 * Save the way chosen on Notifications. Refused (null, nothing written) when
 * it is not a way, or not one this person can take now: WhatsApp only for the
 * owner, with an alert number on a live channel (approval or not); Browser only
 * where this installation sends phone alerts. The owner choosing the default
 * stores "the default" (`storedAlertChoice`).
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
    const reachable = person.isOwner && ownerWhatsAppReachable({ ownerPhone: facts.ownerPhone, channelLive: facts.channelLive });
    if ((chosen === 'whatsapp' && !reachable) || (chosen === 'browser' && !o.pushOn)) return null;
    const whatsappDefault = ownerWhatsAppDefault({ approved: o.approved, ownerPhone: facts.ownerPhone, channelLive: facts.channelLive });
    return await saveAlertChoice(tx, bid.value, person.id, storedAlertChoice(chosen, person.isOwner, whatsappDefault)) ? chosen : null;
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

/** A way's name. Arabic writes WhatsApp in its own script here, as every other line of the page does (w4-settings-a-07). */
export const alertWayName = (locale: Locale, way: AlertChannel): string =>
  t(locale, way === 'whatsapp' ? 'alerts.way.whatsapp' : way === 'browser' ? 'alerts.way.browser' : 'alerts.way.email');

/** What can carry a notification to this person now, way by way — the facts `alertChannelFor` is asked with. */
const waysOpen = (w: AlertWaysView, v: Pick<PhoneAlertsView, 'publicKey' | 'phones'>) => ({
  whatsapp: whatsappReachableFor(w), browser: v.publicKey !== null && v.phones.length > 0, approved: w.whatsapp === 'open', email: w.email !== null,
});

/** The way wanted: the choice, or the owner's default; a colleague who chose nothing wants none. */
const wantedWay = (w: AlertWaysView): AlertChannel | null => w.choice ?? (w.isOwner ? defaultAlertChannel(w.whatsapp === 'open') : null);

/**
 * The way a notification would take to this person now — the one the sender
 * takes (`reachPeople` asks `alertChannelFor` the same) — and the one the page
 * ticks and Setup's row names. Null: nothing reaches them.
 */
export function alertWayNow(w: AlertWaysView, v: Pick<PhoneAlertsView, 'publicKey' | 'phones'>): AlertChannel | null {
  const wanted = wantedWay(w);
  return wanted ? alertChannelFor(wanted, waysOpen(w, v)) : null;
}

/** Where the page was opened from, for its way back: Setup, or the channels screen's Notifications card (w4-settings-a-10). */
export type AlertsFrom = 'setup' | 'channels';
export const alertsFrom = (raw: unknown): AlertsFrom => (raw === 'channels' ? 'channels' : 'setup');

/**
 * THE WARMTH RUN (2026-10-03), phase 8; phase 9 (w4-settings-a-01, -02, -03,
 * -09, settings-a-new-06) — the way out, as a card of three rows, each saying
 * where it goes or what it needs.
 *   · The way TICKED is the way a notification takes now. A way that cannot
 *     reach this person is never ticked: e-mail without an address is shown
 *     disabled, and when nothing reaches them the page says so first.
 *   · A choice that cannot be used now (a phone or computer with none turned
 *     on) is named, with what carries them meanwhile.
 *   · WhatsApp says what the owner's plan rests on: it is the way Nomi means
 *     to reach them, and the default the day Meta approves Nomi.
 *   · Save is drawn only where there is something to choose.
 */
function waysForm(w: AlertWaysView, v: PhoneAlertsView, locale: Locale, from: AlertsFrom): string {
  const pushOn = v.publicKey !== null;
  const now = alertWayNow(w, v);
  const wanted = wantedWay(w);
  const can: Record<AlertChannel, boolean> = { email: w.email !== null, browser: pushOn, whatsapp: whatsappReachableFor(w) };
  const reach = `<a class="way-door" href="/app/channels/alerts">${esc(t(locale, 'channels.alerts.title'))}${GO}</a>`;
  const note: Record<AlertChannel, string> = {
    email: esc(w.email ? t(locale, 'alerts.way.email.to', { email: w.email }) : t(locale, 'alerts.way.email.none')),
    browser: esc(!pushOn ? t(locale, 'alerts.phone.off')
      : v.phones.length ? t(locale, 'alerts.way.browser.on') : t(locale, 'alerts.way.browser.none')),
    whatsapp: whatsappReachableFor(w) ? esc(t(locale, 'alerts.way.whatsapp.to', { phone: w.ownerPhone ?? '' }))
      // A colleague's line is said ABOUT the owner: a `staff.*` line, as every such line is.
      : w.whatsapp === 'owner' ? esc(t(locale, 'staff.whatsappAlerts'))
      // (w4-settings-a-03) what it needs, in the code's own condition, and the door to where both are set.
      : `${esc(t(locale, 'alerts.way.whatsapp.number'))}</span><span class="way-d">${reach}`,
  };
  // The owner's plan: WhatsApp is the intended way, the default the day Meta approves Nomi (w4-settings-a-01).
  const plan = !w.isOwner || w.whatsapp === 'open' ? ''
    : `<span class="way-d">${esc(t(locale, w.approved ? 'alerts.way.whatsapp.planApproved' : 'alerts.way.whatsapp.plan'))}</span>`;
  // Before approval WhatsApp may still be chosen where it is reachable, with the one honest line.
  const early = w.whatsapp === 'early' ? `<span class="way-d">${esc(t(locale, 'alerts.way.whatsapp.early'))}</span>` : '';
  const option = (c: AlertChannel) => `<label class="way"><input type="radio" name="channel" value="${c}"${
    now === c ? ' checked' : ''}${can[c] ? '' : ' disabled'} />
          <span class="way-t"><span class="way-n">${esc(alertWayName(locale, c))}</span><span class="way-d">${note[c]}</span>${
            c === 'whatsapp' ? `${early}${plan}` : ''}</span></label>`;
  const choosable = ALERT_CHANNELS.filter((c) => can[c]);
  // Nothing reaches them: said first, plainly — and whether a way can be chosen here or must be added.
  const none = now !== null ? ''
    : `<p class="ways-none">${esc(t(locale, choosable.length ? 'alerts.way.notYet' : 'alerts.way.nothing'))}</p>`;
  // The way chosen cannot carry them now (a phone or computer with none on): named, and what carries them meanwhile.
  const instead = wanted && now !== null && now !== wanted
    ? `<p class="way-foot">${esc(t(locale, 'alerts.way.instead', { way: alertWayName(locale, wanted) }))}</p>` : '';
  // E-mail as the floor, said only where there is an address and another way could be the one chosen.
  const floor = can.email && (can.browser || can.whatsapp) ? `<p class="way-foot">${esc(t(locale, 'alerts.way.fallback'))}</p>` : '';
  const save = choosable.length > 1 || (choosable.length === 1 && now !== choosable[0])
    ? `<div class="fr-acts"><button class="btn send" type="submit">${esc(t(locale, 'alerts.way.save'))}</button></div>` : '';
  const card = `<fieldset class="scard ways" aria-labelledby="alerts-way">
        ${ALERT_CHANNELS.map(option).join('')}
        ${instead}${floor}${save}
        </fieldset>`;
  // The fix wave (the surface walk) — with nothing to choose there is no Save, so no form either:
  // a form nothing can send is a dead control.
  return `<section class="sgroup" aria-labelledby="alerts-way">
      <h2 class="sgroup-h" id="alerts-way">${esc(t(locale, 'alerts.way.title'))}</h2>
      ${none}
      ${save ? `<form method="post" action="/app/settings/alerts/channel">
        ${from === 'channels' ? '<input type="hidden" name="from" value="channels" />' : ''}
        ${card}
      </form>` : card}
    </section>`;
}

/**
 * The Notifications page (it was "Alerts on your phone", G5b): what reaches
 * anyone outside Nomi — the two things, said plainly — how it reaches this
 * person, and the phones and computers that turned notifications on.
 * Phase 9 of the warmth run: one name for one thing (w4-settings-a-06), the
 * e-mails that come whatever the way (w4-settings-a-05), and where phone
 * notifications are not offered here, the way's own line says so and no
 * empty section repeats it (w4-settings-a-08).
 */
export function renderPhoneAlerts(v: PhoneAlertsView, locale: Locale, flash: Flash | null, from: AlertsFrom = 'setup'): string {
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
  // Owners with an address hear two things by e-mail whatever the way (rule 18; the account's letters).
  const also = v.ways?.isOwner && v.ways.email ? `<p class="ways-sub">${esc(t(locale, 'alerts.alsoMail'))}</p>` : '';
  const devices = v.publicKey || v.phones.length ? `<section class="sgroup" aria-labelledby="alerts-phones">
      <h2 class="sgroup-h" id="alerts-phones">${esc(t(locale, 'alerts.phone.title'))}</h2>
      <p class="ways-sub">${esc(t(locale, 'alerts.phone.lede'))}</p>
      ${turnOn}
      ${phones}
    </section>` : '';
  // Phase 9 (V1-468) — the way back drawn as on its sibling pages, so the heading sits where theirs does;
  // (w4-settings-a-10) to the screen it was opened from.
  const way = from === 'channels'
    ? back('/app/channels/alerts', t(locale, 'channels.alerts.title'))
    : back('/app/settings/setup', t(locale, 'nav.setup'));
  return `${way}
    <h1 class="page">${esc(t(locale, 'alerts.title'))}</h1>
    ${flashBanner(flash)}
    <p class="lede">${esc(t(locale, 'alerts.lede'))}</p>
    <ul class="two-ways">
      <li>${esc(t(locale, 'alerts.two.order'))}</li>
      <li>${esc(t(locale, 'alerts.two.handover'))}</li>
    </ul>
    <p class="ways-sub">${esc(t(locale, 'alerts.rest'))}</p>
    ${also}
    ${v.ways ? waysForm(v.ways, v, locale, from) : ''}
    ${devices}`;
}
