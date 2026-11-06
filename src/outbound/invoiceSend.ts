import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { enqueueOutboundRow } from '../db/channels.js';
import { makeProformaLink, proformaUrl } from '../db/proformaLinks.js';
import { makeInvoiceLink, invoiceLinkUrl } from '../db/invoiceLinks.js';
import { DOCUMENT_CHANNELS, invoicePdfViewOf, invoiceSendingOn, recordInvoiceSend, sendableInvoice } from '../db/invoiceSending.js';
import { invoicePdf } from '../core/books/invoicePdf.js';
import { invoiceCaption, invoiceLinkText, invoiceMailSubject, invoiceMailText } from '../core/books/invoiceWords.js';
import { zoneOf } from '../db/zone.js';
import { dayKey } from '../core/owner/i18n/format.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';

/**
 * 0226 — THE OWNER SENDS AN INVOICE, from the conversation or from the invoice's page, through the ONE outbound path:
 *
 *     sendInvoice → enqueueOutboundRow(origin='owner', approved, kind='document' | text) → QUEUES.outbound → adapter
 *
 * No direct send. The row is the owner's (`origin: 'owner'`, `approved: true`): a person pressed the button, as a
 * person confirms an order — so it goes while the assistant holds the conversation (the order confirmation's rule,
 * pipeline/orderProposal.ts), and the send gate still binds it at send time (Stop, the allowlist, the window, the
 * ceiling — worker.ts). The route asks the window first (`ownerSendWindow`, app.ts) so the owner is told at once
 * rather than finding a refused row later.
 *
 * WHAT GOES. Where the channel carries files (`DOCUMENT_CHANNELS`) the invoice goes as a PDF, rendered on demand behind
 * an expiring link (db/invoiceLinks.ts) the provider fetches — or, for e-mail, that the worker renders and attaches.
 * Where it does not (Instagram, the web chat), or where the PDF cannot be drawn (a name in a script WinAnsi has no
 * codes for, more lines than a page), the order's proforma LINK goes — the page that reads any script. A proforma
 * stays a proforma until paid (docs/PROFORMA-LINK.md): nothing here changes what that page says.
 */

export type SendInvoiceOutcome =
  | 'queued'
  | 'off'              // the workspace's switch is off
  | 'not_found'        // no such invoice in this workspace
  | 'not_issued'       // a draft or a discarded invoice
  | 'no_conversation'  // not made from an order, or the order names no conversation
  | 'no_address'       // the installation has no public address to serve the file or the page at
  | 'no_proforma'      // the link path, and the order lacks what a proforma needs
  | 'no_channel';      // the conversation has no identity to send to

export type SendInvoiceDeps = {
  readonly db: Db;
  readonly now: () => Date;
  readonly publicBaseUrl: string | null | undefined;
  /** The existing bare re-drive tick: boss.send(QUEUES.outbound, {businessId, conversationId}). */
  readonly kickDrive: (businessId: string, conversationId: string) => Promise<void>;
};

export type SendInvoiceResult = {
  readonly outcome: SendInvoiceOutcome;
  readonly carried?: 'pdf' | 'link';
  readonly conversationId?: string;
  readonly key?: string;
};

export async function sendInvoice(
  deps: SendInvoiceDeps,
  input: { readonly businessId: BusinessId; readonly invoiceId: string; readonly actor: string },
): Promise<SendInvoiceResult> {
  const now = deps.now();
  const r = await withTenantTx(deps.db, input.businessId, async (tx): Promise<SendInvoiceResult> => {
    if (!(await invoiceSendingOn(tx, input.businessId))) return { outcome: 'off' };
    const inv = await sendableInvoice(tx, input.businessId, input.invoiceId);
    if (!inv) return { outcome: 'not_found' };
    if (inv.state !== 'issued' || inv.key === null) return { outcome: 'not_issued' };
    if (!inv.conversationId || !inv.channel || !inv.orderId) return { outcome: 'no_conversation' };
    if (!deps.publicBaseUrl) return { outcome: 'no_address' };
    const words = { key: inv.key, currency: inv.currency, owed: inv.owed, business: inv.business };
    const cid = inv.conversationId;

    // The PDF, where the channel carries one and the page can be drawn.
    let carried: 'pdf' | 'link' = 'link';
    let media: { url: string; kind: 'document' } | null = null;
    if (DOCUMENT_CHANNELS.includes(inv.channel)) {
      const view = await invoicePdfViewOf(tx, input.businessId, inv.id, dayKey(now, await zoneOf(tx, input.businessId)));
      if (view && invoicePdf(view) !== null) {
        const url = invoiceLinkUrl(deps.publicBaseUrl, await makeInvoiceLink(tx, input.businessId, inv.id, input.actor, now), inv.key);
        if (url) { media = { url, kind: 'document' }; carried = 'pdf'; }
      }
    }
    let body: string;
    let mail: { readonly subject: string } | null = null;
    if (media) {
      // Meta's attachments carry no caption (the adapter refuses one); a mail needs its subject.
      body = inv.channel === 'messenger' ? '' : inv.channel === 'email' ? invoiceMailText(words) : invoiceCaption(words);
      if (inv.channel === 'email') mail = { subject: invoiceMailSubject(words) };
    } else {
      if (!inv.proformaReady) return { outcome: 'no_proforma' };
      const link = await makeProformaLink(tx, input.businessId, inv.orderId);
      const url = link ? proformaUrl(deps.publicBaseUrl, link.token) : null;
      if (!url) return { outcome: 'no_proforma' };
      if (link!.made) await tenantRepos(tx, input.businessId).events.append(cid as ConversationId, 'proforma_link_made', { orderId: inv.orderId });
      body = invoiceLinkText(words, url);
      if (inv.channel === 'email') mail = { subject: invoiceMailSubject(words) };
    }

    await lockConversation(tx, cid);
    // B8 — the owner's own tap makes the row exactly once: no identical-body check.
    const rowId = await enqueueOutboundRow(tx, input.businessId, cid, body, 'owner', mail, null, null, true, media, false);
    if (rowId === null) return { outcome: 'no_channel' };
    await recordInvoiceSend(tx, input.businessId, { invoiceId: inv.id, conversationId: cid, outboundId: rowId, channel: inv.channel, carried, by: input.actor, now });
    // Audit: who sent which invoice, how — no figure, no customer data.
    await tenantRepos(tx, input.businessId).events.append(cid as ConversationId, 'invoice_sent', { invoiceId: inv.id, key: inv.key, carried, actor: input.actor });
    return { outcome: 'queued', carried, conversationId: cid, key: inv.key };
  });
  if (r.outcome === 'queued' && r.conversationId) await deps.kickDrive(input.businessId, r.conversationId);
  return r;
}

/** The conversation an invoice would go in, for the route's window check before anything is written. Null: none. */
export async function invoiceConversation(db: Db, businessId: BusinessId, invoiceId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return null;
  return withTenantTx(db, businessId, async (tx) => (await sql<{ cid: string | null }>`
    select o.conversation_id::text as cid from invoices i left join orders o on o.id = i.source_order_id
     where i.business_id = ${businessId}::uuid and i.id = ${invoiceId}::uuid`.execute(tx)).rows[0]?.cid ?? null);
}
