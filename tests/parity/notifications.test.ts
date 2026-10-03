import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ALERT_CHANNELS, alertChannelFor, defaultAlertChannel, ownerWhatsAppOpen, parseAlertChannel, storedAlertChoice,
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
  it('the owner\'s WhatsApp path is open only when Meta approved Nomi AND a number is set AND a channel is live', () => {
    for (const approved of [false, true]) for (const ownerPhone of [null, '+971500000000']) for (const channelLive of [false, true]) {
      expect(ownerWhatsAppOpen({ approved, ownerPhone, channelLive }), JSON.stringify({ approved, ownerPhone, channelLive }))
        .toBe(approved && ownerPhone !== null && channelLive);
    }
  });

  it('the default is WhatsApp where that path is open, e-mail otherwise', () => {
    expect(defaultAlertChannel(true)).toBe('whatsapp');
    expect(defaultAlertChannel(false)).toBe('email');
  });

  it('the way a notification takes: the choice, or the default; e-mail when that way cannot be used now', () => {
    const none = { whatsapp: false, browser: false };
    const all = { whatsapp: true, browser: true };
    // the default follows approval, with nothing stored
    expect(alertChannelFor(null, none)).toBe('email');
    expect(alertChannelFor(null, { whatsapp: true, browser: false })).toBe('whatsapp');
    // a choice is kept while it can be used…
    expect(alertChannelFor('email', all)).toBe('email');
    expect(alertChannelFor('browser', all)).toBe('browser');
    expect(alertChannelFor('whatsapp', all)).toBe('whatsapp');
    // …and is e-mail while it cannot: Browser with no phone on, WhatsApp before approval
    expect(alertChannelFor('browser', { whatsapp: true, browser: false })).toBe('email');
    expect(alertChannelFor('whatsapp', { whatsapp: false, browser: true })).toBe('email');
  });

  it('what is stored: the choice, or NULL when the owner chose what is the default now — so approval moves them', () => {
    // Before approval: the owner choosing e-mail is "the default"; the day WhatsApp opens, they are on it.
    expect(storedAlertChoice('email', true, false)).toBeNull();
    expect(alertChannelFor(storedAlertChoice('email', true, false), { whatsapp: true, browser: false })).toBe('whatsapp');
    expect(storedAlertChoice('browser', true, false)).toBe('browser');
    // After approval: choosing e-mail is a choice, and it stays e-mail.
    expect(storedAlertChoice('email', true, true)).toBe('email');
    expect(storedAlertChoice('whatsapp', true, true)).toBeNull();
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
  const closed = { whatsappOpen: false, pushOn: true };
  const open = { whatsappOpen: true, pushOn: true };

  it('before approval the owner\'s default is e-mail, and only e-mail', async () => {
    const f = fakes();
    expect(await reachPeople([owner()], closed, f.ways)).toEqual({ outcome: 'sent', went: ['email'], later: false });
    expect(f.asked).toEqual(['email:owner@example.test']);
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
    expect((await reachPeople([owner({ choice: 'browser', phones: [PHONE] })], { whatsappOpen: false, pushOn: false }, h.ways)).went).toEqual(['email']);
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
  it('a colleague who had turned on phone alerts keeps them; the owner stays on the default', () => {
    expect(m).toMatch(/update people p set alert_channel = 'browser'\n where not p\.is_owner and p\.archived_at is null and p\.alert_channel is null\n   and exists \(select 1 from push_subscriptions s where s\.person_id = p\.id and s\.archived_at is null\);/);
  });
  it('is version 124, and the app requires it', () => {
    expect(m).toMatch(/insert into _migrations \(version, name\) values \(124, 'alert_channel'\)\non conflict \(version\) do nothing;\s*$/);
    expect(REQUIRED_SCHEMA_VERSION).toBe(124);
  });
});

describe('the Notifications page, in every language', () => {
  const view = (ways: AlertWaysView | null, over: Partial<PhoneAlertsView> = {}): PhoneAlertsView =>
    ({ publicKey: 'BKEY', phones: [], ways, ...over });
  const ownerWays = (over: Partial<AlertWaysView> = {}): AlertWaysView =>
    ({ choice: null, isOwner: true, email: 'owner@example.test', whatsapp: 'review', ownerPhone: null, ...over });
  const radios = (html: string) => [...html.matchAll(/<input type="radio" name="channel" value="([a-z]+)"( checked)?( disabled)? \/>/g)]
    .map((r) => `${r[1]}${r[2] ? '*' : ''}${r[3] ? '-' : ''}`);

  for (const l of LOCALES) {
    it(`${l} · named Notifications; the two things said plainly; three ways; WhatsApp shown, disabled, with one honest line`, () => {
      const html = withoutIsolates(renderPhoneAlerts(view(ownerWays()), l, null));
      expect(html).toContain(`<h1 class="page">${esc(t(l, 'alerts.title'))}</h1>`);
      expect(html).toMatch(/<\/h1>\s*<p class="lede">/);
      expect(html).toContain(esc(t(l, 'alerts.lede')));
      expect(html).toContain(`<li>${esc(t(l, 'alerts.two.order'))}</li>`);
      expect(html).toContain(esc(withoutIsolates(t(l, 'alerts.two.handover'))).split('{name}')[0]!);
      expect(html).toContain(esc(t(l, 'alerts.rest')));
      expect(html).toContain('<form method="post" action="/app/settings/alerts/channel" class="pform">');
      expect(radios(html)).toEqual(['email*', 'browser', 'whatsapp-']);
      expect(html).toContain(esc(t(l, 'alerts.way.whatsapp.review')));
      expect(html).toContain(esc(t(l, 'alerts.way.fallback')));
      // the phones are still here, under their own heading
      expect(html).toContain(`<h2 id="alerts-phones">${esc(t(l, 'alerts.phone.title'))}</h2>`);
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

  it('approved, but no alert number on a live channel: WhatsApp says what it needs', () => {
    const html = renderPhoneAlerts(view(ownerWays({ whatsapp: 'number' })), 'en', null);
    expect(radios(html)).toEqual(['email*', 'browser', 'whatsapp-']);
    expect(html).toContain(esc(t('en', 'alerts.way.whatsapp.number')));
  });

  it('Browser chosen with no phone on: the page says so, and that e-mail carries them until one is', () => {
    const html = renderPhoneAlerts(view(ownerWays({ choice: 'browser' })), 'en', null);
    expect(radios(html)).toEqual(['email', 'browser*', 'whatsapp-']);
    expect(html).toContain(esc(t('en', 'alerts.way.browser.none')));
    expect(html).toContain(`<p class="fwarn">${esc(t('en', 'alerts.way.instead'))}</p>`);
    // the existing way to turn them on is right there
    expect(html).toContain('data-push-save="/app/settings/alerts/phone"');
    const on = renderPhoneAlerts(view(ownerWays({ choice: 'browser' }), { phones: [PHONE] }), 'en', null);
    expect(on).toContain(esc(t('en', 'alerts.way.browser.on')));
    expect(on).not.toContain('class="fwarn">');
  });

  it('no phone alerts on this installation: Browser cannot be chosen, and says why', () => {
    const html = renderPhoneAlerts(view(ownerWays(), { publicKey: null }), 'en', null);
    expect(radios(html)).toEqual(['email*', 'browser-', 'whatsapp-']);
    expect(html).toContain(esc(t('en', 'alerts.phone.off')));
    expect(html).toContain(esc(t('en', 'alerts.phone.ledeOff')));
  });

  it('a colleague who has not chosen: nothing checked, and nothing reaches them yet; WhatsApp is the owner\'s number', () => {
    for (const l of LOCALES) {
      const html = renderPhoneAlerts(view({ choice: null, isOwner: false, email: null, whatsapp: 'owner', ownerPhone: null }), l, null);
      expect(radios(html), l).toEqual(['email', 'browser', 'whatsapp-']);
      expect(html, l).toContain(esc(t(l, 'alerts.way.notYet')));
      expect(html, l).toContain(esc(t(l, 'staff.whatsappAlerts')));
      expect(html, l).toContain(esc(t(l, 'alerts.way.email.none')));
    }
  });

  it('Setup\'s row is Notifications, and says the way they reach this reader now', () => {
    const scope: RequestScope = { name: null, several: false, outreach: false, setup: null };
    const row = (way: 'email' | 'browser' | 'whatsapp' | null) => withWorkspace(scope, () =>
      renderSetup({ kind: 'Retailer', people: 1, alerts: { available: true, phones: 0, way } }, 'en', null));
    const html = row('email');
    expect(html).toMatch(new RegExp(`href="/app/settings/alerts">\\s*<span class="sr-main"><span class="sr-label">${t('en', 'alerts.title')}</span>`));
    expect(html).toContain(`<span class="sr-value"><bdi>${t('en', 'alerts.way.email')}</bdi></span>`);
    expect(row('whatsapp')).toContain(`<span class="sr-value"><bdi>${t('en', 'conv.channel.whatsapp')}</bdi></span>`);
    expect(row(null)).toContain(`<span class="sr-value"><bdi>${t('en', 'setup.value.off')}</bdi></span>`);
    // the way it reaches them now — the e-mail a Browser with no phone falls back to
    const ways = ownerWays({ choice: 'browser' });
    expect(alertWayNow(ways, { publicKey: 'K', phones: [] })).toBe('email');
    expect(alertWayNow(ways, { publicKey: 'K', phones: [PHONE] })).toBe('browser');
    expect(alertWayNow({ ...ways, isOwner: false, choice: null }, { publicKey: 'K', phones: [] })).toBeNull();
  });

  it('every new line is in five languages, none blank, none untranslated where it should be, none with a software word', () => {
    const keys = ['alerts.title', 'alerts.lede', 'alerts.two.order', 'alerts.two.handover', 'alerts.rest', 'alerts.way.title',
      'alerts.way.email', 'alerts.way.browser', 'alerts.way.email.to', 'alerts.way.email.none', 'alerts.way.browser.on',
      'alerts.way.browser.none', 'alerts.way.whatsapp.to', 'alerts.way.whatsapp.review', 'alerts.way.whatsapp.number',
      'staff.whatsappAlerts', 'alerts.way.instead', 'alerts.way.notYet', 'alerts.way.save', 'alerts.way.fallback',
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
    expect(t('en', 'alerts.way.whatsapp.review')).toBe('Available once WhatsApp is approved.');
  });
});

describe('the rail\'s answer: the count every page shows, and who arrived when it rose', () => {
  const CONV = '6c1e0000-0000-4000-8000-00000000c026';
  it('a mark is the count as the page drew it, and nothing else', () => {
    for (const ok of ['0', '3', '1234']) expect(isRailMark(ok), ok).toBe(true);
    for (const bad of ['', '03', '-1', '1.2', 'x', 3, null, undefined, ['3']]) expect(isRailMark(bad), String(bad)).toBe(false);
  });

  it('only a rise is news; the same or fewer is not', () => {
    expect(railRose('2', 3)).toBe(true);
    expect(railRose('2', 2)).toBe(false);
    expect(railRose('2', 1)).toBe(false);
    expect(railRose('9', 10)).toBe(true);    // numbers, not text
  });

  it('it says the count as the rail draws it, the entry\'s spoken name, and — for a rise — who and why, a door to the conversation', () => {
    for (const l of LOCALES) {
      const quiet = railSaid(l, { status: 200, n: 2, newest: null });
      expect(quiet.n).toBe(2);
      expect(quiet.mark).toBe('2');
      expect(quiet.toast, l).toBeUndefined();
      // the entry's spoken name, word for word as the shell says it on the page drawn with that count
      expect(quiet.label).toBe(`${t(l, 'nav.inbox')}, ${tn(l, 'nav.needsYou', 2)}`);
      expect(quiet.shown).toBe(l === 'ar' ? '\u20682\u2069' : '2');
      for (const why of ['order', 'deletion', 'person', 'reply'] as const) {
        const said = railSaid(l, { status: 200, n: 3, newest: { conversationId: CONV, who: 'Amina Yusuf', why } });
        expect(said.toast!.door).toBe(conversationUrl(CONV));
        expect(withoutIsolates(said.toast!.say), `${l}/${why}`).toBe(withoutIsolates(t(l, `live.toast.${why}`, { who: 'Amina Yusuf' })));
      }
      // A customer with no name is "a customer", in the reader's language.
      const nameless = railSaid(l, { status: 200, n: 1, newest: { conversationId: CONV, who: null, why: 'person' } });
      expect(withoutIsolates(nameless.toast!.say)).toContain(t(l, 'common.buyer'));
    }
    // In Arabic a name in Latin letters is isolated, so the line reads right to left around it.
    expect(railSaid('ar', { status: 200, n: 3, newest: { conversationId: CONV, who: 'Amina', why: 'person' } }).toast!.say).toContain('\u2068Amina\u2069');
  });

  it('every page in a workspace draws the slot that asks it — empty, polite, with the count it was drawn with; outside one, none', () => {
    const scope = (n: number | null): RequestScope => ({ name: null, several: false, outreach: false, setup: null, needsYou: n });
    for (const l of LOCALES) {
      const html = withWorkspace(scope(4), () => shell({ title: 'T', active: 'home', locale: l, path: '/app', bodyHtml: '<p>x</p>' }));
      expect(html, l).toContain('<div class="toasts" role="status" aria-live="polite" data-rail="/app/live/rail?since=4"></div>');
    }
    const none = withWorkspace(scope(0), () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    expect(none).toContain('data-rail="/app/live/rail?since=0"');
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
    expect(dot).toContain('background:var(--color-waiting)');
    expect(dot).toContain('content:""');
    expect(dot).not.toMatch(/border(?!-radius)/);
  });

  it('the card: rounded, the bottom on a phone, the bottom inline-end on a wide screen; tokens only; logical sides only', () => {
    const box = rule('.toasts');
    expect(box).toContain('position:fixed');
    expect(box).toContain('inset-block-end:var(--space-24)');
    expect(box).toContain('inset-inline-end:var(--space-24)');
    const card = rule('.toast');
    expect(card).toContain('border-radius:var(--radius-card)');
    expect(card).toContain('min-block-size:44px');
    for (const r of [box, card]) {
      expect(r).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb|\b(left|right)\b/);
      expect(r).not.toMatch(/max-width:(?!var\(--measure-|\d+%)/);
    }
    expect(css).toMatch(/@media \(max-width: 720px\) \{\n\s*nav\.side a\.navlink\[data-fresh\]::after \{[^}]*\}\n\s*\.toasts \{ inset-inline:var\(--space-16\); inset-block-end:var\(--space-16\);/);
  });

  it('it rises in at normal speed, and only for a reader who has not asked for less motion', () => {
    const blocks = css.split('@media (prefers-reduced-motion: no-preference)');
    const moving = blocks.slice(1).map((b) => b.slice(0, b.indexOf('\n  }')));
    expect(moving.some((b) => b.includes('.toast { animation:nomi-rise var(--motion-normal) var(--motion-ease) both; }'))).toBe(true);
    // nowhere else is the card moved
    const outside = css.replace(/\.toast \{ animation:nomi-rise var\(--motion-normal\) var\(--motion-ease\) both; \}/, '');
    expect(outside).not.toMatch(/\.toasts? \{[^}]*(animation|transition)/);
  });
});
