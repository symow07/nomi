import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId, type BusinessId } from '../../core/types/ids.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { ContactImportFileRefusal } from '../../core/onboard/setupMinutes.js';
import type { Flash } from './flash.js';
import { t } from './say.js';
import {
  renderContactImportUpload, renderContactImportColumns, renderContactImportCheck, renderContactImportDone,
} from './contactImport.js';
import {
  CONTACT_IMPORT_MAX_BYTES, CONTACT_IMPORT_MAX_RECORDS, contactColumnsView, contactImportWidth, decodeContactFile,
  readContactMapping, readContactRecords, readContactText, readSelectedRows, type ContactRead,
} from '../../core/onboard/contactImport.js';
import {
  confirmContactImport, contactImportColumns, createContactImport, discardContactImport, loadContactImport,
  previewContactImport, saveContactColumns, saveContactSelection,
} from '../../db/contactImports.js';
import { looksLikeXlsx, xlsxRecords } from '../../net/xlsx.js';

/**
 * BLOCK 4.4 — CUSTOMERS FROM A FILE: the routes. The rules are src/core/onboard/contactImport.ts, the kept file and the
 * one transaction that adds are src/db/contactImports.ts, the pages are the frontend's (src/api/web/contactImport.ts),
 * whose form contract these answer:
 *
 *   GET  /app/customers/import               choose a file or paste a table
 *   POST /app/customers/import               multipart `file`, or `text` — read, kept, then Columns
 *   GET  /app/customers/import/:id/columns   which column is which (pre-chosen from the header)
 *   POST /app/customers/import/:id/columns   name, phone, language, notes (a column number or ''), header=on
 *   GET  /app/customers/import/:id           Check: every row, and what adding would make of it now
 *   POST /app/customers/import/:id/select    selection=all|none — the ticks only
 *   POST /app/customers/import/:id/confirm   repeated `rows` — ADD, in one transaction under the lock
 *   POST /app/customers/import/:id/discard   the kept file goes, nothing else
 *
 * OWNER ONLY, every route, reading included (the decision taken for 4.4): a file of customers is the business's
 * contact book in bulk, the same class as the export (`data_rights`). Staff are told the owner decides.
 *
 * Nothing here sends, asks a model, writes consent, opens a conversation or touches a channel; the file's words never
 * reach a log line. A file that is no longer kept (added, discarded, past seven days, another workspace's) is the same
 * "no longer kept" for every route.
 *
 * Registered in a scope of its own (`contactImportScope`): the Check form posts one `rows` per ticked row, and the
 * app's urlencoded parser keeps only the last of a repeated key. This scope's parser keeps every `rows`, and reads
 * every other field as the app's does.
 */
export type ContactImportIO = {
  readonly db: Db;
  /** The owner's workspace and name for the record, or null once the request is answered (sign in, or "the owner decides"). */
  readonly owner: (req: FastifyRequest, reply: FastifyReply) => Promise<{ readonly businessId: string; readonly actor: string } | null>;
  readonly locale: (req: FastifyRequest) => Locale;
  readonly takeFlash: (req: FastifyRequest, reply: FastifyReply) => Flash | null;
  readonly flashTo: (reply: FastifyReply, path: string, key: MessageKey) => FastifyReply;
  readonly page: (req: FastifyRequest, o: { readonly title: string; readonly active: string; readonly bodyHtml: string }) => string;
  /** Setup's facts are cached a minute: an import that added or matched someone moves its contacts milestone. */
  readonly evict: (businessId: string) => void;
};

const HOME = '/app/customers/import';
const at = (id: string): string => `${HOME}/${encodeURIComponent(id)}`;
/** A paste of up to 5 MB, percent-encoded (three bytes for every byte of a non-Latin script). */
const PASTE_BODY_LIMIT = 16 * 1024 * 1024;

type Body = Readonly<Record<string, string | readonly string[] | undefined>>;
const bodyOf = (req: FastifyRequest): Body => (req.body ?? {}) as Body;
const field = (b: Body, name: string): string => {
  const v = b[name];
  return typeof v === 'string' ? v : '';
};

/** The scope's urlencoded parser: `rows` repeated is every row; any other field, the last one — as the app's own. */
function readContactForm(body: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(body)) {
    const had = out[k];
    out[k] = k !== 'rows' || had === undefined ? v : [...(Array.isArray(had) ? had : [had]), v];
  }
  return out;
}

/** An uploaded file: a workbook's first sheet, or text in UTF-8 / UTF-16, held to the reader's limits. */
async function readUpload(req: FastifyRequest): Promise<ContactRead> {
  let bytes: Buffer;
  try {
    const file = await req.file();
    if (!file) return { ok: false, reason: 'empty' };
    bytes = await file.toBuffer();
  } catch (e) {
    return { ok: false, reason: (e as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE' ? 'too_large' : 'not_a_table' };
  }
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (looksLikeXlsx(bytes)) {
    const sheet = xlsxRecords(bytes, CONTACT_IMPORT_MAX_RECORDS);
    if (sheet === 'too_many') return { ok: false, reason: 'too_many' };
    if (!sheet) return { ok: false, reason: 'not_a_table' };
    return readContactRecords(sheet.records.map((r) => r.map((c) => c.trim())));
  }
  if (bytes.length > CONTACT_IMPORT_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const text = decodeContactFile(bytes);
  return text === null ? { ok: false, reason: 'encoding' } : readContactText(text);
}

function contactImportRoutes(app: FastifyInstance, io: ContactImportIO): void {
  const title = (key: MessageKey): string => t('en', key);
  const send = (req: FastifyRequest, reply: FastifyReply, key: MessageKey, bodyHtml: string, status = 200) =>
    reply.code(status).header('cache-control', 'no-store').type('text/html; charset=utf-8')
      .send(io.page(req, { title: title(key), active: 'customers', bodyHtml }));
  /** The owner, their workspace parsed; null when the request has been answered. */
  const owner = async (req: FastifyRequest, reply: FastifyReply): Promise<{ readonly bid: BusinessId; readonly actor: string } | null> => {
    const o = await io.owner(req, reply);
    if (!o) return null;
    const bid = parseBusinessId(o.businessId);
    if (!bid.ok) { await reply.redirect('/login'); return null; }
    return { bid: bid.value, actor: o.actor };
  };
  const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;
  const gone = (reply: FastifyReply) => io.flashTo(reply, HOME, 'contactImport.flash.gone');

  app.get(HOME, async (req, reply) => {
    const o = await owner(req, reply); if (!o) return reply;
    return send(req, reply, 'contactImport.title', renderContactImportUpload(io.locale(req), { flash: io.takeFlash(req, reply) }));
  });

  app.post(HOME, { bodyLimit: PASTE_BODY_LIMIT }, async (req, reply) => {
    const o = await owner(req, reply); if (!o) return reply;
    const source: 'file' | 'paste' = req.isMultipart() ? 'file' : 'paste';
    const text = source === 'paste' ? field(bodyOf(req), 'text') : '';
    const read = source === 'file' ? await readUpload(req)
      : text.trim() === '' ? { ok: false, reason: 'empty' } as const : readContactText(text);
    if (!read.ok) {
      const problem: { readonly source: 'file' | 'paste'; readonly reason: ContactImportFileRefusal } = { source, reason: read.reason };
      // The paste comes back in its box for this response only; one too large to read is not sent back.
      const kept = source === 'paste' && read.reason !== 'too_large' ? { text } : {};
      return send(req, reply, 'contactImport.title', renderContactImportUpload(io.locale(req), { problem, ...kept }), 400);
    }
    const records = read.records;
    const id = await withTenantTx(io.db, o.bid, (tx) => createContactImport(tx, o.bid, { source, records, createdBy: o.actor }));
    return reply.redirect(`${at(id)}/columns`, 303);
  });

  app.get(`${HOME}/:id/columns`, async (req, reply) => {
    const o = await owner(req, reply); if (!o) return reply;
    const view = await withTenantTx(io.db, o.bid, (tx) => contactImportColumns(tx, o.bid, idOf(req)));
    if (!view) return gone(reply);
    return send(req, reply, 'contactImport.columns.title', renderContactImportColumns(view, io.locale(req), { flash: io.takeFlash(req, reply) }));
  });

  app.post(`${HOME}/:id/columns`, async (req, reply) => {
    const o = await owner(req, reply); if (!o) return reply;
    const id = idOf(req);
    const b = bodyOf(req);
    const hasHeader = field(b, 'header') === 'on';
    const fields = { name: field(b, 'name'), phone: field(b, 'phone'), language: field(b, 'language'), notes: field(b, 'notes') };
    const out = await withTenantTx(io.db, o.bid, async (tx) => {
      const imp = await loadContactImport(tx, o.bid, id, { forUpdate: true });
      if (!imp) return { kind: 'gone' } as const;
      const width = contactImportWidth(imp.records);
      const read = readContactMapping(fields, width);
      if (!read.ok) {
        // The page comes back with the owner's other choices as they were sent; only the phone is missing.
        const others = readContactMapping({ ...fields, phone: '0' }, width);
        const mapping = others.ok ? { ...others.mapping, phone: null } : imp.mapping;
        return { kind: 'refused', view: contactColumnsView(imp.id, imp.records, hasHeader, mapping) } as const;
      }
      await saveContactColumns(tx, o.bid, imp.id, { hasHeader, mapping: read.mapping });
      return { kind: 'saved' } as const;
    });
    if (out.kind === 'gone') return gone(reply);
    if (out.kind === 'refused') {
      return send(req, reply, 'contactImport.columns.title', renderContactImportColumns(out.view, io.locale(req), { problem: 'no_phone_column' }), 400);
    }
    return reply.redirect(at(id), 303);
  });

  app.get(`${HOME}/:id`, async (req, reply) => {
    const o = await owner(req, reply); if (!o) return reply;
    const id = idOf(req);
    const out = await withTenantTx(io.db, o.bid, async (tx) => {
      const imp = await loadContactImport(tx, o.bid, id);
      if (!imp) return 'gone' as const;
      if (imp.mapping.phone === null) return 'columns' as const;
      return previewContactImport(tx, o.bid, id);
    });
    if (out === 'gone' || out === null) return gone(reply);
    if (out === 'columns') return reply.redirect(`${at(id)}/columns`, 303);
    return send(req, reply, 'contactImport.check.title', renderContactImportCheck(out, io.locale(req), { flash: io.takeFlash(req, reply) }));
  });

  app.post(`${HOME}/:id/select`, async (req, reply) => {
    const o = await owner(req, reply); if (!o) return reply;
    const id = idOf(req);
    const b = bodyOf(req);
    const selection = field(b, 'selection');
    // "Tick all" is every row (null: rows a later change of columns brings are ticked too); "Untick all" is none;
    // anything else keeps the ticks as sent.
    const selected = selection === 'all' ? null : selection === 'none' ? [] : readSelectedRows(b['rows']);
    const kept = await withTenantTx(io.db, o.bid, (tx) => saveContactSelection(tx, o.bid, id, selected));
    return kept ? reply.redirect(`${at(id)}#contact-toAdd`, 303) : gone(reply);
  });

  app.post(`${HOME}/:id/confirm`, async (req, reply) => {
    const o = await owner(req, reply); if (!o) return reply;
    const id = idOf(req);
    const selected = readSelectedRows(bodyOf(req)['rows']);
    const result = await withTenantTx(io.db, o.bid, async (tx) => {
      const r = await confirmContactImport(tx, o.bid, id, { selected, actor: o.actor });
      // Nothing ticked: the ticks as they were sent are kept, so the page shows them, and nothing else is written.
      if (r === 'none_ticked') await saveContactSelection(tx, o.bid, id, selected);
      return r;
    });
    if (result === null) return gone(reply);
    if (result === 'none_ticked') return io.flashTo(reply, at(id), 'contactImport.flash.none');
    io.evict(o.bid);
    // The Done page itself, not a redirect: its counts are the only record of what this file did, and the file is
    // gone, so sending the form again reads as "no longer kept" and adds nothing.
    return send(req, reply, 'contactImport.done.title', renderContactImportDone(result, io.locale(req)));
  });

  app.post(`${HOME}/:id/discard`, async (req, reply) => {
    const o = await owner(req, reply); if (!o) return reply;
    const id = idOf(req);
    const discarded = await withTenantTx(io.db, o.bid, (tx) => discardContactImport(tx, id));
    return io.flashTo(reply, HOME, discarded ? 'contactImport.flash.discarded' : 'contactImport.flash.gone');
  });
}

/**
 * The scope the routes live in: its own urlencoded parser (repeated `rows`), everything else inherited. As the e-mail
 * webhooks do it (app.ts): Fastify refuses a second parser for a type the chain already handles, so the inherited one
 * is removed first, in this scope only.
 */
export function contactImportScope(app: FastifyInstance, io: ContactImportIO): void {
  void app.register(async (scope) => {
    scope.removeContentTypeParser('application/x-www-form-urlencoded');
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, readContactForm(body as string)); } catch (e) { done(e as Error, undefined); }
    });
    contactImportRoutes(scope, io);
  });
}
