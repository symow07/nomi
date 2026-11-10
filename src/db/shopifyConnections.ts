import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { decryptSecret, encryptSecret } from '../security/credentials.js';
import type { ShopifyCredential } from '../core/onboard/shopifyGraphql.js';
import type { OrderOutcome } from '../core/commerce/shopifyOrders.js';

/**
 * BLOCK 5.5 — a workspace's read-only connection to its own Shopify store (0237), and the audit of its lookups.
 *
 * The credential (the owner's Admin API token, or their own app's client ID and secret) is sealed with
 * CREDENTIAL_KEY as ONE value and opened only to make a request (`openShopifyCredential`). Nothing here ever returns
 * it to a page. Disconnecting archives the row and drops the sealed value, so nothing usable is left; the switch goes
 * off with it.
 */
export type ShopifyConnection = {
  readonly id: string;
  readonly shop: string;
  readonly way: 'token' | 'client';
  readonly scopes: readonly string[];
  /** What Shopify last said it served (`X-Shopify-API-Version`); null when it named none. */
  readonly apiVersionSeen: string | null;
  readonly answerOrders: boolean;
  readonly connectedBy: string;
  readonly connectedAt: Date;
};

type Row = {
  id: string; shop: string; way: 'token' | 'client'; scopes: string[]; api_version_seen: string | null;
  answer_orders: boolean; connected_by: string; connected_at: Date;
};
const ofRow = (r: Row): ShopifyConnection => ({
  id: r.id, shop: r.shop, way: r.way, scopes: r.scopes, apiVersionSeen: r.api_version_seen, answerOrders: r.answer_orders,
  connectedBy: r.connected_by, connectedAt: r.connected_at,
});

export async function liveShopifyConnection(tx: Tx, businessId: BusinessId): Promise<ShopifyConnection | null> {
  const r = (await sql<Row>`
    select id::text as id, shop, way, scopes, api_version_seen, answer_orders, connected_by, connected_at
      from shopify_connections where business_id = ${businessId}::uuid and archived_at is null limit 1`.execute(tx)).rows[0];
  return r ? ofRow(r) : null;
}

/** The sealed form of a credential: the way and its parts, as one JSON value. */
export function sealShopifyCredential(credential: ShopifyCredential, key: Buffer): string {
  const plain = credential.way === 'token'
    ? JSON.stringify({ way: 'token', token: credential.token })
    : JSON.stringify({ way: 'client', clientId: credential.clientId, clientSecret: credential.clientSecret });
  return encryptSecret(plain, key);
}

/** The credential, opened; null when the value does not open with this key or is not one. */
export function openShopifyCredential(ciphertext: string, key: Buffer): ShopifyCredential | null {
  try {
    const o = JSON.parse(decryptSecret(ciphertext, key).plain) as Record<string, unknown>;
    if (o['way'] === 'token' && typeof o['token'] === 'string' && o['token'] !== '') return { way: 'token', token: o['token'] };
    if (o['way'] === 'client' && typeof o['clientId'] === 'string' && typeof o['clientSecret'] === 'string'
        && o['clientId'] !== '' && o['clientSecret'] !== '') {
      return { way: 'client', clientId: o['clientId'], clientSecret: o['clientSecret'] };
    }
    return null;
  } catch { return null; }
}

/** A new connection archives the live one first, in the same transaction: one per business. The switch starts off. */
export async function saveShopifyConnection(tx: Tx, businessId: BusinessId, input: {
  readonly shop: string; readonly way: 'token' | 'client'; readonly ciphertext: string; readonly scopes: readonly string[];
  readonly version: string | null; readonly by: string;
}): Promise<string> {
  await disconnectShopify(tx, businessId, input.by);
  const r = (await sql<{ id: string }>`
    insert into shopify_connections (business_id, shop, way, credential_ciphertext, scopes, api_version_seen, api_version_seen_at, connected_by)
    values (${businessId}::uuid, ${input.shop}, ${input.way}, ${input.ciphertext}, ${[...input.scopes]}::text[],
            ${input.version}, ${input.version === null ? null : new Date()}, ${input.by})
    returning id::text as id`.execute(tx)).rows[0]!;
  return r.id;
}

/** Archive the live connection, drop its credential and switch it off. True when there was one. */
export async function disconnectShopify(tx: Tx, businessId: BusinessId, by: string): Promise<boolean> {
  const r = await sql`
    update shopify_connections
       set archived_at = now(), archived_by = ${by}, credential_ciphertext = null, answer_orders = false
     where business_id = ${businessId}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** "Answer order questions from Shopify": on or off. False when nothing is connected. */
export async function setAnswerOrders(tx: Tx, businessId: BusinessId, on: boolean, by: string): Promise<boolean> {
  const r = await sql`
    update shopify_connections set answer_orders = ${on}, answer_orders_set_by = ${by}, answer_orders_set_at = now()
     where business_id = ${businessId}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** What a lookup needs before it may ask Shopify, read with no lock. Null: no lookup (off, or nothing connected). */
export async function lookupReadiness(tx: Tx, businessId: BusinessId, conversationId: string): Promise<{
  readonly connectionId: string; readonly shop: string; readonly ciphertext: string; readonly scopes: readonly string[];
  readonly versionSeen: string | null; readonly senderEmail: string | null;
} | null> {
  const r = (await sql<{ id: string; shop: string; credential_ciphertext: string; scopes: string[]; api_version_seen: string | null; practice: boolean }>`
    select s.id::text as id, s.shop, s.credential_ciphertext, s.scopes, s.api_version_seen,
           (b.practice_of is not null) as practice
      from shopify_connections s join businesses b on b.id = s.business_id
     where s.business_id = ${businessId}::uuid and s.archived_at is null and s.answer_orders`.execute(tx)).rows[0];
  if (!r || r.practice) return null;
  // On an e-mail conversation, the address the mail came from — only a mail the receiving server confirmed reaches a
  // turn (src/channels/email/inboxReader.ts). Never `clients.email`, which a chat message can set.
  const sender = (await sql<{ address: string }>`
    select cc.channel_user_id as address
      from conversations c join client_channels cc on cc.client_id = c.client_id and cc.channel = 'email'
     where c.id = ${conversationId}::uuid and c.business_id = ${businessId}::uuid and c.channel = 'email'
     order by cc.last_inbound_at desc nulls last limit 2`.execute(tx)).rows;
  return {
    connectionId: r.id, shop: r.shop, ciphertext: r.credential_ciphertext, scopes: r.scopes, versionSeen: r.api_version_seen,
    // Two addresses on one e-mail customer: which one wrote is not known here, so neither counts.
    senderEmail: sender.length === 1 ? sender[0]!.address : null,
  };
}

/** A slot for one lookup (0237): its id, or null when this conversation has had five in the last 60 minutes. */
export async function claimOrderLookup(tx: Tx, conversationId: string): Promise<string | null> {
  return (await sql<{ id: string | null }>`select claim_order_lookup(${conversationId}::uuid)::text as id`.execute(tx)).rows[0]?.id ?? null;
}

export async function finishOrderLookup(tx: Tx, lookupId: string, outcome: OrderOutcome, orderName: string | null): Promise<void> {
  await sql`select finish_order_lookup(${lookupId}::uuid, ${outcome}, ${outcome === 'verified' ? orderName : null})`.execute(tx);
}

/** Shopify answered with a version: kept on the connection when it changed, so the page can say so. */
export async function noteVersionSeen(tx: Tx, connectionId: string, version: string | null): Promise<void> {
  await sql`update shopify_connections set api_version_seen = ${version}, api_version_seen_at = now()
             where id = ${connectionId}::uuid and archived_at is null and api_version_seen is distinct from ${version}`.execute(tx);
}

export type LookupRecord = { readonly at: Date; readonly outcome: OrderOutcome | 'asking' | 'rate_limited'; readonly orderName: string | null; readonly conversationId: string };

/** The workspace's latest lookups, for the owner's page. */
export async function recentOrderLookups(tx: Tx, businessId: BusinessId, limit = 20): Promise<readonly LookupRecord[]> {
  return (await sql<{ asked_at: Date; outcome: LookupRecord['outcome']; order_name: string | null; conversation_id: string }>`
    select asked_at, outcome, order_name, conversation_id::text as conversation_id from shopify_order_lookups
     where business_id = ${businessId}::uuid order by asked_at desc limit ${limit}`.execute(tx)).rows
    .map((r) => ({ at: r.asked_at, outcome: r.outcome, orderName: r.order_name, conversationId: r.conversation_id }));
}
