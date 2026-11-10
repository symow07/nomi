import type { CatalogueRequest } from '../core/catalogue/whatsapp.js';
export const CATALOGUE_GRAPH_VERSION = 'v27.0';
type Refusal = { ok: false; reason: 'empty' | 'too_large' | 'unknown' | 'connection' | 'not_ingested'; invalid?: Notes; warnings?: Notes };
type Notes = Record<string, string>;
export type CatalogueReceipt = { ok: true; handle: string; invalid: Notes; warnings: Notes } | Refusal;
export type CatalogueStatus = { ok: true; finished: boolean; invalid: Notes; warnings: Notes } | Refusal;
export type CatalogueLink = { ok: true; catalogId: string | null } | Refusal;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const id = (value: unknown): value is string => typeof value === 'string' && /^[0-9]+$/.test(value);
const unknown: Refusal = { ok: false, reason: 'unknown' };

/** Catalogue reads/writes have their own version. No messaging call, write retry or token in an address. */
export function catalogueClient(options: { token: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const note = (value: string) => value.split(options.token).join('[redacted]').replace(/Bearer\s+\S+/gi, '[redacted]').slice(0, 500);
  const request = async (path: string, body?: string): Promise<{ data: Record<string, unknown> | null; connection: boolean }> => {
    try {
      const response = await fetchImpl(`https://graph.facebook.com/${CATALOGUE_GRAPH_VERSION}/${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: body === undefined ? { Authorization: `Bearer ${options.token}` }
          : { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body }),
      });
      const reader = response.body?.getReader();
      if (!reader) return { data: null, connection: false };
      const chunks: Uint8Array[] = []; let length = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.length;
        if (length > 2 * 1024 * 1024) { await reader.cancel(); return { data: null, connection: false }; }
        chunks.push(chunk.value);
      }
      const data = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const error = object(data?.['error']);
      return { data: response.ok && !error ? data : null, connection: [190, 200, 10].includes(Number(error?.['code'])) || [401, 403].includes(response['status']) };
    } catch { return { data: null, connection: false }; }
  };
  const messages = (value: unknown): string | null => {
    if (!Array.isArray(value)) return null;
    const words = value.map(v => object(v)?.['message']);
    if (words.some(v => typeof v !== 'string')) return null;
    return note(words.join(' · '));
  };
  return {
    async linked(waba: string): Promise<CatalogueLink> {
      if (!id(waba)) return unknown;
      const result = await request(`${waba}/product_catalogs?fields=id`);
      if (result.connection) return { ok: false, reason: 'connection' };
      const rows = result['data']?.['data'];
      if (!Array.isArray(rows) || rows.length > 1 || object(result['data']?.['paging'])?.['next']) return unknown;
      if (rows.length === 0) return { ok: true, catalogId: null };
      const catalog = object(rows[0])?.['id'];
      return id(catalog) ? { ok: true, catalogId: catalog } : unknown;
    },
    async submit(catalog: string, items: readonly CatalogueRequest[]): Promise<CatalogueReceipt> {
      if (items.length === 0) return { ok: false, reason: 'empty' };
      if (items.length > 3000) return { ok: false, reason: 'too_large' };
      const body = JSON.stringify({ item_type: 'PRODUCT_ITEM', allow_upsert: false, requests: items });
      if (Buffer.byteLength(body) > 28 * 1024 * 1024) return { ok: false, reason: 'too_large' };
      const ids = new Set(items.map(item => item['data']['id']));
      if (!id(catalog) || ids.has(undefined) || ids.size !== items.length) return unknown;
      const result = await request(`${catalog}/items_batch`, body);
      if (result.connection) return { ok: false, reason: 'connection' };
      const handles = result['data']?.['handles'], validation = result['data']?.['validation_status'];
      if (!Array.isArray(handles) || handles.length > 1 || !Array.isArray(validation)) return unknown;
      const invalid: Notes = {}, warnings: Notes = {}, seen = new Set<string>();
      for (const raw of validation) {
        const row = object(raw), key = row?.['retailer_id'];
        if (typeof key !== 'string' || !ids.has(key) || seen.has(key)) return unknown;
        seen.add(key);
        const errors = messages(row?.['errors']), warning = messages(row?.['warnings']);
        if (errors === null || warning === null) return unknown;
        if (errors) invalid[key] = errors;
        if (warning) warnings[key] = warning;
      }
      if (handles.length === 0) return { ok: false, reason: 'not_ingested',
        ...(Object.keys(invalid).length ? { invalid } : {}), ...(Object.keys(warnings).length ? { warnings } : {}) };
      const handle = handles[0];
      if (typeof handle !== 'string' || !handle || handle.length > 500) return unknown;
      return { ok: true, handle, invalid, warnings };
    },
    async status(catalog: string, handle: string, ids: readonly string[]): Promise<CatalogueStatus> {
      if (!id(catalog) || !handle || handle.length > 500) return unknown;
      const params = new URLSearchParams({ handle, load_ids_of_invalid_requests: 'true', fields: 'handle,status,warnings,errors_total_count,ids_of_invalid_requests' });
      const result = await request(`${catalog}/check_batch_request_status?${params}`);
      if (result.connection) return { ok: false, reason: 'connection' };
      const rows = result['data']?.['data'];
      if (!Array.isArray(rows) || rows.length !== 1) return unknown;
      const row = object(rows[0]);
      if (row?.['handle'] !== handle || typeof row['status'] !== 'string') return unknown;
      if (row['status'] !== 'finished') return { ok: true, finished: false, invalid: {}, warnings: {} };
      const count = row['errors_total_count'], bad = row['ids_of_invalid_requests'];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(bad)
        || bad.length !== count || bad.some(v => typeof v !== 'string' || !ids.includes(v)) || !Array.isArray(row['warnings'])) return unknown;
      const invalid: Notes = {}, warnings: Notes = {};
      for (const key of bad as string[]) invalid[key] = 'not_accepted';
      for (const raw of row['warnings']) {
        const warning = object(raw);
        if (typeof warning?.['id'] !== 'string' || !ids.includes(warning['id']) || typeof warning['message'] !== 'string') return unknown;
        warnings[warning['id']] = note(warning['message']);
      }
      return { ok: true, finished: true, invalid, warnings };
    },
  };
}
export type CatalogueClient = ReturnType<typeof catalogueClient>;
