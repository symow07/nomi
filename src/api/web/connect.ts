import { withTenantTx, type Db } from '../../db/client.js';
import { liveMailAccount, type MailAccount } from '../../db/mailAccounts.js';
import { sendingDomain } from '../../db/sendingDomain.js';
import { OAUTH_PROVIDERS, type OAuthClients, type OAuthProvider } from '../../connectors/oauth.js';
import { CHANNEL_REGISTRY, type OutreachChannel } from '../../core/channel/registry.js';
import type { KeyStatus } from '../../prospects/service.js';
import type { BusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { formatDate } from '../../core/owner/i18n/format.js';
import { OWNER_VIEW, type Viewer } from '../../core/conversation/people.js';
import { esc } from './layout.js';

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
  readonly mail: Pick<MailAccount, 'provider' | 'address' | 'connectedBy' | 'connectedAt' | 'needsAttention'> | null;
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
      connectedAt: mail.connectedAt, needsAttention: mail.needsAttention,
    } : null,
    connectable: Object.fromEntries(OAUTH_PROVIDERS.map((p) =>
      [p, o.publicBaseUrl !== null && o.clients[p] !== undefined])) as Record<OAuthProvider, boolean>,
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

function mailRow(locale: Locale, v: AccountsView, provider: OAuthProvider, viewer: Viewer): Row {
  const name = t(locale, `channel.platform.${provider}` as MessageKey);
  const mine = v.mail?.provider === provider ? v.mail : null;
  const start = `<a class="btn ${mine ? '' : 'send'}" href="/app/connect/${provider}/start">${esc(t(locale,
    mine ? 'connect.action.reconnect' : 'connect.action.connect'))}</a>`;

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
        <p class="muted">${esc(t(locale, 'connect.mail.connectedBy', { who: mine.connectedBy, date: formatDate(locale, mine.connectedAt) }))}</p>
        ${offDomain ? `<p class="muted warn-line">${esc(t(locale, 'connect.mail.offDomain', { domain: v.sendingDomain! }))}</p>` : ''}
        ${viewer.isOwner ? `<form method="post" action="/app/connect/mail/disconnect" class="inline">
          <button class="btn stop" type="submit">${esc(t(locale, 'connect.action.disconnect'))}</button></form>` : ''}`,
    };
  }
  if (!v.connectable[provider]) {
    return { name, tone: 'stop', state: t(locale, 'connect.state.notHere'), body: `<p class="muted">${esc(t(locale, 'connect.mail.notHere'))}</p>` };
  }
  return {
    name, tone: 'warn', state: t(locale, 'connect.state.notConnected'),
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
      ${offDomain ? `<p class="muted warn-line">${esc(t(locale, 'connect.mail.offDomain', { domain: v.sendingDomain! }))}</p>` : ''}`,
  };
}

/**
 * C9 — what the host configured for the two channels buyers start, and which
 * of them she connected. The reach cards below read the same map; this list
 * must not answer differently.
 */
export type InboundLinks = ReadonlyMap<OutreachChannel, { readonly configured: boolean; readonly connected: boolean }>;

export function renderAccounts(
  v: AccountsView, locale: Locale, viewer: Viewer = OWNER_VIEW, inbound: InboundLinks = new Map(),
): string {
  const apolloStored = v.apollo.kind === 'stored' && v.apollo.readable;
  const rows: Row[] = [
    ...(v.smtpFrom ? [smtpRow(locale, v)] : []),
    mailRow(locale, v, 'google', viewer),
    mailRow(locale, v, 'microsoft', viewer),
    {
      name: 'Apollo', tone: apolloStored ? 'ok' : v.apollo.kind === 'stored' ? 'warn' : 'warn',
      state: t(locale, apolloStored ? 'connect.state.connected'
        : v.apollo.kind === 'stored' ? 'connect.state.attention'
        : v.apollo.kind === 'no_key_store' ? 'connect.state.notHere' : 'connect.state.notConnected'),
      body: `<p class="muted">${esc(t(locale, 'connect.apollo.what'))}</p>
        <a class="btn" href="/app/prospects">${esc(t(locale, apolloStored ? 'connect.apollo.open' : 'connect.apollo.add'))}</a>`,
    },
    // M39 — what the platform permits, said as the registry says it: these two
    // can only ever answer someone who wrote first. C9 made them connectable,
    // and until 2026-09-17 this row went on saying "not connected" above a
    // card that said "connected" — two answers on one page. The Connect button
    // stays on the card below, where the rule it is subject to is explained;
    // here is only the state, the same three states as the mail rows: no
    // account configured on this host, configured and hers to connect, connected.
    ...(['instagram', 'messenger'] as const).map((ch): Row => {
      const link = inbound.get(ch);
      const here = CHANNEL_REGISTRY[ch].availableHere && link?.configured === true;
      return {
        name: t(locale, `reach.channel.${ch}` as MessageKey),
        tone: !here ? 'stop' : link?.connected ? 'ok' : 'warn',
        state: t(locale, !here ? 'connect.state.notHere'
          : link?.connected ? 'connect.state.connected' : 'connect.state.notConnected'),
        body: `<p class="muted">${esc(t(locale, 'reach.cold.never'))}</p>${here && link?.connected
          ? `<p class="muted">${esc(t(locale, 'reach.inbound.connected', { name: EMPLOYEE_NAME[locale] }))}</p>` : ''}`,
      };
    }),
  ];

  return `<div class="block accounts">
    <h2>${esc(t(locale, 'connect.title'))}</h2>
    <p class="muted ch-desc">${esc(t(locale, 'connect.intro', { name: EMPLOYEE_NAME[locale] }))}</p>
    <ul class="accs">${rows.map((r) => `<li class="acc">
      <div class="acc-h"><span class="ch-name">${esc(r.name)}</span><span class="pill ${r.tone}">${esc(r.state)}</span></div>
      ${r.body}
    </li>`).join('')}</ul>
    <style>
      .accs { list-style:none; margin:var(--space-12) 0 0; padding:0; }
      .acc { padding:var(--space-12) 0; border-bottom:1px solid var(--color-border); display:grid; gap:var(--space-8); }
      .acc:last-child { border-bottom:0; }
      .acc p { margin:0; }
      .acc-h { display:flex; align-items:center; justify-content:space-between; gap:var(--space-12); flex-wrap:wrap; }
      .accounts .pill.stop { background:var(--color-paper-sunk); color:var(--color-ink-secondary); }
      .accounts .warn-line { font-size:var(--font-size-note); }
    </style>
  </div>`;
}
