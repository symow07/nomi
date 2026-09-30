import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * K1 — driving the kept import review the way a browser does (0094).
 *
 * A list is pasted or photographed, the owner lands on its review, and the
 * review's own form is posted back: its hidden fields, its inputs as drawn,
 * the boxes as they are checked. Tests change only what the owner would
 * change, so what reaches the server is what a real form sends.
 */

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
export const BOUNDARY = '----nomiListTest';

const decode = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z][\w:-]*)(?:="([^"]*)")?/g)) out[m[1]!] = decode(m[2] ?? '');
  return out;
};

/** Every field the form posting to `action` would send as drawn. */
export function formFields(html: string, action: string): Map<string, string> {
  const start = html.indexOf(`action="${action}"`);
  expect(start, `no form posts to ${action}`).toBeGreaterThan(-1);
  const end = html.indexOf('</form>', start);
  const form = html.slice(start, end);
  const out = new Map<string, string>();
  for (const m of form.matchAll(/<input\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (!a['name']) continue;
    const type = (a['type'] ?? 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') { if ('checked' in a) out.set(a['name'], a['value'] ?? 'on'); }
    else out.set(a['name'], a['value'] ?? '');
  }
  for (const m of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const a = attrs(m[1]!);
    const sel = /<option\b[^>]*\bvalue="([^"]*)"[^>]*\bselected\b/.exec(m[2]!) ?? /<option\b[^>]*\bvalue="([^"]*)"/.exec(m[2]!);
    if (a['name'] && sel) out.set(a['name'], decode(sel[1]!));
  }
  for (const m of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
    const a = attrs(m[1]!);
    if (a['name']) out.set(a['name'], decode(m[2]!));
  }
  return out;
}

/** The import's address, from the redirect a paste or a photo upload answers with. */
export function importAt(res: { statusCode: number; headers: Record<string, unknown> }): string {
  expect(res.statusCode, 'the list did not become an import').toBe(303);
  const at = String(res.headers['location']);
  expect(at).toMatch(/^\/app\/products\/import\/[0-9a-f-]{36}$/);
  return at;
}

export async function pasteList(app: FastifyInstance, cookie: string, text: string): Promise<string> {
  return importAt(await app.inject({
    method: 'POST', url: '/app/products/add/review', headers: { cookie, ...FORM },
    payload: new URLSearchParams({ text }).toString(),
  }));
}

export const photosBody = (
  files: readonly { bytes: Buffer; mime?: string; filename?: string }[], hand: 'printed' | 'handwritten' | null = 'printed',
): Buffer => Buffer.concat([
  ...(hand ? [Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="hand"\r\n\r\n${hand}\r\n`)] : []),
  ...files.flatMap((f) => [
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="page"; filename="${f.filename ?? 'page.jpg'}"\r\n`
      + `Content-Type: ${f.mime ?? 'image/jpeg'}\r\n\r\n`),
    f.bytes, Buffer.from('\r\n'),
  ]),
  Buffer.from(`--${BOUNDARY}--\r\n`),
]);

export const postPhotos = (app: FastifyInstance, cookie: string, files: readonly { bytes: Buffer; mime?: string }[], hand: 'printed' | 'handwritten' | null = 'printed') =>
  app.inject({
    method: 'POST', url: '/app/products/add/photo',
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: photosBody(files, hand),
  });

export type ReviewPost = {
  /** Field overrides; null removes the field (an unchecked box). */
  readonly set?: Readonly<Record<string, string | null>>;
  /** Tick every row that has a tick box, as an owner who checked each would. */
  readonly tickAll?: boolean;
  /** K7 — the price typed from the paper for each challenge row, by row name. */
  readonly typeFromPaper?: (rowName: string) => string | undefined;
  readonly next?: 'add' | 'save';
};

/** The challenge rows of a review: key → the row's name. */
export function challengeRows(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/name="typed:([^"]+)"/g)) {
    // The row's name is the last one drawn before its box.
    const before = html.slice(0, m.index);
    const names = [...before.matchAll(/<b dir="auto">([^<]*)<\/b>/g)];
    out.set(m[1]!, decode(names[names.length - 1]![1]!));
  }
  return out;
}

/** GET the review, fill its form as the owner would, and post it. */
export async function submitReview(app: FastifyInstance, cookie: string, at: string, p: ReviewPost = {}) {
  const page = await app.inject({ method: 'GET', url: at, headers: { cookie } });
  expect(page.statusCode, `the review at ${at}`).toBe(200);
  const fields = formFields(page.body, `${at}/save`);
  if (p.tickAll) for (const k of (fields.get('ticks') ?? '').split(',').filter(Boolean)) fields.set(`tick:${k}`, 'on');
  if (p.typeFromPaper) {
    for (const [key, name] of challengeRows(page.body)) {
      const v = p.typeFromPaper(name);
      if (v !== undefined) fields.set(`typed:${key}`, v);
    }
  }
  for (const [k, v] of Object.entries(p.set ?? {})) { if (v === null) fields.delete(k); else fields.set(k, v); }
  fields.set('next', p.next ?? 'add');
  const res = await app.inject({
    method: 'POST', url: `${at}/save`, headers: { cookie, ...FORM },
    payload: new URLSearchParams([...fields.entries()]).toString(),
  });
  return { page, res };
}

/** A pasted list, checked as it stands and added: the shortest path an owner can take. */
export async function pasteAndAdd(app: FastifyInstance, cookie: string, text: string, p: ReviewPost = {}) {
  const at = await pasteList(app, cookie, text);
  const { res } = await submitReview(app, cookie, at, { tickAll: true, ...p });
  return { at, res };
}

/** The row key whose name is `name`, on the review at `html`. */
export function rowKey(html: string, name: string): string {
  const fields = [...html.matchAll(/name="name:([^"]+)" value="([^"]*)"/g)];
  const hit = fields.find((m) => decode(m[2]!) === name);
  expect(hit, `no row named ${name}`).toBeDefined();
  return hit![1]!;
}
