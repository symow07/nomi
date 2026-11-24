import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderDataRights } from '../../src/api/web/dataRights.js';
import { renderPhoneAlerts, type AlertWaysView, type PhoneAlertsView } from '../../src/api/web/phoneAlerts.js';
import { renderAdvisorHistory, type HistoryPage } from '../../src/api/web/advisorHistory.js';
import { SETTINGS_AREA_CSS } from '../../src/api/web/settingsAreaStyle.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * UI Block 7 · F37 — Data and personal settings. Your data names its subjects at the top; closing the workspace is a
 * review of its own, its whole consequence beside the unchanged form, and no button says only "Send the request".
 * Notifications puts its first control straight after the two things it is about, and each Save names what it saves.
 * The advisor's history leads with turning it on; turning it off and deleting a person's history are secondary, each
 * keeping its confirmation.
 */

const NOW = new Date('2026-11-24T09:00:00Z');
const data = (closable?: boolean, isOwner = true) => withoutIsolates(renderDataRights(
  { businessName: 'Juniper Skin', requests: [], ...(closable === undefined ? {} : { closable }) }, 'en', null, isOwner ? OWNER_VIEW : { isOwner: false }, 'Setup'));

describe('F37 · Your data: subjects named at the top; closing a review of its own', () => {
  it('a subject index leads the page, each a door to its own section', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(renderDataRights({ businessName: 'Juniper Skin', requests: [] }, l, null, OWNER_VIEW, 'x'));
      expect(h, l).toContain(`<nav class="dr-index" aria-labelledby="dr-index-h"><p class="dr-index-h" id="dr-index-h">${esc(t(l, 'data.index'))}</p><ul>`);
      for (const [id, k] of [['copy', 'data.export.title'], ['advisor-history', 'advisor.history.title'], ['buyers', 'data.buyers.title'], ['close', 'data.deletion.title']] as const) {
        expect(h, `${l} ${id}`).toContain(`<li><a href="#${id}">${esc(t(l, k))}</a></li>`);
        expect(h, `${l} ${id}`).toContain(`id="${id}"`);
      }
      expect(h.indexOf('class="dr-index"'), l).toBeLessThan(h.indexOf('id="copy"'));
    }
  });
  it('closing: one line under the heading, then a closed review holding the whole consequence beside the unchanged form', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(renderDataRights({ businessName: 'Juniper Skin', requests: [] }, l, null, OWNER_VIEW, 'x'));
      const close = h.slice(h.indexOf('id="close"'));
      expect(close, l).toContain(`<p class="dr-short">${esc(t(l, 'data.close.short'))}</p>`);
      const fold = close.indexOf(`<details class="sa-subject data-review"><summary><span>${esc(t(l, 'data.close.review'))}</span></summary>`);
      expect(fold, l).toBeGreaterThan(-1);
      const both = l === 'zh' ? `${t(l, 'data.deletion.lead')}${t(l, 'data.deletion.now')}` : `${t(l, 'data.deletion.lead')} ${t(l, 'data.deletion.now')}`;
      const at = close.indexOf(`<p class="lede">${esc(both)}</p>`);
      const form = close.indexOf('<form method="post" action="/app/settings/data/close">');
      expect(at, l).toBeGreaterThan(fold);
      expect(form, l).toBeGreaterThan(at);
      // Unchanged: the typed name, the red button, its words, its confirmation.
      expect(close, l).toContain('<input id="dr-name" name="name" required');
      expect(close, l).toContain(`data-confirm="${esc(t(l, 'data.deletion.confirm'))}">${esc(t(l, 'data.deletion.close'))}</button>`);
      expect(close, l).toContain('<button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)"');
    }
  });
  it('the installation\'s own workspace: the button says what it asks for, in a review of its own, with its confirmation', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(renderDataRights({ businessName: 'Juniper Skin', requests: [], closable: false }, l, null, OWNER_VIEW, 'x'));
      expect(h, l).toContain(`<summary><span>${esc(t(l, 'data.close.reviewAsk'))}</span></summary>`);
      expect(h, l).toContain(`data-confirm="${esc(t(l, 'data.deletion.askConfirm'))}">${esc(t(l, 'data.deletion.ask'))}</button>`);
      expect(h, l).toContain(esc(t(l, 'data.deletion.protected')));
    }
    expect(t('en', 'data.deletion.ask')).toBe('Ask the Nomi team to erase this workspace');
    expect(data(false)).not.toMatch(/>Send the request</);
  });
  it('an open request stays a standing state outside the review, with its own Take that back', () => {
    const h = withoutIsolates(renderDataRights({ businessName: 'Juniper Skin', closable: false,
      requests: [{ id: 'r1', scope: 'workspace', subjectNote: null, askedBy: 'owner', askedAt: NOW, state: 'open', closedAt: null, closedNote: null }] },
    'en', null, OWNER_VIEW, 'x'));
    expect(h).toContain(`<p><span class="pill warn">${esc(t('en', 'data.deletion.state.open'))}</span>`);
    expect(h).toContain(`data-confirm="${esc(t('en', 'data.deletion.withdrawConfirm'))}">${esc(t('en', 'data.deletion.withdraw'))}</button>`);
    expect(h).not.toContain('data-review');
  });
  it('someone not the owner reads what closing does and that it is the owner\'s; nothing to press', () => {
    const h = data(undefined, false);
    expect(h).toContain(esc(t('en', 'data.deletion.ownerOnly')));
    expect(h).not.toContain('/app/settings/data/close');
    expect(h).not.toContain('data-review');
  });
});

describe('F37 · Notifications: the first control straight after the two things; each Save names its scope', () => {
  const ways = (over: Partial<AlertWaysView> = {}): AlertWaysView =>
    ({ choice: null, isOwner: true, email: 'owner@example.test', whatsapp: 'number', ownerPhone: null, ...over });
  const view = (w: AlertWaysView): PhoneAlertsView => ({ publicKey: 'BKEY', phones: [], ways: w });
  it('nothing but the two things stands between the heading and the way choice; what stays in Nomi is said under it', () => {
    for (const l of LOCALES) {
      const h = withoutIsolates(renderPhoneAlerts(view(ways()), l, null));
      const list = h.indexOf('</ul>', h.indexOf('class="two-ways"'));
      const choice = h.indexOf('<section class="sgroup" aria-labelledby="alerts-way">');
      expect(h.slice(list + 5, choice).trim(), l).toBe('');
      expect(h.indexOf(`<p class="ways-sub ways-after">${esc(t(l, 'alerts.rest'))}</p>`), l).toBeGreaterThan(choice);
      expect(h.indexOf(esc(t(l, 'alerts.alsoMail'))), l).toBeGreaterThan(choice);
    }
  });
  it('each Save says what it saves: the way, the morning summary, the number', () => {
    const bare: Record<string, string> = { en: 'Save', zh: '保存', ar: 'حفظ', es: 'Guardar', fr: 'Enregistrer' };
    for (const l of LOCALES) {
      for (const k of ['alerts.way.save', 'alerts.morning.save', 'settings.alerts.save'] as MessageKey[]) {
        expect(t(l, k), `${l} ${k}`).not.toBe(bare[l]);
      }
    }
    expect([t('en', 'alerts.way.save'), t('en', 'alerts.morning.save'), t('en', 'settings.alerts.save')])
      .toEqual(['Save how they reach you', 'Save the morning summary', 'Save the number']);
    const h = withoutIsolates(renderPhoneAlerts({ publicKey: null, phones: [], ways: { ...ways({ whatsapp: 'early', ownerPhone: '+1 555 0100' }), morning: { on: true, quietFrom: 22, quietUntil: 7 } } }, 'en', null));
    expect(h).toContain('>Save how they reach you</button>');
    expect(h).toContain('>Save the morning summary</button>');
    expect(readFileSync('src/api/web/channels.ts', 'utf8')).toContain("<button class=\"btn\">${esc(t(locale, 'settings.alerts.save'))}</button>");
  });
  it('quiet hours: From and Until side by side, each label on its own control', () => {
    const h = withoutIsolates(renderPhoneAlerts({ publicKey: null, phones: [], ways: { ...ways(), morning: { on: false, quietFrom: null, quietUntil: null } } }, 'en', null));
    expect(h).toContain('<div class="quiet-pair">');
    expect(h).toMatch(/<span class="quiet-one"><label for="quiet-from">From<\/label> <select id="quiet-from" name="quietFrom">/);
    expect(h).toMatch(/<span class="quiet-one"><label for="quiet-until">Until<\/label> <select id="quiet-until" name="quietUntil">/);
    expect(SETTINGS_AREA_CSS).toContain('.quiet-pair{display:flex;flex-wrap:wrap;');
  });
});

describe('F37 · the advisor\'s history: on is the lead; off and a person\'s delete are secondary, still asked first', () => {
  const state = (over: Partial<HistoryPage['state']> = {}): HistoryPage['state'] =>
    ({ workspaceOn: true, consent: null, since: null, keep: false, ask: false, keyProblem: null, person: true, ...over });
  const page = (s: HistoryPage['state'], team: HistoryPage['team'] = []): HistoryPage => ({ state: s, isOwner: true, team, processor: 'X' });
  it('Turn on is a filled button; Turn off is outlined and keeps its confirmation', () => {
    for (const l of LOCALES) {
      const on = renderAdvisorHistory(l, page(state()), null, 'mine');
      expect(on, l).toContain(`<button class="btn" type="submit" name="on" value="on">${esc(t(l, 'advisor.history.turnOn'))}</button>`);
      const off = renderAdvisorHistory(l, page(state({ keep: true, since: NOW })), null, 'mine');
      expect(off, l).toContain(`<button class="btn hist-quiet" type="submit" name="on" value="off" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(l, 'advisor.memory.confirm', { processor: 'X' }))}">${esc(t(l, 'advisor.history.turnOff'))}</button>`);
    }
  });
  it('the history policy: the workspace switch off and each person\'s delete are outlined, on their row, still asked first', () => {
    for (const l of LOCALES) {
      const h = renderAdvisorHistory(l, page(state(), [{ id: 'p-s', name: 'Sam Rivera' }]), null, 'workspace');
      expect(h, l).toContain('<ul class="rows hist-team">');
      expect(h, l).toContain(`<button class="btn hist-quiet" type="submit" name="go" value="1" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(l, 'advisor.memory.ownerDeleteConfirm', { name: 'Sam Rivera' }))}">${esc(t(l, 'advisor.memory.ownerDelete', { name: 'Sam Rivera' }))}</button>`);
      expect(h, l).toContain(`value="off" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(l, 'advisor.history.workspaceConfirm'))}"`);
      expect(h, l).not.toMatch(/<button class="btn" [^>]*data-confirm/);
    }
    expect(SETTINGS_AREA_CSS).toContain('.settings-area .btn.hist-quiet{background:transparent;color:var(--color-ink);border:1px solid var(--color-ink);}');
  });
});

describe('F37 · every new line is its own language', () => {
  it('zh, ar, es and fr each have their own words', () => {
    const keys = ['data.index', 'data.close.short', 'data.close.review', 'data.close.reviewAsk', 'data.deletion.ask',
      'alerts.way.save', 'alerts.morning.save', 'settings.alerts.save'] as MessageKey[];
    for (const k of keys) for (const l of LOCALES) if (l !== 'en') expect(t(l, k), `${l} ${k}`).not.toBe(t('en', k));
  });
});
