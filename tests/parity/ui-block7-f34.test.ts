import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderBusinessScreen, type FactoryView } from '../../src/api/web/factory.js';
import { renderChannelScreen, renderConnectGuide, type ChannelsData } from '../../src/api/web/channels.js';
import { renderMetaHelp, META_HELP_STEPS } from '../../src/api/web/help.js';
import type { Viewer } from '../../src/core/conversation/people.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * UI Block 7 · F34 — Channels. Each place a customer writes says three things, each under its own label: the
 * connection, whether it can answer now, and who gets replies; then the one next step.
 * The text pass (the owner, 2026-11-26): a CALM row — answering with nothing to do, or a place not offered here — is
 * its connection alone, as one pill, and no row says "nothing for you to do". A row that needs a step keeps all three. The setup instructions fold;
 * the chat page's codes have Copy (and the page Open) beside them; every row has an icon in one column. Nothing a
 * connection does changed: every confirmation, and who may press what, is held below as it was.
 */

const STAFF: Viewer = { id: 'p2', isOwner: false };
const wa = (connected: boolean) => ({
  kind: 'whatsapp' as const, connected, status: (connected ? 'connected' : 'not_connected') as 'connected' | 'not_connected',
  healthOk: connected, displayId: connected ? '+1 555 ••• 0123' : null, lastActivityAt: null, problem: null, activated: false,
});
const base: FactoryView = {
  profile: { name: 'Juniper Skin', description: null, location: null, workingHours: null, contactEmail: null, contactPhone: null, languagesServed: ['en'] },
  products: { total: 3, needPrice: 0, names: [] },
  promises: { certs: [], floorLow: null, floorHigh: null, ceilingPct: null, ceilingVaries: false },
  connection: { channel: wa(false), ownerPhone: null, channelsUsed: [], others: [
    { channel: 'instagram', state: 'not_connected' }, { channel: 'messenger', state: 'not_connected' },
    { channel: 'email', state: 'connected', as: 'hello@juniper.test' }, { channel: 'web_chat', state: 'connected' },
  ] },
  nextStep: null,
  readiness: { canActivate: false, blockers: ['no_channel'], recipients: [], lifecycle: 'not_connected', live: false, activatedAt: null, activatedBy: null },
  rehearsal: { findings: [], violations: [], probesRun: 0, productsChecked: 0, productsTotal: 0 },
  prices: { businessDefault: null, products: [], unanswered: 0, volume: [], currency: 'USD' },
} as FactoryView;
// WhatsApp connected on record while this installation cannot send it (a local instance, or no provider yet).
const wiredHere: FactoryView = { ...base, connection: { ...base.connection, connected: { whatsapp: true } } } as FactoryView;

const home = (v: FactoryView, l: Locale = 'en', viewer?: Viewer) => withoutIsolates(renderBusinessScreen('channels', v, l, null, viewer));
const rows = (html: string) => [...html.matchAll(/<li class="ch-row">([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
// Rule 104 (the owner's condition 3) — a channel this installation cannot connect is a row with no door.
const noDoor = (html: string) => [...html.matchAll(/<li><div class="srow sr-menu">([\s\S]*?)<\/div><\/li>/g)].map((m) => m[1]!);
const said = (l: Locale, k: Parameters<typeof t>[1], p?: Record<string, string>) => esc(t(l, k, p));

describe('UI Block 7 · F34 · Channels: three states, one next step', () => {
  it('a row that needs a step shows Connection, Ready to answer and Replies, each labelled; a calm row is one pill; in every language', () => {
    for (const l of LOCALES) {
      const r = rows(home(base, l));
      // WhatsApp, Instagram and Messenger, E-mail, web chat: four doors; and every channel is still on the table.
      expect(r.length, l).toBeGreaterThanOrEqual(4);
      expect(r.length + noDoor(home(base, l)).length, l).toBeGreaterThanOrEqual(6);
      const needsStep = r.filter((row) => row.includes('ch-next'));
      const calm = r.filter((row) => !row.includes('ch-next'));
      expect(needsStep.length, l).toBeGreaterThanOrEqual(2); // WhatsApp, and Instagram and Messenger: not connected
      expect(calm.length, l).toBeGreaterThanOrEqual(2); // E-mail and web chat answering (TikTok, not offered here, is a row with no door)
      for (const row of needsStep) {
        for (const k of ['ch.k.connection', 'ch.k.ready', 'ch.k.replies'] as const) expect(row, `${l} ${k}`).toContain(`<span class="ch-k">${said(l, k)}</span>`);
      }
      for (const row of calm) {
        expect(row, l).not.toContain('ch-k');
        expect(row.match(/class="sr-value/g)?.length, l).toBe(1);
      }
    }
  });

  it('each row names its one next step; a row with nothing to do says nothing', () => {
    const r = rows(home(base));
    const wRow = r.find((x) => x.includes('/channels/whatsapp'))!;
    expect(wRow).toContain(`<span class="ch-next">${said('en', 'ch.next.connect')}</span>`);
    expect(wRow).toContain(said('en', 'ch.ready.connectFirst'));
    const mail = r.find((x) => x.includes('/channels/email'))!;
    expect(mail).toContain(`<span class="sr-value ok"><bdi>${said('en', 'connect.state.connected')}</bdi></span>`);
    expect(mail).not.toContain('ch-next');
    for (const l of LOCALES) expect(home(base, l), l).not.toContain(said(l, 'ch.next.none'));
  });

  it('a WhatsApp connected on record but not sendable here waits for Nomi’s team, never a failure', () => {
    const wRow = rows(home(wiredHere)).find((x) => x.includes('/channels/whatsapp'))!;
    expect(wRow).toContain(said('en', 'ch.ready.team'));
    expect(wRow).toContain(`<span class="ch-k">${said('en', 'ch.k.ready')}</span>`); // not calm: it still says all three
    expect(wRow).not.toContain('ch-next');
    expect(wRow).not.toMatch(/sr-value (bad|warn)/);
  });

  it('a place this installation does not offer says so once ("not set up here yet"), with no next step and no failure colour', () => {
    // Rewritten for rule 104: the row said so and still opened an empty page. It says so and opens nothing now.
    const tk = noDoor(home(base)).find((x) => x.includes(`<span class="sr-label">${said('en', 'reach.channel.tiktok')}</span>`))!;
    expect(tk).toContain(said('en', 'connect.state.notHere'));
    expect(tk.split(said('en', 'connect.state.notHere')).length - 1).toBe(1);
    expect(home(base)).not.toContain('href="/app/settings/channels/tiktok"');
    expect(tk).not.toContain('ch-k');
    expect(tk).not.toContain('ch-next');
    expect(tk).not.toMatch(/sr-value (bad|warn)/);
  });

  it('a sales assistant reads whose step it is: the owner’s', () => {
    const wRow = rows(home(base, 'en', STAFF)).find((x) => x.includes('/channels/whatsapp'))!;
    expect(wRow).toContain(`<span class="ch-next">${said('en', 'staff.ownerDecides')}</span>`);
  });

  it('F03 remainder: every channel row carries one icon in the same column', () => {
    const html = home(base);
    expect([...html.matchAll(/<a class="srow sr-menu[^"]*" href="\/app\/settings\/channels\/[a-z]+">(?!<svg)/g)].length).toBe(0);
    expect(rows(html).length).toBeGreaterThanOrEqual(4);
    for (const row of rows(html)) expect(row.match(/<svg/g)?.length, row.slice(0, 80)).toBe(2); // its shape, and the door's arrow
    expect(noDoor(html).length).toBeGreaterThanOrEqual(1);
    for (const row of noDoor(html)) expect(row.match(/<svg/g)?.length, row.slice(0, 80)).toBe(1); // its shape, in the same column; no arrow, for it opens nothing
  });
});

describe('UI Block 7 · F34 · setup instructions fold; codes have Copy and Open', () => {
  const data: ChannelsData = { whatsapp: wa(false), ownerPhone: null, templateState: 'none', outreach: new Map(), domain: null };

  it('the Instagram and Messenger help: each step a fold under its title, the first open, every id kept', () => {
    for (const l of LOCALES) {
      const html = renderMetaHelp(l);
      for (const [i, s] of META_HELP_STEPS.entries()) {
        expect(html, `${l} ${s.id}`).toContain(`<details class="sa-subject help-step" id="${s.id}"${i === 0 ? ' open' : ''}>`);
      }
      expect(html, l).toContain(said(l, 'ch.howMeta'));
    }
  });

  it('WhatsApp’s connect steps fold too, above the number they ask for', () => {
    const html = renderConnectGuide('en', { canAsk: true });
    expect(html).toMatch(/<details class="sa-subject ch-fold" id="how" open><summary>[\s\S]*?<ol class="wa-steps">[\s\S]*?<\/details>[\s\S]*?action="\/app\/channels\/whatsapp\/ask"/);
  });

  it('the chat page: Copy beside the address and the code, Open beside the address; Telegram has Copy only', () => {
    const chat = renderChannelScreen('chat', data, 'en', null, undefined, { chatPage: { url: 'https://chat.example.test/c/juniper', served: true } });
    expect(chat.match(/data-copy=/g)?.length).toBe(2);
    expect(chat).toContain(`href="https://chat.example.test/c/juniper" target="_blank" rel="noopener"`);
    expect(chat).toContain(said('en', 'ch.openNote'));
    expect(chat).toContain('role="status"');
    const tg = renderChannelScreen('telegram', data, 'en', null, undefined, { telegram: { url: 'https://t.me/juniper_bot', served: true } });
    expect(tg.match(/data-copy=/g)?.length).toBe(1);
    expect(tg).not.toContain('target="_blank"');
  });

  it('nothing a connection does changed: disconnect still asks first, and the chat page’s Off still confirms', () => {
    const on = renderChannelScreen('whatsapp', { ...data, whatsapp: wa(true) }, 'en', null);
    expect(on).toContain(`data-confirm="${said('en', 'channel.action.disconnectConfirm')}"`);
    const chat = renderChannelScreen('chat', data, 'en', null, undefined, { chatPage: { url: 'https://chat.example.test/c/j', served: true } });
    expect(chat).toMatch(/onclick="return confirm\(this\.dataset\.confirm\)" data-confirm=/);
    const staff = renderChannelScreen('chat', data, 'en', null, STAFF, { chatPage: { url: 'https://chat.example.test/c/j', served: true } });
    expect(staff).not.toContain('action="/app/channels/chat"');
  });

  it('the new classes are styled with logical sides only, and every fold here is a sa-subject the deep link opens', () => {
    const css = readFileSync(new URL('../../src/api/web/settingsAreaStyle.ts', import.meta.url), 'utf8');
    const ours = css.split('\n').filter((x) => /\.ch-(states|state|k|v|next|code|tools|said)|\.help-step/.test(x)).join('\n');
    expect(ours).toContain('.ch-states{');
    expect(ours).not.toMatch(/(?:^|[;{])\s*(?:margin|padding|border)-(?:left|right)|text-align:(?:left|right)|\b(?:left|right):/);
    const script = readFileSync(new URL('../../src/api/web/liveScript.ts', import.meta.url), 'utf8');
    expect(script).toContain("closest('details.sa-subject,details.ak-add')");
  });
});
