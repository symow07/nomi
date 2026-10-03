import { withTenantTx, type Db } from '../../db/client.js';
import { liveMailAccount, type MailAccount } from '../../db/mailAccounts.js';
import { sendingDomain } from '../../db/sendingDomain.js';
import { OAUTH_PROVIDERS, type OAuthClients, type OAuthProvider } from '../../connectors/oauth.js';
import { CHANNEL_REGISTRY, type OutreachChannel } from '../../core/channel/registry.js';
import type { KeyStatus } from '../../prospects/service.js';
import type { BusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { type MessageKey } from '../../core/owner/i18n/messages.js';
import { t, assistantName } from './say.js';

import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { deeper, esc } from './layout.js';
import { listOfNames, type InboundLink } from './channels.js';
import * as show from './values.js';

/**
 * C6 · M50 — every account she links, in one place, each honest about itself.
 *
 * A READ MODEL THAT HOLDS MORE THAN ONE ACCOUNT. The page read one WhatsApp
 * channel; it now reads a list, and each row answers the same three questions
 * whatever it is: is it connected, as what, and what does connecting it let her
 * do. "Not connected" and "not set up here" are different rows with different
 * sentences — a Connect button for an app this installation has no client for
 * would be a button that can only fail.
 *
 * WhatsApp keeps its own card above: its lifecycle (connect, activate, test,
 * disconnect) is the pilot's, and this list does not repeat it.
 */

export type AccountsView = {
  /** The live sending mailbox, if any. */
  readonly mail: Pick<MailAccount, 'provider' | 'address' | 'connectedBy' | 'connectedAt' | 'needsAttention' | 'readsInbox'> | null;
  /** Which providers can be connected HERE: a client configured and a public address to return to. */
  readonly connectable: Readonly<Record<OAuthProvider, boolean>>;
  /** The verified-domain name, to warn when the mailbox is not on it. */
  readonly sendingDomain: string | null;
  /**
   * The address this installation's own mail server sends as, when the host
   * configured one. It OUTRANKS a connected mailbox, so the page must say so:
   * a row reading "connected" beside a Gmail nobody sends through any more is
   * the kind of quiet lie this page exists to refuse.
   */
  readonly smtpFrom: string | null;
  readonly apollo: KeyStatus;
};

/**
 * Which mail providers can be connected HERE: a client configured and a public
 * address to return to. One answer, read by this page and by My business
 * (Phase 4b), so a mailbox is never offered on one and missing on the other.
 */
export const mailConnectable = (
  clients: OAuthClients, publicBaseUrl: string | null,
): Readonly<Record<OAuthProvider, boolean>> =>
  Object.fromEntries(OAUTH_PROVIDERS.map((p) =>
    [p, publicBaseUrl !== null && clients[p] !== undefined])) as Record<OAuthProvider, boolean>;

export async function loadAccounts(
  db: Db, businessId: BusinessId,
  o: {
    readonly clients: OAuthClients; readonly publicBaseUrl: string | null;
    readonly apollo: KeyStatus; readonly smtpFrom?: string | null;
  },
): Promise<AccountsView> {
  const { mail, domain } = await withTenantTx(db, businessId, async (tx) => ({
    mail: await liveMailAccount(tx, businessId),
    domain: await sendingDomain(tx, businessId),
  }));
  return {
    mail: mail ? {
      provider: mail.provider, address: mail.address, connectedBy: mail.connectedBy,
      connectedAt: mail.connectedAt, needsAttention: mail.needsAttention, readsInbox: mail.readsInbox,
    } : null,
    connectable: mailConnectable(o.clients, o.publicBaseUrl),
    sendingDomain: domain?.domain ?? null,
    smtpFrom: o.smtpFrom ?? null,
    apollo: o.apollo,
  };
}

/**
 * A sentence in her language with an address in it: the ADDRESS is isolated,
 * not the sentence — wrapped whole, an Arabic sentence around a Latin address
 * lays out in the wrong order (the company line's lesson, C5).
 */
const withAddress = (locale: Locale, key: MessageKey, address: string): string =>
  esc(t(locale, key, { address: '\u0000' })).replace('\u0000', `<bdi>${esc(address)}</bdi>`);

type Row = { readonly name: string; readonly tone: 'ok' | 'warn' | 'stop'; readonly state: string; readonly body: string };

/**
 * Phase 9 — an account this installation cannot connect is not a row with a
 * developer's reason ("This installation has no app for it yet"): it is named
 * once, in one plain line, so the owner knows it exists and is not offered
 * here. Absent from the rows, it promises nothing.
 */
type Unavailable = { readonly unavailable: string };
const isUnavailable = (r: Row | Unavailable): r is Unavailable => 'unavailable' in r;

function mailRow(locale: Locale, v: AccountsView, provider: OAuthProvider, viewer: Viewer): Row | Unavailable {
  const name = t(locale, `channel.platform.${provider}` as MessageKey);
  const mine = v.mail?.provider === provider ? v.mail : null;
  // E1 — reading is a grant she makes on purpose: a box, unticked, beside the
  // button. Google only, for now: that is the one reader built.
  const start = provider === 'google'
    ? `<form method="get" action="/app/connect/${provider}/start" class="pform">
        <label class="as-box"><input type="checkbox" name="read" value="1" /> <span>${esc(t(locale, 'connect.mail.read.tick'))}</span></label>
        <button class="btn ${mine ? '' : 'send'}" type="submit">${esc(t(locale, mine ? 'connect.action.reconnect' : 'connect.action.connect'))}</button>
      </form>`
    : `<form method="get" action="/app/connect/${provider}/start" class="inline">
        <button class="btn ${mine ? '' : 'send'}" type="submit">${esc(t(locale, mine ? 'connect.action.reconnect' : 'connect.action.connect'))}</button>
      </form>`;

  if (mine && mine.needsAttention) {
    return {
      name, tone: 'warn', state: t(locale, 'connect.state.attention'),
      body: `<p class="muted">${withAddress(locale, 'connect.mail.attention', mine.address)}</p>
        ${viewer.isOwner && v.connectable[provider] ? start : ''}`,
    };
  }
  if (mine) {
    const offDomain = v.sendingDomain !== null && !mine.address.endsWith(`@${v.sendingDomain}`);
    return {
      name, tone: offDomain || v.smtpFrom ? 'warn' : 'ok', state: t(locale, 'connect.state.connected'),
      body: `<p>${v.smtpFrom
        ? withAddress(locale, 'connect.mail.outranked', mine.address)
        : withAddress(locale, 'connect.mail.sendsAs', mine.address)}</p>
        <p class="muted">${esc(t(locale, 'connect.mail.connectedBy', { who: mine.connectedBy, date: show.date(locale, mine.connectedAt) }))}</p>
        ${provider === 'google' ? `<p class="${mine.readsInbox ? '' : 'muted'}">${mine.readsInbox
          ? withAddress(locale, 'connect.mail.reads', mine.address)
          : esc(t(locale, 'connect.mail.sendsOnly'))}</p>` : ''}
        ${offDomain ? `<p class="muted">${esc(t(locale, 'connect.mail.offDomain', { domain: v.sendingDomain! }))}</p>` : ''}
        ${viewer.isOwner && provider === 'google' && !mine.readsInbox && v.connectable[provider] ? start : ''}
        ${viewer.isOwner ? `<form method="post" action="/app/connect/mail/disconnect" class="inline">
          <button class="btn stop" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'connect.action.disconnectConfirm', { address: mine.address }))}">${esc(t(locale, 'connect.action.disconnect'))}</button></form>` : ''}`,
    };
  }
  if (!v.connectable[provider]) return { unavailable: name };
  // Phase 9 — not connected yet waits on nothing: the plain pill, not amber.
  return {
    name, tone: 'stop', state: t(locale, 'connect.state.notConnected'),
    body: `<p class="muted">${esc(t(locale, `connect.mail.${provider}.what` as MessageKey))}</p>
      ${v.mail ? `<p class="muted">${withAddress(locale, 'connect.mail.replaces', v.mail.address)}</p>` : ''}
      ${viewer.isOwner ? start : `<p class="muted">${esc(t(locale, 'staff.ownerDecides'))}</p>`}`,
  };
}

/**
 * The installation's own mail server. Nothing to press: whoever runs the
 * installation set it, and she cannot change it from here — so the row says what
 * it is, and whether the address matches the domain she verified.
 */
function smtpRow(locale: Locale, v: AccountsView): Row {
  const from = v.smtpFrom!;
  const offDomain = v.sendingDomain !== null && !from.endsWith(`@${v.sendingDomain}`);
  return {
    name: t(locale, 'connect.smtp.name'), tone: offDomain ? 'warn' : 'ok',
    state: t(locale, 'connect.state.connected'),
    body: `<p>${withAddress(locale, 'connect.mail.sendsAs', from)}</p>
      <p class="muted">${esc(t(locale, 'connect.smtp.what'))}</p>
      ${offDomain ? `<p class="muted">${esc(t(locale, 'connect.mail.offDomain', { domain: v.sendingDomain! }))}</p>` : ''}`,
  };
}

/**
 * C9 — what the host configured for the two channels buyers start, and which
 * of them she connected. The reach cards below read the same map; this list
 * must not answer differently.
 */
export type InboundLinks = ReadonlyMap<OutreachChannel, InboundLink>;

export function renderAccounts(
  v: AccountsView, locale: Locale, viewer: Viewer = OWNER_VIEW, inbound: InboundLinks = new Map(),
  /**
   * Phase 9 (w4-business-assistant-05) — on E-mail's own screen, the mail
   * accounts only; Instagram's and Messenger's state is their screen's.
   */
  only?: 'mail',
): string {
  // Phase 9 (V1-434) — Apollo is not one of the owner's accounts customers
  // reach her through: its key is set where it is used, on Prospects.
  const all: (Row | Unavailable)[] = [
    ...(v.smtpFrom ? [smtpRow(locale, v)] : []),
    mailRow(locale, v, 'google', viewer),
    mailRow(locale, v, 'microsoft', viewer),
    // M39 — what the platform permits, said as the registry says it: these two
    // can only ever answer someone who wrote first. C9 made them connectable,
    // and until 2026-09-17 this row went on saying "not connected" above a
    // card that said "connected" — two answers on one page. The Connect button
    // stays on the card below, where the rule it is subject to is explained;
    // here is only the state, the same three states as the mail rows: no
    // account configured on this host, configured and hers to connect, connected.
    // Phase 9 (missed-20) — the row says the account's state, not the rule
    // about writing first (its card below says that), and where to go next:
    // the card below to connect it, the help page for what to check.
    ...(only === 'mail' ? [] : ['instagram', 'messenger'] as const).map((ch): Row | Unavailable => {
      const link = inbound.get(ch);
      const here = CHANNEL_REGISTRY[ch].availableHere && link?.configured === true;
      const name = t(locale, `reach.channel.${ch}` as MessageKey);
      if (!here && !link?.connected) return { unavailable: name };
      return {
        name,
        tone: link?.connected ? (link.needsAttention ? 'warn' : 'ok') : 'stop',
        state: t(locale, link?.connected ? (link.needsAttention ? 'connect.state.attention' : 'connect.state.connected') : 'connect.state.notConnected'),
        body: `${link?.connected
          ? `<p class="muted">${esc(link.connectedAs
            ? t(locale, 'reach.inbound.connectedAs', { page: link.connectedAs })
            : t(locale, 'reach.inbound.connected', { name: assistantName(locale) }))}</p>`
          : `<p class="muted">${esc(t(locale, 'connect.inbound.below'))}</p>`}
          ${deeper('/app/help/meta', t(locale, 'meta.panel.help'))}`,
      };
    }),
  ];
  const rows = all.filter((r): r is Row => !isUnavailable(r));
  const unavailable = all.filter(isUnavailable).map((r) => r.unavailable);
  const mailHere = rows.some((r) => r.name === t(locale, 'channel.platform.google') || r.name === t(locale, 'channel.platform.microsoft')
    || r.name === t(locale, 'connect.smtp.name'));

  return `<div class="block" id="accounts">
    <h2>${esc(t(locale, 'connect.title'))}</h2>
    <p class="muted ch-desc">${esc(t(locale, 'connect.intro', { name: assistantName(locale) }))}${
      mailHere ? `${locale === 'zh' ? '' : ' '}${esc(t(locale, 'connect.intro.mail'))}` : ''}</p>
    ${rows.length ? `<ul class="rows">${rows.map((r) => `<li class="row lines">
      <div class="dhead spread"><span class="ch-name">${esc(r.name)}</span><span class="pill ${r.tone}">${esc(r.state)}</span></div>
      ${r.body}
    </li>`).join('')}</ul>` : ''}
    ${unavailable.length ? `<p class="muted small">${listOfNames(locale, 'connect.unavailable', unavailable)}</p>` : ''}
  </div>`;
}
