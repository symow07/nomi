import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { csvFile, csvFilename } from '../../core/owner/csv.js';
import type { AdvisorMemory, MemoryState } from '../../advisor/memory.js';
import { t } from './say.js';
import { esc, deeper } from './layout.js';
import { icon } from './icons.js';
import { flashBanner, type Flash } from './flash.js';
import { fieldRow } from './rows.js';
import { rowSwitch, setNotice, type DangerRow } from './settingsPage.js';
import * as show from './values.js';

/**
 * SETTINGS → THE ADVISOR'S HISTORY, a door of Your data too (0130; docs/ADVISOR-MEMORY.md §3, §5, D1, D2, D4, D6).
 *
 *   · Everyone: their own switch (the opt-in sentence, word for word), what it is now, and their own
 *     download (D4). Turning it off asks once, with what it means, then deletes at once (§5a). After a
 *     second "Not now" on the advisor's card, this is the only way to turn it on (D6).
 *   · The owner, besides: the workspace's switch (D1; off deletes everyone's), and the team — a control per
 *     person to delete their history WITHOUT reading it (D2), there for everyone on the team whether or not
 *     they kept anything, its result the same either way, so it never tells the owner who said yes.
 *   · Nothing here reads anyone's words but the viewer's own download. The port (src/advisor/memory.ts) is the
 *     only way in; every call names the workspace and the person.
 */

export type HistoryViewer = { readonly businessId: string; readonly personId: string; readonly isOwner: boolean };

export type AdvisorHistoryIO = {
  readonly viewer: (req: FastifyRequest) => HistoryViewer | null;
  readonly locale: (req: FastifyRequest) => Locale;
  readonly page: (req: FastifyRequest, o: { readonly title: string; readonly active: string; readonly bodyHtml: string }) => string;
  readonly memory: AdvisorMemory | null;
  /** The provider that words the answers, as the privacy page names it. */
  readonly processor: (locale: Locale) => string;
  readonly flashTo: (reply: FastifyReply, path: string, key: MessageKey, params?: Record<string, string>) => FastifyReply;
  readonly takeFlash: (req: FastifyRequest, reply: FastifyReply) => Flash | null;
  /** The CSV dialect the reader's spreadsheet expects. */
  readonly dialect: (locale: Locale) => Parameters<typeof csvFile>[2];
};

export const HISTORY_PAGE = '/app/settings/advisor-history';
export const PERSONAL_HISTORY_PAGE = '/app/settings/personal/advisor-history';
export const HISTORY_POLICY_PAGE = '/app/settings/assistant/history-policy';
export const HISTORY_FILE = '/app/settings/advisor-history/history.csv';

export type HistoryPage = {
  readonly state: MemoryState;
  readonly isOwner: boolean;
  readonly team: readonly { readonly id: string; readonly name: string }[];
  readonly processor: string;
};

/** The page. */
export function renderAdvisorHistory(locale: Locale, v: HistoryPage, flash: Flash | null): string {
  const s = v.state;
  const say = (k: MessageKey, p: Record<string, string> = {}) => esc(t(locale, k, p));
  // UI Block 7 (F37) — turning history on is the act these pages lead with; turning it off and deleting a person's
  // history are drawn secondary (outlined), each keeping its confirmation, route and value.
  const button = (action: string, name: string, value: string, label: string, confirm?: string) =>
    `<form method="post" action="${action}" class="inline"><button class="btn${confirm ? ' hist-quiet' : ''}" type="submit" name="${name}" value="${value}"${confirm
      ? ` onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(confirm)}"` : ''}>${esc(label)}</button></form>`;

  const why = s.keyProblem ? `<p class="muted">${say('advisor.history.keyMissing')}</p>`
    : !s.person ? `<p class="muted">${say('advisor.history.noPerson')}</p>`
    : !s.workspaceOn && !v.isOwner ? `<p class="muted">${say('advisor.history.workspaceWaits')} ${say('staff.ownerDecides')}</p>` : '';
  const mineState = s.keep && s.since ? say('advisor.memory.on', { date: show.date(locale, s.since) }) : say('advisor.memory.offState');
  const mineAct = s.keep
    ? button(`${HISTORY_PAGE}/me`, 'on', 'off', t(locale, 'advisor.history.turnOff'), t(locale, 'advisor.memory.confirm', { processor: v.processor }))
    : s.workspaceOn && s.person && !s.keyProblem ? button(`${HISTORY_PAGE}/me`, 'on', 'on', t(locale, 'advisor.history.turnOn')) : '';
  const mine = `<section class="block" id="mine">
      <h2>${say('advisor.history.mine')}</h2>
      <p>${say('advisor.memory.ask')}</p>
      <p class="muted">${mineState}</p>
      ${why}
      ${mineAct}
      ${s.person ? `<ul class="scard dl-files"><li class="row">
        <span>${say('advisor.thread.earlier')}</span>
        <a class="dl-get" href="${HISTORY_FILE}" download>${icon('download')}<span>${say('advisor.memory.download')}</span></a>
      </li></ul>` : ''}
      <div class="doors">${deeper('/app/advisor', t(locale, 'advisor.history.open'))}</div>
    </section>`;
  return `<h1 class="page">${say('settingsArea.history')}</h1>${flashBanner(flash)}${mine}`;
}

/**
 * The settings overhaul (rule 104) — the WORKSPACE's part of the history policy lives on Data and privacy (it was a
 * page of its own): the workspace's switch as a row that acts at once (D1; turning it off asks first, and deletes
 * everyone's), and — in that page's danger zone — a row per team member to delete their history unread (D2), there
 * for everyone whether or not they kept anything, so it never tells the owner who said yes.
 */
export const DATA_HISTORY = '/app/settings/business/data#advisor-history';
export const DATA_DANGER = '/app/settings/business/data#danger-zone';
export function historyWorkspaceRows(locale: Locale, workspaceOn: boolean): string[] {
  return [
    fieldRow({ label: t(locale, 'advisor.history.workspace'), desc: t(locale, 'advisor.history.workspaceHelp'),
      control: rowSwitch(locale, { action: `${HISTORY_PAGE}/workspace`, on: workspaceOn, label: t(locale, 'advisor.history.workspace'), values: ['on', 'off'], verbs: [t(locale, 'advisor.history.turnOn'), t(locale, 'advisor.history.turnOff')],
        ...(workspaceOn ? { confirm: t(locale, 'advisor.history.workspaceConfirm') } : {}) }) }),
    setNotice({ text: t(locale, workspaceOn ? 'advisor.flash.workspaceOn' : 'advisor.history.workspaceWaits') }),
    setNotice({ text: t(locale, 'advisor.history.teamHelp') }),
  ];
}
export function historyDangerRows(locale: Locale, team: readonly { readonly id: string; readonly name: string }[]): DangerRow[] {
  return team.map((p) => ({
    title: t(locale, 'advisor.memory.ownerDelete', { name: p.name }), what: t(locale, 'ws.data.historyDelete'),
    action: `${HISTORY_PAGE}/team/${p.id}/delete`, verb: t(locale, 'ws.data.delete'),
    confirm: t(locale, 'advisor.memory.ownerDeleteConfirm', { name: p.name }), hidden: { go: '1' }, id: `history-${p.id}`,
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page, its switches, the owner's delete-without-reading, and each person's own download. Quiet routes. */
export function advisorHistoryRoutes(app: FastifyInstance, io: AdvisorHistoryIO): void {
  const OFF: MemoryState = { workspaceOn: false, consent: null, since: null, keep: false, ask: false, keyProblem: null, person: false };
  const stateOf = (v: HistoryViewer) => (io.memory ? io.memory.state(v.businessId, v.personId, new Date()).catch(() => OFF) : Promise.resolve(OFF));

  // Rule 104 — the workspace's history policy is a section of Data and privacy: its older address opens it there
  // (the owner's); anyone else is sent to their own history, as before.
  app.get(HISTORY_POLICY_PAGE, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    return reply.redirect(v.isOwner ? DATA_HISTORY : PERSONAL_HISTORY_PAGE);
  });
  app.get(PERSONAL_HISTORY_PAGE, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    const locale = io.locale(req);
    const state = await stateOf(v);
    return reply.type('text/html; charset=utf-8').send(io.page(req, {
      title: t(locale, 'advisor.history.title'), active: 'settings',
      bodyHtml: renderAdvisorHistory(locale, { state, isOwner: v.isOwner, team: [], processor: io.processor(locale) }, io.takeFlash(req, reply)),
    }));
  });

  // Their own switch: on is their yes (only where the workspace allows it); off takes it back and deletes at once.
  app.post(`${HISTORY_PAGE}/me`, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    if (!io.memory) return io.flashTo(reply, PERSONAL_HISTORY_PAGE, 'advisor.flash.failed');
    const on = String((req.body as { on?: unknown } | undefined)?.on ?? '') === 'on';
    const state = await stateOf(v);
    if (on && (!state.workspaceOn || !state.person || state.keyProblem)) return io.flashTo(reply, PERSONAL_HISTORY_PAGE, 'advisor.flash.failed');
    if (!on && !state.keep) return reply.redirect(PERSONAL_HISTORY_PAGE);
    const r = await io.memory.consent(v.businessId, v.personId, on ? 'granted' : 'withdrawn', io.locale(req));
    return io.flashTo(reply, PERSONAL_HISTORY_PAGE, r !== 'ok' ? 'advisor.flash.failed' : on ? 'advisor.flash.on' : 'advisor.flash.deleted');
  });

  // D1 — the workspace's switch, the owner's alone (the database refuses anyone else: NE022). Off deletes everyone's.
  app.post(`${HISTORY_PAGE}/workspace`, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    if (!v.isOwner || !io.memory) return io.flashTo(reply, v.isOwner ? DATA_HISTORY : PERSONAL_HISTORY_PAGE, 'advisor.flash.failed');
    const on = String((req.body as { on?: unknown } | undefined)?.on ?? '') === 'on';
    const r = await io.memory.workspace(v.businessId, v.personId, on);
    return io.flashTo(reply, DATA_HISTORY, r !== 'ok' ? 'advisor.flash.failed' : on ? 'advisor.flash.workspaceOn' : 'advisor.flash.workspaceOff');
  });

  // D2 — a team member's history, deleted whole and unread, by the owner. The notice reads the same whether
  // or not anything was kept: it never says who said yes.
  app.post(`${HISTORY_PAGE}/team/:id/delete`, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    const id = (req.params as { id: string }).id;
    if (!v.isOwner || !io.memory || !UUID.test(id) || id === v.personId) return io.flashTo(reply, v.isOwner ? DATA_DANGER : PERSONAL_HISTORY_PAGE, 'advisor.flash.failed');
    const member = (await io.memory.team(v.businessId, v.personId).catch(() => [])).find((p) => p.id === id);
    if (!member) return io.flashTo(reply, DATA_DANGER, 'advisor.flash.failed');
    const r = await io.memory.forget(v.businessId, v.personId, id, null);
    return io.flashTo(reply, DATA_DANGER, r === 'ok' ? 'advisor.flash.ownerDeleted' : 'advisor.flash.failed', { name: member.name });
  });

  // D4 — their own history, and no one else's: the person is the transaction's, and row security answers.
  app.get(HISTORY_FILE, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    const locale = io.locale(req);
    const rows = io.memory ? await io.memory.exportOwn(v.businessId, v.personId, locale) : [];
    const header = ['advisor.export.conversation', 'advisor.export.started', 'advisor.export.asked', 'advisor.export.question', 'advisor.export.answer']
      .map((k) => t(locale, k as MessageKey));
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${csvFilename('advisor-history', new Date())}"`)
      .header('cache-control', 'no-store')
      .send(csvFile(header, rows, io.dialect(locale)));
  });
}
