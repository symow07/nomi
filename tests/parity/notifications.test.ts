import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ALERT_CHANNELS, alertChannelFor, defaultAlertChannel, ownerWhatsAppReachable, ownerWhatsAppDefault, parseAlertChannel, storedAlertChoice,
} from '../../src/core/owner/alertChannel.js';
import {
  reachPeople, deliverOwnerAlert, interrupts, waitsInApp, goesByMail, INTERRUPTION_KINDS, QUIET_KINDS, OPERATOR_ALERT_KINDS,
  type InterruptionWays, type WayResult,
} from '../../src/pipeline/notify.js';
import type { InterruptionPerson } from '../../src/db/alertChannel.js';
import type { PhoneSubscription } from '../../src/db/pushSubscriptions.js';
import { renderPhoneAlerts, alertWayNow, type AlertWaysView, type PhoneAlertsView } from '../../src/api/web/phoneAlerts.js';
import { renderSetup } from '../../src/api/web/settings.js';
import { railSaid, railRose, isRailMark, todayWatch, conversationWatch } from '../../src/api/web/live.js';
import { liveRegion } from '../../src/api/web/flash.js';
import { shell, conversationUrl, esc } from '../../src/api/web/layout.js';
import { withWorkspace, tn, type RequestScope } from '../../src/api/web/say.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { REQUIRED_SCHEMA_VERSION } from '../../src/db/schemaVersion.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE WARMTH RUN (2026-10-03), PHASE 8 — NOTIFICATIONS.
 *
 * The owner: "Only two things may interrupt the owner outside the app: an
 * order waiting for their tap, and a conversation the assistant handed over
 * because it could not handle it. Everything else waits quietly in-app." And:
 * "build the delivery channel as a setting, not a hardcoded path … WhatsApp is
 * the intended primary and becomes the default the moment Meta approval lands
 * — design it so switching is a setting change, not a rebuild."
 *
 * Held here without a database: the default and the choice; the one delivery
 * function's choice of way and its fall back to e-mail, with fakes; the
 * migration; the Notifications page and Setup's row; the rail's answer and the
 * slot every page draws. The script itself: `notifications-live.test.ts`.
 */

const NOW = new Date('2026-10-03T09:00:00Z');
const PHONE: PhoneSubscription = {
  id: '11111111-1111-4111-8111-111111111111', personId: null, endpoint: 'https://push.example/x',
  p256dh: 'p', auth: 'a', device: 'iPhone', createdAt: NOW,
};

describe('the default and the choice', () => {
  const combos = function* () {
    for (const approved of [false, true]) for (const ownerPhone of [null, '+971500000000']) for (const channelLive of [false, true]) {
      yield { approved, ownerPhone, channelLive };
    }
  };

  it('WhatsApp is CHOOSABLE wherever the owner\'s path is reachable today — a number on a live channel — approval or not', () => {
    for (const f of combos()) expect(ownerWhatsAppReachable(f), JSON.stringify(f)).toBe(f.ownerPhone !== null && f.channelLive);
  });

  it('WhatsApp is the DEFAULT only when it is reachable AND Meta approved Nomi', () => {
    for (const f of combos()) expect(ownerWhatsAppDefault(f), JSON.stringify(f)).toBe(f.approved && f.ownerPhone !== null && f.channelLive);
    expect(defaultAlertChannel(true)).toBe('whatsapp');
    expect(defaultAlertChannel(false)).toBe('email');
  });

  it('the way a notification takes: the choice, or the default; e-mail when that way cannot be used now', () => {
    const none = { whatsapp: false, browser: false, approved: false };
    const all = { whatsapp: true, browser: true, approved: true };
    // the default follows approval, with nothing stored
    expect(alertChannelFor(null, none)).toBe('email');
    expect(alertChannelFor(null, { whatsapp: true, browser: false, approved: false })).toBe('email');   // reachable, not approved
    expect(alertChannelFor(null, { whatsapp: true, browser: false, approved: true })).toBe('whatsapp');
    expect(alertChannelFor(null, { whatsapp: false, browser: false, approved: true })).toBe('email');   // approved, not reachable
    // a choice is kept while it can be used — WhatsApp before approval too, where reachable…
    expect(alertChannelFor('email', all)).toBe('email');
    expect(alertChannelFor('browser', all)).toBe('browser');
    expect(alertChannelFor('whatsapp', all)).toBe('whatsapp');
    expect(alertChannelFor('whatsapp', { whatsapp: true, browser: false, approved: false })).toBe('whatsapp');
    // …and is e-mail while it cannot: Browser with no phone on, WhatsApp with no number on a live channel
    expect(alertChannelFor('browser', { whatsapp: true, browser: false, approved: true })).toBe('email');
    expect(alertChannelFor('whatsapp', { whatsapp: false, browser: true, approved: true })).toBe('email');
    // Phase 9 (w4-settings-a-02) — with no address, e-mail is no floor: nothing reaches them, and it says so.
    const noMail = { whatsapp: false, browser: false, approved: false, email: false };
    expect(alertChannelFor(null, noMail)).toBeNull();
    expect(alertChannelFor('email', noMail)).toBeNull();
    expect(alertChannelFor('browser', noMail)).toBeNull();
    expect(alertChannelFor('whatsapp', { ...noMail, whatsapp: true })).toBe('whatsapp');
    expect(alertChannelFor(null, { ...noMail, whatsapp: true, approved: true })).toBe('whatsapp');
    // the default before approval is e-mail, which cannot reach them: nothing, until they choose WhatsApp
    expect(alertChannelFor(null, { ...noMail, whatsapp: true })).toBeNull();
  });

  it('what is stored: the choice, or NULL when the owner chose what is the default now', () => {
    const reachableEarly = { whatsapp: true, browser: false, approved: false };
    const reachableApproved = { ...reachableEarly, approved: true };
    // Before approval the default is e-mail: an owner who picks e-mail is "the default"…
    expect(storedAlertChoice('email', true, false)).toBeNull();
    // …and moves to WhatsApp the day approval lands, with nothing written.
    expect(alertChannelFor(storedAlertChoice('email', true, false), reachableEarly)).toBe('email');
    expect(alertChannelFor(storedAlertChoice('email', true, false), reachableApproved)).toBe('whatsapp');
    // An owner who picks WhatsApp before approval stores it, and hears by WhatsApp now.
    expect(storedAlertChoice('whatsapp', true, false)).toBe('whatsapp');
    expect(alertChannelFor('whatsapp', reachableEarly)).toBe('whatsapp');
    expect(storedAlertChoice('browser', true, false)).toBe('browser');
    // After approval: WhatsApp is the default; e-mail is a choice, and it stays e-mail.
    expect(storedAlertChoice('whatsapp', true, true)).toBeNull();
    expect(storedAlertChoice('email', true, true)).toBe('email');
    expect(alertChannelFor('email', reachableApproved)).toBe('email');
    // A colleague's choice is stored as made: choosing is how they ask for notifications at all.
    expect(storedAlertChoice('email', false, false)).toBe('email');
  });

  it('only the three ways are read; anything else is nothing', () => {
    expect(ALERT_CHANNELS).toEqual(['email', 'browser', 'whatsapp']);
    for (const w of ALERT_CHANNELS) expect(parseAlertChannel(w)).toBe(w);
    for (const bad of ['', 'sms', 'EMAIL', 'push', null, undefined, 3, ['email']]) expect(parseAlertChannel(bad), String(bad)).toBeNull();
  });
});

describe('only two things leave Nomi', () => {
  it('an order waiting, and a hand-over — a deletion request among them, with its own words', () => {
    expect([...INTERRUPTION_KINDS].sort()).toEqual(['deletion_requested', 'handoff', 'order_proposed']);
    for (const k of INTERRUPTION_KINDS) {
      expect(interrupts(k), k).toBe(true);
      expect(goesByMail(k), k).toBe(false);
      expect(waitsInApp(k), k).toBe(false);
    }
  });

  it('everything else that used to reach the owner waits in the app; the operator\'s alerts are as they were', () => {
    expect([...QUIET_KINDS].sort()).toEqual(['allowance_reached', 'allowance_warn', 'dead_letter', 'delivery_failed', 'draft_waiting', 'hot_lead', 'self_demoted']);
    for (const k of QUIET_KINDS) {
      expect(waitsInApp(k), k).toBe(true);
      expect(interrupts(k), k).toBe(false);
      expect(goesByMail(k), k).toBe(false);
    }
    for (const k of OPERATOR_ALERT_KINDS) expect(goesByMail(k), k).toBe(true);
  });

  it('every kind a job can carry is one of the three, and no kind is two of them', () => {
    const boss = readFileSync(new URL('../../src/queue/boss.ts', import.meta.url), 'utf8');
    const union = /kind: ('[a-z_]+'(?:\s*\|\s*'[a-z_]+')*);/.exec(boss.replace(/\n\s*\|/g, ' |'))![1]!;
    const kinds = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]! as Parameters<typeof interrupts>[0]);
    expect(kinds.length).toBeGreaterThan(20);
    for (const k of kinds) {
      expect([goesByMail(k), interrupts(k), waitsInApp(k)].filter(Boolean), k).toHaveLength(1);
    }
  });

  it('a quiet kind is consumed and dropped where every alert is delivered — after Practice is asked, before any way out', async () => {
    const src = readFileSync(new URL('../../src/pipeline/notify.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function deliverOwnerAlert('), src.indexOf('/** Every kind is classified'));
    expect(body.indexOf('isPracticeCopy')).toBeLessThan(body.indexOf("if (waitsInApp(job.kind)) return 'skipped_quiet';"));
    expect(body.indexOf('waitsInApp(job.kind)')).toBeLessThan(body.indexOf('goesByMail(job.kind)'));
    expect(body).toMatch(/return deliverOwnerInterruption\(deps, bid\.value, job\);\n\}/);
    // …and the type that proves every kind is one of the three is there, and compiles only while it is true.
    expect(src).toContain("const everyKindClassified: [Unclassified] extends [never] ? true : false = true;");
    // A job that names no business is nowhere to go, before anything is read.
    expect(await deliverOwnerAlert({ db: {} as never, adapter: { sendText: async () => ({ ok: true as const, providerMessageId: 'x' }) } },
      { businessId: 'not-a-business', kind: 'hot_lead', conversationId: null })).toBe('skipped_no_destination');
  });
});

describe('the one delivery function chooses each person\'s way, and falls back to e-mail', () => {
  const owner = (over: Partial<InterruptionPerson> = {}): InterruptionPerson =>
    ({ id: 'o', isOwner: true, choice: null, email: 'owner@example.test', phones: [], ...over });
  const colleague = (over: Partial<InterruptionPerson> = {}): InterruptionPerson =>
    ({ id: 'c', isOwner: false, choice: 'email', email: 'sam@example.test', phones: [], ...over });
  /** Fake ways that record what they were asked and answer as told. */
  const fakes = (answer: Partial<Record<'email' | 'browser' | 'whatsapp', WayResult>> = {}, mail = true) => {
    const asked: string[] = [];
    const ways: InterruptionWays = {
      email: mail ? async (to) => { asked.push(`email:${to}`); return answer.email ?? 'sent'; } : null,
      browser: async (phones) => { asked.push(`browser:${phones.length}`); return answer.browser ?? 'sent'; },
      whatsapp: async () => { asked.push('whatsapp'); return answer.whatsapp ?? 'sent'; },
    };
    return { asked, ways };
  };
  /** No number on a live channel. */
  const closed = { whatsappReachable: false, approved: false, pushOn: true };
  /** The pilot today: a number on a live channel, Meta not yet approved. */
  const early = { whatsappReachable: true, approved: false, pushOn: true };
  const open = { whatsappReachable: true, approved: true, pushOn: true };

  it('before approval the owner\'s default is e-mail, and only e-mail — reachable or not', async () => {
    for (const o of [closed, early]) {
      const f = fakes();
      expect(await reachPeople([owner()], o, f.ways)).toEqual({ outcome: 'sent', went: ['email'], later: false });
      expect(f.asked).toEqual(['email:owner@example.test']);
    }
  });

  it('before approval an owner who CHOSE WhatsApp hears by WhatsApp where it is reachable — the pilot keeps it', async () => {
    const f = fakes();
    expect(await reachPeople([owner({ choice: 'whatsapp' })], early, f.ways)).toEqual({ outcome: 'sent', went: ['whatsapp'], later: false });
    expect(f.asked).toEqual(['whatsapp']);
    // no number on a live channel: e-mail, and WhatsApp is never asked
    const g = fakes();
    expect((await reachPeople([owner({ choice: 'whatsapp' })], closed, g.ways)).went).toEqual(['email']);
    expect(g.asked).toEqual(['email:owner@example.test']);
  });

  it('before approval a WhatsApp refused outside Meta\'s day goes by e-mail, at once', async () => {
    for (const r of ['failed', 'later'] as const) {
      const f = fakes({ whatsapp: r });
      expect(await reachPeople([owner({ choice: 'whatsapp' })], early, f.ways), r).toEqual({ outcome: 'sent', went: ['email'], later: false });
      expect(f.asked).toEqual(['whatsapp', 'email:owner@example.test']);
    }
  });

  it('a deletion request is e-mailed to the owner always, and goes the chosen way as well when that way is not e-mail (rule 18)', async () => {
    const del = (o: typeof open) => ({ ...o, mailOwnerAlways: true });
    // chosen WhatsApp: WhatsApp and e-mail
    const f = fakes();
    expect(await reachPeople([owner({ choice: 'whatsapp' })], del(early), f.ways)).toEqual({ outcome: 'sent', went: ['whatsapp'], later: false });
    expect(f.asked).toEqual(['whatsapp', 'email:owner@example.test']);
    // the default after approval (WhatsApp): the same
    const g = fakes();
    expect((await reachPeople([owner()], del(open), g.ways)).went).toEqual(['whatsapp']);
    expect(g.asked).toEqual(['whatsapp', 'email:owner@example.test']);
    // chosen Browser: the phones and e-mail
    const h = fakes();
    await reachPeople([owner({ choice: 'browser', phones: [PHONE] })], del(early), h.ways);
    expect(h.asked).toEqual(['browser:1', 'email:owner@example.test']);
    // e-mail chosen: one e-mail, never two
    const i = fakes();
    expect((await reachPeople([owner({ choice: 'email' })], del(open), i.ways)).went).toEqual(['email']);
    expect(i.asked).toEqual(['email:owner@example.test']);
    // the chosen way failing: the one e-mail carries it
    const j = fakes({ whatsapp: 'failed' });
    expect((await reachPeople([owner({ choice: 'whatsapp' })], del(early), j.ways)).went).toEqual(['email']);
    expect(j.asked).toEqual(['whatsapp', 'email:owner@example.test']);
    // the sign-in address is the owner's: a colleague hears their own way only
    const k = fakes();
    await reachPeople([colleague({ choice: 'browser', phones: [PHONE] })], del(open), k.ways);
    expect(k.asked).toEqual(['browser:1']);
    // and the delivery passes it for a deletion request, and only for one
    const src = readFileSync(new URL('../../src/pipeline/notify.ts', import.meta.url), 'utf8');
    expect(src).toContain("mailOwnerAlways: job.kind === 'deletion_requested',");
  });

  it('the day approval lands, the same owner — still on the default — is WhatsApp, and only WhatsApp', async () => {
    const f = fakes();
    expect((await reachPeople([owner()], open, f.ways)).went).toEqual(['whatsapp']);
    expect(f.asked).toEqual(['whatsapp']);
  });

  it('a WhatsApp that fails, now or for good, falls back to e-mail at once', async () => {
    for (const r of ['failed', 'later'] as const) {
      const f = fakes({ whatsapp: r });
      expect(await reachPeople([owner()], open, f.ways), r).toEqual({ outcome: 'sent', went: ['email'], later: false });
      expect(f.asked).toEqual(['whatsapp', 'email:owner@example.test']);
    }
  });

  it('nothing reached, and a way may work later: said so, so the job is tried again', async () => {
    const f = fakes({ whatsapp: 'later' }, false);
    expect(await reachPeople([owner()], open, f.ways)).toEqual({ outcome: 'failed_permanent', went: [null], later: true });
    const g = fakes({ whatsapp: 'failed', email: 'failed' });
    expect(await reachPeople([owner()], open, g.ways)).toEqual({ outcome: 'failed_permanent', went: [null], later: false });
  });

  it('Browser goes to the person\'s own phones; with none turned on it is e-mail, and the push service is never asked', async () => {
    const f = fakes();
    expect((await reachPeople([owner({ choice: 'browser', phones: [PHONE, PHONE] })], closed, f.ways)).went).toEqual(['browser']);
    expect(f.asked).toEqual(['browser:2']);
    const g = fakes();
    expect((await reachPeople([owner({ choice: 'browser' })], closed, g.ways)).went).toEqual(['email']);
    expect(g.asked).toEqual(['email:owner@example.test']);
    // An installation that sends no phone alerts: e-mail.
    const h = fakes();
    expect((await reachPeople([owner({ choice: 'browser', phones: [PHONE] })], { ...closed, pushOn: false }, h.ways)).went).toEqual(['email']);
    // A phone that refused: e-mail.
    const i = fakes({ browser: 'failed' });
    expect((await reachPeople([owner({ choice: 'browser', phones: [PHONE] })], closed, i.ways)).went).toEqual(['email']);
  });

  it('an owner who chose e-mail stays on e-mail after approval', async () => {
    const f = fakes();
    expect((await reachPeople([owner({ choice: 'email' })], open, f.ways)).went).toEqual(['email']);
    expect(f.asked).toEqual(['email:owner@example.test']);
  });

  it('WhatsApp is the owner\'s alone: a colleague is never sent to the owner\'s number', async () => {
    const f = fakes();
    expect((await reachPeople([colleague({ choice: 'whatsapp' })], open, f.ways)).went).toEqual(['email']);
    expect(f.asked).not.toContain('whatsapp');
  });

  it('each person hears once, their own way', async () => {
    const f = fakes();
    const r = await reachPeople([owner(), colleague({ choice: 'browser', phones: [PHONE] })], open, f.ways);
    expect(r.went).toEqual(['whatsapp', 'browser']);
    expect(f.asked).toEqual(['whatsapp', 'browser:1']);
  });

  it('nowhere to go is said, never faked', async () => {
    const f = fakes({}, false);
    expect(await reachPeople([owner({ email: null })], closed, f.ways)).toEqual({ outcome: 'skipped_no_destination', went: [null], later: false });
    expect(f.asked).toEqual([]);
    expect((await reachPeople([], closed, fakes().ways)).outcome).toBe('skipped_no_destination');
  });
});

describe('0124 — the person\'s way, or NULL for the default', () => {
  const m = readFileSync(new URL('../../migrations/0124_alert_channel.sql', import.meta.url), 'utf8');
  it('one nullable column on people, holding only the three ways', () => {
    expect(m).toContain('alter table people\n  add column if not exists alert_channel text;');
    expect(m).toContain("check (alert_channel is null or alert_channel in ('email', 'browser', 'whatsapp'))");
    expect(m).not.toMatch(/alert_channel text not null|default 'email'/);
  });
  it('a colleague who had turned on phone alerts keeps them', () => {
    expect(m).toMatch(/update people p set alert_channel = 'browser'\n where not p\.is_owner and p\.archived_at is null and p\.alert_channel is null\n   and exists \(select 1 from push_subscriptions s where s\.person_id = p\.id and s\.archived_at is null\);/);
  });
  it('an owner who set an alert number keeps WhatsApp — the live owner row, as the code finds it; no row, nothing done', () => {
    expect(m).toMatch(/update people p set alert_channel = 'whatsapp'\n  from businesses b\n where b\.id = p\.business_id and b\.owner_phone is not null\n   and p\.is_owner and p\.archived_at is null and p\.alert_channel is null;/);
    // the code's own way to the owner's row (src/db/alertChannel.ts): the live row with is_owner
    const store = readFileSync(new URL('../../src/db/alertChannel.ts', import.meta.url), 'utf8');
    expect(store).toContain('where p.business_id = ${bid} and p.archived_at is null');
    expect(store).toContain('sql`p.is_owner`');
    // the header says so
    expect(m.replace(/\n-- /g, ' ')).toContain('a business with no owner row is left as it is');
  });
  it('is version 124, and the app requires it (or a later one)', () => {
    expect(m).toMatch(/insert into _migrations \(version, name\) values \(124, 'alert_channel'\)\non conflict \(version\) do nothing;\s*$/);
    expect(REQUIRED_SCHEMA_VERSION).toBeGreaterThanOrEqual(124);
  });
});

describe('the Notifications page, in every language', () => {
  const view = (ways: AlertWaysView | null, over: Partial<PhoneAlertsView> = {}): PhoneAlertsView =>
    ({ publicKey: 'BKEY', phones: [], ways, ...over });
  const ownerWays = (over: Partial<AlertWaysView> = {}): AlertWaysView =>
    ({ choice: null, isOwner: true, email: 'owner@example.test', whatsapp: 'number', ownerPhone: null, ...over });
  const radios = (html: string) => [...html.matchAll(/<input type="radio" name="channel" value="([a-z]+)"( checked)?( disabled)? \/>/g)]
    .map((r) => `${r[1]}${r[2] ? '*' : ''}${r[3] ? '-' : ''}`);

  for (const l of LOCALES) {
    it(`${l} · named Notifications; the two things said plainly; three ways; WhatsApp shown, disabled, saying what it needs`, () => {
      const html = withoutIsolates(renderPhoneAlerts(view(ownerWays()), l, null));
      expect(html).toContain(`<h1 class="page">${esc(t(l, 'alerts.title'))}</h1>`);
      expect(html).toMatch(/<\/h1>\s*<p class="lede">/);
      expect(html).toContain(esc(t(l, 'alerts.lede')));
      expect(html).toContain(`<li>${esc(t(l, 'alerts.two.order'))}</li>`);
      expect(html).toContain(esc(withoutIsolates(t(l, 'alerts.two.handover'))).split('{name}')[0]!);
      expect(html).toContain(esc(t(l, 'alerts.rest')));
      expect(html).toContain('<form method="post" action="/app/settings/alerts/channel">');
      // Phase 9 (settings-a-new-06) — the three ways are the rows of one card, like every sibling page's settings.
      expect(html).toContain('<fieldset class="scard ways" aria-labelledby="alerts-way">');
      expect(radios(html)).toEqual(['email*', 'browser', 'whatsapp-']);
      expect(html).toContain(esc(t(l, 'alerts.way.whatsapp.number')));
      // (w4-settings-a-03) …and the door to where the number and the channel are set.
      expect(html).toContain(`<a class="way-door" href="/app/channels/alerts">${esc(t(l, 'channels.alerts.title'))}<span class="go" aria-hidden="true">›</span></a>`);
      expect(html).not.toContain(esc(t(l, 'alerts.way.whatsapp.early')));
      // (w4-settings-a-01) what the plan rests on: WhatsApp is the intended way, the default the day Meta approves.
      expect(html).toContain(esc(t(l, 'alerts.way.whatsapp.plan')));
      expect(t(l, 'alerts.way.whatsapp.plan')).toContain('Meta');
      expect(html).toContain(esc(t(l, 'alerts.way.fallback')));
      // (w4-settings-a-05) the e-mails that come whatever the way
      expect(html).toContain(esc(t(l, 'alerts.alsoMail')));
      // the phones are still here, under their own heading
      expect(html).toContain(`<h2 class="sgroup-h" id="alerts-phones">${esc(t(l, 'alerts.phone.title'))}</h2>`);
      expect(html).toContain('data-push-key="BKEY"');
      expect(html).not.toMatch(/\balerts\.[a-zA-Z_.]+/);
      expect(html).not.toMatch(/\bstaff\.[a-zA-Z_.]+/);
    });
  }

  it('the day WhatsApp opens, the owner on the default sees it chosen, with the number it goes to', () => {
    const html = renderPhoneAlerts(view(ownerWays({ whatsapp: 'open', ownerPhone: '+971500000000' })), 'en', null);
    expect(radios(html)).toEqual(['email', 'browser', 'whatsapp*']);
    expect(html).toContain(esc(t('en', 'alerts.way.whatsapp.to', { phone: '+971500000000' })));
  });

  for (const l of LOCALES) {
    it(`${l} · before approval, WhatsApp reachable: it may be chosen, with the one honest line; e-mail stays the default`, () => {
      const html = withoutIsolates(renderPhoneAlerts(view(ownerWays({ whatsapp: 'early', ownerPhone: '+971500000000' })), l, null));
      expect(radios(html)).toEqual(['email*', 'browser', 'whatsapp']);
      expect(html).toContain(esc(withoutIsolates(t(l, 'alerts.way.whatsapp.to', { phone: '+971500000000' }))));
      expect(html).toContain(esc(t(l, 'alerts.way.whatsapp.early')));
      // chosen before approval, it is checked, and still says it
      const chosen = withoutIsolates(renderPhoneAlerts(view(ownerWays({ whatsapp: 'early', ownerPhone: '+971500000000', choice: 'whatsapp' })), l, null));
      expect(radios(chosen)).toEqual(['email', 'browser', 'whatsapp*']);
      expect(chosen).not.toContain('class="fwarn">');
    });
  }

  it('the honest line, in the owner\'s words, short: what may not arrive, and what carries it then', () => {
    expect(t('en', 'alerts.way.whatsapp.early')).toBe('Until Meta approves Nomi, a notification sent over a day after your last WhatsApp to the business may not arrive; e-mail then carries it.');
    for (const l of LOCALES) expect(t(l, 'alerts.way.whatsapp.early'), l).toContain('Meta');
  });

  it('Browser chosen with no phone on: the way ticked is the one that carries them (e-mail), and the choice is named', () => {
    const html = renderPhoneAlerts(view(ownerWays({ choice: 'browser' })), 'en', null);
    expect(radios(html)).toEqual(['email*', 'browser', 'whatsapp-']);
    expect(html).toContain(esc(t('en', 'alerts.way.browser.none')));
    expect(html).toContain(`<p class="way-foot">${esc(t('en', 'alerts.way.instead', { way: t('en', 'alerts.way.browser') }))}</p>`);
    // the existing way to turn them on is right there
    expect(html).toContain('data-push-save="/app/settings/alerts/phone"');
    const on = renderPhoneAlerts(view(ownerWays({ choice: 'browser' }), { phones: [PHONE] }), 'en', null);
    expect(on).toContain(esc(t('en', 'alerts.way.browser.on')));
    expect(radios(on)).toEqual(['email', 'browser*', 'whatsapp-']);
    expect(on).not.toContain('class="way-foot">' + esc(t('en', 'alerts.way.instead', { way: t('en', 'alerts.way.browser') })));
  });

  it('no phone alerts on this installation: Browser cannot be chosen, and says why', () => {
    const html = renderPhoneAlerts(view(ownerWays(), { publicKey: null }), 'en', null);
    expect(radios(html)).toEqual(['email*', 'browser-', 'whatsapp-']);
    expect(html).toContain(esc(t('en', 'alerts.phone.off')));
    // Phase 9 (w4-settings-a-08) — said once, on the way's own line: no empty section repeats it.
    expect(html).not.toContain('id="alerts-phones"');
    // the only way that can be chosen is the one already ticked: nothing to save
    expect(html).not.toContain(`>${esc(t('en', 'alerts.way.save'))}</button>`);
  });

  for (const l of LOCALES) {
    it(`${l} · PHASE 9 (w4-settings-a-02) · no e-mail address: e-mail is never ticked, and the page says plainly that nothing reaches them`, () => {
      // nothing can be chosen here: no address, no phone notifications on this installation, no number on a live channel
      const bare = withoutIsolates(renderPhoneAlerts(view(ownerWays({ email: null }), { publicKey: null }), l, null));
      expect(radios(bare)).toEqual(['email-', 'browser-', 'whatsapp-']);
      expect(bare).toContain(`<p class="ways-none">${esc(t(l, 'alerts.way.nothing'))}</p>`);
      expect(bare).toContain(esc(t(l, 'alerts.way.email.none')));
      expect(bare).not.toContain(esc(t(l, 'alerts.way.fallback')));     // e-mail is no floor for them
      expect(bare).not.toContain(esc(t(l, 'alerts.alsoMail')));
      expect(bare).not.toContain(`>${esc(t(l, 'alerts.way.save'))}</button>`);
      // WhatsApp reachable before approval: it may be chosen; nothing is ticked until it is
      const early = withoutIsolates(renderPhoneAlerts(view(ownerWays({ email: null, whatsapp: 'early', ownerPhone: '+971500000000' }), { publicKey: null }), l, null));
      expect(radios(early)).toEqual(['email-', 'browser-', 'whatsapp']);
      expect(early).toContain(`<p class="ways-none">${esc(t(l, 'alerts.way.notYet'))}</p>`);
      expect(early).toContain(`>${esc(t(l, 'alerts.way.save'))}</button>`);
      const chosen = withoutIsolates(renderPhoneAlerts(view(ownerWays({ email: null, whatsapp: 'early', ownerPhone: '+971500000000', choice: 'whatsapp' }), { publicKey: null }), l, null));
      expect(radios(chosen)).toEqual(['email-', 'browser-', 'whatsapp*']);
      expect(chosen).not.toContain('class="ways-none"');
      // Setup's row says so too
      const scope: RequestScope = { name: null, several: false, outreach: false, setup: null };
      const setup = withWorkspace(scope, () => renderSetup({ people: 1, alerts: { available: false, phones: 0,
        way: alertWayNow(ownerWays({ email: null }), { publicKey: null, phones: [] }) } }, l, null));
      expect(setup).toContain(`<span class="sr-desc">${esc(t(l, 'setup.alerts.nothing'))}</span>`);
      expect(setup).not.toContain(`<bdi>${esc(t(l, 'alerts.way.email'))}</bdi>`);
    });
  }

  it('PHASE 9 (w4-settings-a-02) · the sender agrees with the page: no address and the default is nothing tried, not e-mail', async () => {
    const asked: string[] = [];
    const ways: InterruptionWays = {
      email: async (to) => { asked.push(`email:${to}`); return 'sent'; },
      browser: async () => { asked.push('browser'); return 'sent'; },
      whatsapp: async () => { asked.push('whatsapp'); return 'sent'; },
    };
    const person: InterruptionPerson = { id: 'o', isOwner: true, choice: null, email: null, phones: [] };
    expect(await reachPeople([person], { whatsappReachable: true, approved: false, pushOn: true }, ways))
      .toEqual({ outcome: 'skipped_no_destination', went: [null], later: false });
    expect(asked).toEqual([]);
    expect(alertWayNow(ownerWays({ email: null, whatsapp: 'early', ownerPhone: '+971500000000' }), { publicKey: 'K', phones: [] })).toBeNull();
    // chosen WhatsApp, the page ticks it and the sender takes it
    expect((await reachPeople([{ ...person, choice: 'whatsapp' }], { whatsappReachable: true, approved: false, pushOn: true }, ways)).went).toEqual(['whatsapp']);
    expect(alertWayNow(ownerWays({ email: null, whatsapp: 'early', ownerPhone: '+971500000000', choice: 'whatsapp' }), { publicKey: 'K', phones: [] })).toBe('whatsapp');
  });

  it('PHASE 9 · Arabic names WhatsApp in its own script (w4-settings-a-07); the way back follows the door it was opened from (w4-settings-a-10)', () => {
    const ar = renderPhoneAlerts(view(ownerWays()), 'ar', null);
    expect(ar).toContain(`<span class="way-n">واتساب</span>`);
    expect(ar).not.toContain('<span class="way-n">WhatsApp</span>');
    for (const l of LOCALES) {
      const fromChannels = renderPhoneAlerts(view(ownerWays()), l, null, 'channels');
      expect(fromChannels).toContain(`<a class="back" href="/app/channels/alerts"><span class="go" aria-hidden="true">‹</span>${esc(t(l, 'channels.alerts.title'))}</a>`);
      expect(fromChannels).toContain('<input type="hidden" name="from" value="channels" />');
      expect(renderPhoneAlerts(view(ownerWays()), l, null)).toContain(`<a class="back" href="/app/settings/setup">`);
    }
  });

  it('PHASE 9 · one name for one thing (w4-settings-a-06): the page, the door to it from the channels\' number screen, the way and its section', () => {
    for (const l of LOCALES) {
      expect(t(l, 'meta.phoneAlerts'), l).toBe(t(l, 'alerts.title'));
    }
    for (const k of ['channels.alerts.title', 'alerts.way.browser', 'alerts.phone.title', 'alerts.phone.off', 'alerts.phone.turnOn', 'settings.alerts.label', 'settings.alerts.desc'] as const) {
      expect(t('en', k), k).not.toMatch(/\balerts?\b|\bBrowser\b/i);
      expect(t('zh', k), k).not.toContain('提醒');
      expect(t('es', k), k).not.toMatch(/\bavisos?\b/i);
      expect(t('fr', k), k).not.toMatch(/\balertes?\b/i);
      expect(t('ar', k), k).not.toContain('التنبيهات');
    }
    // (w4-settings-a-04) the card no longer says WhatsApp must be approved first: it may be chosen now, and is the default from approval
    for (const l of LOCALES) expect(t(l, 'settings.alerts.desc'), l).toContain('Meta');
  });

  it('a colleague who has not chosen: nothing checked, and nothing reaches them yet; WhatsApp is the owner\'s number', () => {
    for (const l of LOCALES) {
      const html = renderPhoneAlerts(view({ choice: null, isOwner: false, email: null, whatsapp: 'owner', ownerPhone: null }), l, null);
      // no address: e-mail cannot be chosen (phase 9, w4-settings-a-02); a phone or computer can
      expect(radios(html), l).toEqual(['email-', 'browser', 'whatsapp-']);
      expect(html, l).toContain(esc(t(l, 'alerts.way.notYet')));
      expect(html, l).toContain(esc(t(l, 'staff.whatsappAlerts')));
      expect(html, l).toContain(esc(t(l, 'alerts.way.email.none')));
    }
  });

  it('Setup\'s row is Notifications, and says the way they reach this reader now', () => {
    const scope: RequestScope = { name: null, several: false, outreach: false, setup: null };
    const row = (way: 'email' | 'browser' | 'whatsapp' | null) => withWorkspace(scope, () =>
      renderSetup({ people: 1, alerts: { available: true, phones: 0, way } }, 'en', null));
    const html = row('email');
    // Setup is a menu since phase 7: the row is drawn by `menuRow` (its icon, its value in its own direction).
    expect(html).toMatch(new RegExp(`href="/app/settings/alerts"><svg[\\s\\S]*?</svg><span class="sr-main"><span class="sr-label">${t('en', 'alerts.title')}</span>`));
    expect(html).toContain(`<span class="sr-value"><bdi>${t('en', 'alerts.way.email')}</bdi></span>`);
    expect(row('whatsapp')).toContain(`<span class="sr-value"><bdi>${t('en', 'conv.channel.whatsapp')}</bdi></span>`);
    // Phase 9 (w4-settings-a-02) — nothing reaches them: the row says so, and names no way.
    expect(row(null)).toContain(`<span class="sr-desc">${t('en', 'setup.alerts.nothing')}</span>`);
    expect(/href="\/app\/settings\/alerts">([\s\S]*?)<\/a>/.exec(row(null))![1]).not.toContain('sr-value');
    // the way it reaches them now — the e-mail a Browser with no phone falls back to
    const ways = ownerWays({ choice: 'browser' });
    expect(alertWayNow(ways, { publicKey: 'K', phones: [] })).toBe('email');
    expect(alertWayNow(ways, { publicKey: 'K', phones: [PHONE] })).toBe('browser');
    expect(alertWayNow({ ...ways, isOwner: false, choice: null }, { publicKey: 'K', phones: [] })).toBeNull();
    // WhatsApp chosen before approval, where reachable, is WhatsApp; the default before approval is e-mail
    expect(alertWayNow(ownerWays({ whatsapp: 'early', choice: 'whatsapp' }), { publicKey: 'K', phones: [] })).toBe('whatsapp');
    expect(alertWayNow(ownerWays({ whatsapp: 'early' }), { publicKey: 'K', phones: [] })).toBe('email');
    expect(alertWayNow(ownerWays({ whatsapp: 'open' }), { publicKey: 'K', phones: [] })).toBe('whatsapp');
    expect(alertWayNow(ownerWays({ whatsapp: 'number', choice: 'whatsapp' }), { publicKey: 'K', phones: [] })).toBe('email');
  });

  it('every new line is in five languages, none blank, none untranslated where it should be, none with a software word', () => {
    const keys = ['alerts.title', 'alerts.lede', 'alerts.two.order', 'alerts.two.handover', 'alerts.rest', 'alerts.way.title',
      'alerts.way.email', 'alerts.way.browser', 'alerts.way.email.to', 'alerts.way.email.none', 'alerts.way.browser.on',
      'alerts.way.browser.none', 'alerts.way.whatsapp.to', 'alerts.way.whatsapp.early', 'alerts.way.whatsapp.number',
      'staff.whatsappAlerts', 'alerts.way.instead', 'alerts.way.notYet', 'alerts.way.save', 'alerts.way.fallback',
      'alerts.way.nothing', 'alerts.way.whatsapp', 'alerts.way.whatsapp.plan', 'alerts.way.whatsapp.planApproved', 'alerts.alsoMail', 'setup.alerts.nothing',
      'alerts.flash.way', 'alerts.flash.wayBad', 'live.toast.order', 'live.toast.deletion', 'live.toast.person', 'live.toast.reply'] as const;
    for (const l of LOCALES) for (const k of keys) {
      const s = t(l, k);
      expect(s.trim(), `${l}/${k}`).not.toBe('');
      expect(s, `${l}/${k}`).not.toBe(k);
      for (const banned of BANNED_OWNER_TERMS) {
        const hit = /^[A-Za-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`, 'i').test(s) : s.includes(banned);
        expect(hit, `${l}/${k}: "${banned}"`).toBe(false);
      }
    }
    // The decision the owner gave, in their words: no plain draft, no "ready to buy" among the two.
    expect(t('en', 'alerts.two.order')).toBe('An order waiting for your tap');
    // Phase 9 (w4-settings-a-03) — the condition as the code holds it: a channel that is LIVE, not merely connected.
    expect(t('en', 'alerts.way.whatsapp.number')).toBe('Needs your WhatsApp number for notifications and a channel that is live.');
    // …and no detached prefix in Arabic (V1-008's «لـ»): Meta's approval OF Nomi, said as on the plan's line.
    expect(t('ar', 'alerts.way.whatsapp.early')).not.toContain('لـ ');
  });
});

describe('the rail\'s answer: the count every page shows, and who arrived when it rose', () => {
  const CONV = '6c1e0000-0000-4000-8000-00000000c026';
  // The warmth run's re-audit (w4-whole-03, -04): the mark is the count AND the
  // second the latest customer began to wait. A newcomer is decided by WHEN they
  // arrived — never by the count, which a customer dealt with and another arriving
  // leave unchanged, and which rises when the owner merely takes a conversation.
  it('a mark is the count, and the moment the latest customer began to wait (an old page: the count alone)', () => {
    for (const ok of ['0', '3', '1234', '3.1791030316', '0.0']) expect(isRailMark(ok), ok).toBe(true);
    for (const bad of ['', '03', '-1', '1.', '.5', '1.2.3', 'x', 3, null, undefined, ['3']]) expect(isRailMark(bad), String(bad)).toBe(false);
  });

  it('only someone who began to wait after the page\'s moment is news; a count alone never is', () => {
    expect(railRose('2.100', 101)).toBe(true);
    expect(railRose('2.100', 100)).toBe(false);
    expect(railRose('2.100', 99)).toBe(false);
    expect(railRose('2.100', null)).toBe(false);   // nobody waits
    expect(railRose('2', 500)).toBe(false);       // an old page's mark carried no moment: told nothing rather than wrongly
    expect(railRose('9.1000', 10000)).toBe(true); // numbers, not text
  });

  it('it says the count as the rail draws it, the entry\'s spoken name, and — for a rise — who and why, a door to the conversation', () => {
    for (const l of LOCALES) {
      const quiet = railSaid(l, { status: 200, n: 2, at: 1700, newest: null });
      expect(quiet.n).toBe(2);
      expect(quiet.mark).toBe('2.1700');
      // the rail's words, as the shell draws them, so a live update reads as a reload would (w4-whole-05)
      expect(withoutIsolates(quiet.words)).toBe(withoutIsolates(t(l, 'nav.waiting', { n: 2 })));
      expect(quiet.toast, l).toBeUndefined();
      // the entry's spoken name, word for word as the shell says it on the page drawn with that count
      expect(quiet.label).toBe(`${t(l, 'nav.inbox')}, ${tn(l, 'nav.needsYou', 2)}`);
      expect(quiet.shown).toBe(l === 'ar' ? '\u20682\u2069' : '2');
      for (const why of ['order', 'deletion', 'person', 'reply'] as const) {
        const said = railSaid(l, { status: 200, n: 3, at: 1, newest: { conversationId: CONV, who: 'Amina Yusuf', why } });
        expect(said.toast!.door).toBe(conversationUrl(CONV));
        expect(withoutIsolates(said.toast!.say), `${l}/${why}`).toBe(withoutIsolates(t(l, `live.toast.${why}`, { who: 'Amina Yusuf' })));
      }
      // A customer with no name is "a customer", in the reader's language.
      const nameless = railSaid(l, { status: 200, n: 1, at: 1, newest: { conversationId: CONV, who: null, why: 'person' } });
      expect(withoutIsolates(nameless.toast!.say)).toContain(t(l, 'common.buyer'));
    }
    // In Arabic a name in Latin letters is isolated, so the line reads right to left around it.
    expect(railSaid('ar', { status: 200, n: 3, at: 1, newest: { conversationId: CONV, who: 'Amina', why: 'person' } }).toast!.say).toContain('\u2068Amina\u2069');
  });

  it('every page in a workspace draws the slot that asks it — empty, polite, with the count it was drawn with; outside one, none', () => {
    const scope = (n: number | null, at = 0): RequestScope => ({ name: null, several: false, outreach: false, setup: null, needsYou: n, needsYouAt: at });
    for (const l of LOCALES) {
      const html = withWorkspace(scope(4, 1791030316), () => shell({ title: 'T', active: 'home', locale: l, path: '/app', bodyHtml: '<p>x</p>' }));
      expect(html, l).toContain('<div class="toasts" role="status" aria-live="polite" data-rail="/app/live/rail?since=4.1791030316"></div>');
    }
    const none = withWorkspace(scope(0), () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    expect(none).toContain('data-rail="/app/live/rail?since=0.0"');
    expect(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })).not.toContain('data-rail');
  });

  it('Today is drawn again in place when what needs attention changes; a conversation still shows its line', () => {
    expect(liveRegion('en', todayWatch('1.0.0.0.0.0'))).toMatch(/^<div class="live" role="status" aria-live="polite" data-live="\/app\/live\/today\?since=1\.0\.0\.0\.0\.0" data-live-redraw="1"><\/div>/);
    expect(liveRegion('en', conversationWatch(CONV, '1.0.0123abcd'))).not.toContain('data-live-redraw');
  });
});

describe('the marker and the card, as the stylesheet draws them', () => {
  const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
  const rule = (sel: string) => new RegExp(`\\n\\s*${sel.replace(/[.[\]()*:"=-]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('a small dot in the waiting signal\'s magenta on the Inbox entry — a dot, never a frame, and never a number of its own', () => {
    const dot = rule('nav.side a.navlink[data-fresh]::after');
    expect(dot).toContain('background:var(--color-needs)');
    expect(dot).toContain('content:""');
    expect(dot).not.toMatch(/border(?!-radius)/);
  });

  it('the card: rounded, the bottom on a phone, the bottom inline-end on a wide screen; tokens only; logical sides only', () => {
    const box = rule('.toasts');
    expect(box).toContain('position:fixed');
    expect(box).toContain('inset-block-end:var(--space-24)');
    expect(box).toContain('inset-inline-end:var(--space-24)');
    // the card's own box (the stylesheet also names .toast where it moves it)
    const card = [...css.matchAll(/\n\s*\.toast \{([^}]*)\}/g)].map((m) => m[1]!).find((b) => b.includes('pointer-events')) ?? '';
    expect(card).toContain('border-radius:var(--radius-card)');
    expect(card).toContain('min-block-size:44px');
    for (const r of [box, card]) {
      expect(r).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb|\b(left|right)\b/);
      expect(r).not.toMatch(/max-width:(?!var\(--measure-|\d+%)/);
    }
    expect(css).toMatch(/@media \(max-width: 720px\) \{\n\s*nav\.side a\.navlink\[data-fresh\]::after \{[^}]*\}\n\s*\.toasts \{ inset-inline:var\(--space-16\); inset-block-end:var\(--space-16\);/);
  });

  // The motion pass (2026-10-04): it slides in from its own edge and back out, and up from the foot on a phone.
  it('it slides in at normal speed and out at fast, and only for a reader who has not asked for less motion', () => {
    const blocks = css.split('@media (prefers-reduced-motion: no-preference)');
    const moving = blocks.slice(1).map((b) => b.slice(0, b.indexOf('\n  }')));
    expect(moving.some((b) => b.includes('.toast { animation:nomi-toast-in var(--motion-normal) var(--motion-ease) both; }'))).toBe(true);
    expect(moving.some((b) => b.includes('.toast.out { animation:nomi-toast-out var(--motion-fast) var(--motion-ease-in) both; }'))).toBe(true);
    // nowhere else is the card moved
    const outside = blocks[0]!;
    expect(outside).not.toMatch(/\.toasts? \{[^}]*(animation|transition)/);
  });
});
