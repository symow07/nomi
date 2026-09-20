import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db } from '../../db/client.js';
import { liveMailAccount, markInboxRead, markMailAccountNeedsAttention } from '../../db/mailAccounts.js';
import { ensureConversation } from '../../db/channels.js';
import { recordConsent } from '../../db/contacts.js';
import { decryptSecret } from '../../security/credentials.js';
import { refreshAccessToken, type OAuthClients, type OAuthFetch } from '../../connectors/oauth.js';
import { readGmailMessage, type GmailMessage, type ReadMail } from './gmailMessage.js';
import type { BusinessId } from '../../core/types/ids.js';

/**
 * E1 — SHE READS THE INBOX, once a minute, for a mailbox whose owner granted it.
 *
 * Until now a buyer's e-mail landed in the owner's Gmail unread by this
 * product. This asks Google for what arrived since the last look, records each
 * mail as a message on the buyer's e-mail conversation — the same rows a
 * webhook writes — and queues the same turn a WhatsApp message gets. Her answer
 * then leaves through the same mailbox, "Re:" what he wrote.
 *
 * WHAT IS NEVER ANSWERED: her own mail (the mailbox's address and its
 * aliases), and anything a machine wrote — bounces, vacation notices, lists,
 * the installation's own sign-in codes. Those are skipped, not recorded.
 *
 * WHAT LIMITS IT: the same watermark logic as every poller (`inbox_read_at`,
 * with a five-minute overlap, and the message id as the true dedupe), at most
 * `MAX_PER_READ` mails a minute so one flood cannot take the minute, and the
 * sweep's own budget. A dead token is recorded on the account once, the way a
 * failed send records it, so the page asks her to connect again.
 *
 * Google only: the one reader built. A Microsoft mailbox reads as `not_reading`.
 */

export const MAX_PER_READ = 25;
const OVERLAP_MS = 5 * 60 * 1000;
const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
/**
 * EVERY CALL IS BOUNDED. A read happens inside the minute sweep, which also
 * sends her follow-ups; a provider that accepts a connection and then says
 * nothing would hold the whole minute (the lesson the domain check already
 * paid for: a name that does not resolve waits out its timeout). Nothing here
 * is worth a minute, so nothing here gets one.
 */
const CALL_TIMEOUT_MS = 8_000;
/**
 * And the whole read is bounded too, not only each call: twenty-five mails at
 * eight seconds each is two hundred seconds, which is not a minute's work by
 * any reading. Past this, it stops where it is and leaves the watermark alone —
 * the next minute starts again from the same place, and the message id makes a
 * mail read twice a mail recorded once.
 */
const READ_BUDGET_MS = 10_000;

type Cached = { readonly token: string; readonly until: number };

export type InboxReadDeps = {
  readonly db: Db;
  readonly credentialKey: Buffer;
  readonly clients: OAuthClients;
  readonly fetchImpl: OAuthFetch;
  readonly cache: Map<string, Cached>;
  readonly now?: () => Date;
  /** The same queue a webhook message goes to. */
  readonly enqueue: (job: { businessId: string; conversationId: string; messageId: string; text: string }) => Promise<void>;
  /** Addresses that are hers besides the mailbox's own (aliases such as no-reply@…). */
  readonly ownAddresses?: readonly string[];
};

export type InboxReadResult =
  | { readonly outcome: 'not_reading' | 'needs_attention' | 'unavailable' }
  | { readonly outcome: 'read'; readonly recorded: number; readonly skipped: number };

export async function readNewMail(deps: InboxReadDeps, businessId: BusinessId): Promise<InboxReadResult> {
  const now = deps.now ?? (() => new Date());
  const account = await withTenantTx(deps.db, businessId, (tx) => liveMailAccount(tx, businessId));
  if (!account || !account.readsInbox || account.provider !== 'google') return { outcome: 'not_reading' };
  if (account.needsAttention) return { outcome: 'needs_attention' };
  const client = deps.clients.google;
  if (!client) return { outcome: 'not_reading' };

  let refreshToken: string;
  try { refreshToken = decryptSecret(account.ciphertext, deps.credentialKey).plain; }
  catch { return { outcome: 'needs_attention' }; }

  // The token refresh is a network call too, and it is the first one.
  const fetchImpl: OAuthFetch = (url, init) =>
    deps.fetchImpl(url, { ...init, ...(init.signal ? {} : { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }) });

  // The access token, cached beside the sender's so one refresh serves both.
  let token = deps.cache.get(account.id);
  if (!token || token.until <= now().getTime()) {
    const r = await refreshAccessToken('google', client, refreshToken, fetchImpl);
    if (!r.ok) {
      if (r.reason === 'revoked') {
        await withTenantTx(deps.db, businessId, (tx) => markMailAccountNeedsAttention(tx, account.id, 'revoked'));
        return { outcome: 'needs_attention' };
      }
      return { outcome: 'unavailable' };
    }
    token = { token: r.accessToken, until: now().getTime() + (r.expiresInSec - 60) * 1000 };
    deps.cache.set(account.id, token);
  }
  const auth = { Authorization: `Bearer ${token.token}` };
  const call = async (url: string): Promise<unknown | null> => {
    try {
      const res = await fetchImpl(url, { method: 'GET', headers: auth });
      if (res.status === 401) return 'unauthorized';
      if (res.status !== 200) return null;
      return JSON.parse(await res.text()) as unknown;
    } catch { return null; }
  };

  // Newer than the last look, with an overlap; the message id is the real dedupe.
  const since = Math.floor(((account.inboxReadAt?.getTime() ?? now().getTime() - LOOKBACK_MS) - OVERLAP_MS) / 1000);
  const q = encodeURIComponent(`in:inbox after:${since}`);
  const list = await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${MAX_PER_READ}`);
  if (list === 'unauthorized') {
    // Reading needs its own scope: a mailbox connected before it was asked for
    // is "sends only" — the page says so, and this is not a dead token.
    return { outcome: 'not_reading' };
  }
  if (!list || typeof list !== 'object') return { outcome: 'unavailable' };
  const ids = ((list as { messages?: { id?: string }[] }).messages ?? []).map((m) => m.id).filter((x): x is string => typeof x === 'string');
  if (ids.length === 0) {
    await withTenantTx(deps.db, businessId, (tx) => markInboxRead(tx, account.id, now()));
    return { outcome: 'read', recorded: 0, skipped: 0 };
  }

  const own = new Set([account.address.toLowerCase(), ...(deps.ownAddresses ?? []).map((a) => a.toLowerCase())]);
  let recorded = 0, skipped = 0, newest = account.inboxReadAt?.getTime() ?? 0;
  const until = now().getTime() + READ_BUDGET_MS;
  let finished = true;
  for (const gmailId of ids) {
    if (now().getTime() > until) { finished = false; break; }
    const full = await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}?format=full`);
    if (!full || full === 'unauthorized' || typeof full !== 'object') { skipped++; continue; }
    const mail = readGmailMessage(full as GmailMessage);
    if ('skipped' in mail) { skipped++; continue; }
    newest = Math.max(newest, mail.receivedAt.getTime());
    if (mail.automatic || own.has(mail.from)) { skipped++; continue; }
    const r = await recordInboundMail(deps, businessId, mail);
    if (r === 'recorded') recorded++; else skipped++;
  }
  // Only a read that got to the end of the list may move the watermark: Gmail
  // answers newest first, so stopping halfway leaves OLDER mail unseen, and
  // moving the mark past it would lose it for good.
  if (finished) {
    await withTenantTx(deps.db, businessId, (tx) => markInboxRead(tx, account.id, new Date(Math.max(newest, account.inboxReadAt?.getTime() ?? 0))));
  }
  return { outcome: 'read', recorded, skipped };
}

/**
 * The buyer's mail becomes a message on his e-mail conversation, and a turn is
 * queued for it — exactly what a webhook does for a WhatsApp message. Writing
 * first, then queueing, so a retry can never answer a mail it did not record.
 */
async function recordInboundMail(deps: InboxReadDeps, businessId: BusinessId, mail: ReadMail): Promise<'recorded' | 'duplicate'> {
  const externalId = `email:${mail.messageId}`;
  const conversationId = await withTenantTx(deps.db, businessId, async (tx) => {
    const conv = await ensureConversation(tx, businessId, mail.from, mail.fromName, 'email');
    await lockConversation(tx, conv.conversationId);
    const inserted = await sql<{ id: string }>`
      insert into messages (conversation_id, external_id, direction, input_type, text_content, subject, sent_at)
      values (${conv.conversationId}, ${externalId}, 'inbound', 'text', ${mail.text}, ${mail.subject || null}, ${mail.receivedAt})
      on conflict do nothing
      returning id`.execute(tx);
    if (inserted.rows.length === 0) return null;
    await sql`update client_channels
                 set last_inbound_at = greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), ${mail.receivedAt})
               where channel = 'email' and channel_user_id = ${mail.from}`.execute(tx);
    // He wrote first: the strongest consent there is, recorded once.
    const already = (await sql<{ yes: boolean }>`
      select exists (select 1 from contact_consent
                      where business_id = ${businessId}::uuid and channel = 'email' and identity = ${mail.from}) as yes`
      .execute(tx)).rows[0]?.yes === true;
    if (!already) {
      await recordConsent(tx, businessId, { channel: 'email', identity: mail.from, evidence: 'inbound_message', note: null, recordedBy: 'buyer' });
    }
    return conv.conversationId;
  });
  if (!conversationId) return 'duplicate';
  await deps.enqueue({ businessId, conversationId, messageId: externalId, text: mail.text });
  return 'recorded';
}
