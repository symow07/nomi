import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { flashSaid } from './tenant.js';
import { pasteList, submitReview, rowKey, postPhotos, formFields, BOUNDARY } from './importReview.js';
import type { PageTranscriber } from '../../src/llm/ports.js';
import type { CatalogExtractor } from '../../src/core/onboard/catalogImport.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * EXT — through the real routes, into real rows, the model faked:
 *
 *   · the closer reading, asked by the owner, of the lines read without a
 *     price: what a line holds becomes a row that waits for her tick, with its
 *     confidence; a figure no line holds is thrown away;
 *   · never past the day's allowance; not offered where no extractor exists;
 *   · a PDF read like a photographed page, kept, and opened as itself;
 *   · an Excel workbook read as the table it is.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `e7700000-0000-4000-8000-${RUN}0001`;
const CODE = `ext-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const LIST = 'Silk scarf $24.50\nTote bag 39 | 2 colours | 3 sizes\nLinen apron — 18 each, pack of 6\nSPRING SALE';

d('EXT · the closer reading, PDF and Excel (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let bare: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let cookie = '';
  let bareCookie = '';
  const asked: { lines: readonly string[] }[] = [];
  const read: { mediaType: string }[] = [];
  let readerDown = false;
  const transcriber: PageTranscriber = {
    transcribe: async (i) => { if (readerDown) throw new Error('Request timed out.'); read.push({ mediaType: i.mediaType }); return { text: 'Wool hat $15.00\nGloves $9.00', unreadable: false, promptVersion: 'test', modelId: 'test', usage: { inputTokens: 1, outputTokens: 1 } }; },
  };
  const extractor: CatalogExtractor = {
    extract: async (i) => {
      asked.push({ lines: i.lines });
      const sure = { name: 0.95, price: 0.6, unit: 0.9, moq: 0 };
      return {
        items: [
          { line: 'Tote bag 39 | 2 colours | 3 sizes', name: 'Tote bag', price: '39', unit: null, moq: null, confidence: sure },
          // A price no line holds: thrown away whole.
          { line: 'Linen apron — 18 each, pack of 6', name: 'Linen apron', price: '20', unit: 'each', moq: null, confidence: sure },
        ],
        promptVersion: 'test', modelId: 'test', usage: { inputTokens: 5, outputTokens: 5 },
      };
    },
  };
  const get = (a: typeof app, c: string, url: string) => a.inject({ method: 'GET', url, headers: { cookie: c } });
  const rows = async (at: string) => (await admin.query(`select rows from catalog_imports where id = $1`, [at.split('/').pop()])).rows[0].rows as { name: string; price: number | null; confidence?: unknown; line: string }[];
  const extract = async (at: string) => {
    const page = await get(app, cookie, at);
    const fields = formFields(page.body, `${at}/save`);
    return app.inject({ method: 'POST', url: `${at}/extract`, headers: { cookie, ...FORM }, payload: new URLSearchParams([...fields.entries()]).toString() });
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await admin.query(`insert into businesses (id, name, kind, country) values ($1, $2, 'online_shop', 'US')`, [BIZ, `EXT Shop ${RUN}`]);
    const base = {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET, employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', factsTtlMs: 0,
      secureCookie: false, messagingEnabled: false, pageTranscriber: transcriber, kickOutbound: async () => {}, kickDrive: async () => {}, enqueueInbound: async () => {},
    };
    app = Fastify({ logger: false });
    registerWebApp(app, { ...base, catalogExtractor: extractor, pdfReadable: true } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    bare = Fastify({ logger: false });
    registerWebApp(bare, base as unknown as Parameters<typeof registerWebApp>[1]);
    await bare.ready();
    const login = async (a: typeof app) => String((await a.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    cookie = await login(app); bareCookie = await login(bare);
    expect(cookie).not.toBe('');
  }, 60_000);
  afterAll(async () => { await app?.close(); await bare?.close(); await db?.destroy(); await admin?.end(); });

  it('THE CLOSER READING: only what a line holds, each row waiting for her tick, with what it is less sure of', async () => {
    const at = await pasteList(app, cookie, LIST);
    const page = (await get(app, cookie, at)).body;
    expect(page).toContain('id="extract"');
    expect(page).toContain(`formaction="${at}/extract"`);
    const r = await extract(at);
    expect(r.headers['location']).toBe(at);
    expect(flashSaid(r, SECRET)).toBe(t('en', 'import.flash.extracted', { n: 1 }));
    expect(asked[0]!.lines).toEqual(['Tote bag 39 | 2 colours | 3 sizes', 'Linen apron — 18 each, pack of 6']);
    const after = await rows(at);
    expect(after.find((x) => x.line.startsWith('Tote'))).toMatchObject({ name: 'Tote bag', price: 39 });
    expect(after.find((x) => x.line.startsWith('Tote'))!.confidence).toBeTruthy();
    expect(after.find((x) => x.line.startsWith('Linen'))).toMatchObject({ price: null });
    expect(after.find((x) => x.line.startsWith('Linen'))!.confidence).toBeUndefined();
    const review = (await get(app, cookie, at)).body;
    expect(review).toContain(t('en', 'import.flag.low_confidence'));
    expect(review).toContain(t('en', 'import.lessSure', { fields: t('en', 'import.field.price') }));
    // Not added until its own tick: every other row checked, this one not — refused.
    const tote = rowKey(review, 'Tote bag');
    const apron = rowKey(review, 'Linen apron — 18 each, pack of 6');
    // (V1-335) a line with no figure is a row of its own that waits too: the heading is left out, as an owner would.
    const heading = rowKey(review, 'SPRING SALE');
    const blocked = await submitReview(app, cookie, at, { set: { [`tick:${apron}`]: 'on', [`remove:${heading}`]: 'on' } });
    expect(blocked.res.statusCode).toBe(400);
    const ok = await submitReview(app, cookie, at, { set: { [`tick:${apron}`]: 'on', [`tick:${tote}`]: 'on', [`remove:${heading}`]: 'on' } });
    expect(ok.res.statusCode).toBe(302);
    const p = (await admin.query(`select price_usd_per_unit::float as price from products where business_id = $1 and name = 'Tote bag'`, [BIZ])).rows[0];
    expect(p.price).toBe(39);
  });

  it('NEVER PAST THE ALLOWANCE; NOT OFFERED where no extractor exists', async () => {
    const at = await pasteList(app, cookie, 'Mug 12 | 3 colours');
    await admin.query(`insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded) values ($1, 1, 1000, 80, 'pause')
                       on conflict (business_id) do update set daily_llm_calls = 1, on_exceeded = 'pause'`, [BIZ]);
    await admin.query(`insert into usage_ledger (business_id, day, llm_calls, input_tokens, output_tokens) values ($1, (now() at time zone 'UTC')::date, 5, 10, 10)
                       on conflict (business_id, day) do update set llm_calls = 5`, [BIZ]);
    const before = asked.length;
    expect(flashSaid(await extract(at), SECRET)).toBe(t('en', 'import.flash.extractAllowance'));
    expect(asked.length).toBe(before);
    await admin.query(`delete from tenant_budgets where business_id = $1`, [BIZ]);
    const other = await pasteList(bare, bareCookie, 'Bowl 8 | 2 sizes');
    expect((await get(bare, bareCookie, other)).body).not.toContain('id="extract"');
  });

  it('A PDF PRICE LIST: read like a page, kept, opened as itself — and only a real PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% a price list\n');
    const r = await postPhotos(app, cookie, [{ bytes: pdf, mime: 'application/pdf' }]);
    expect(r.statusCode).toBe(303);
    const at = String(r.headers['location']);
    expect(read.at(-1)!.mediaType).toBe('application/pdf');
    const page = (await get(app, cookie, at)).body;
    expect(page).toContain(t('en', 'import.pdfOpen'));
    const file = await get(app, cookie, `${at}/photo/1`);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(file.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const fake = await postPhotos(app, cookie, [{ bytes: Buffer.from('not a pdf'), mime: 'application/pdf' }]);
    expect(fake.body).toContain(t('en', 'product.photo.refused.not_a_photo'));
    // A reader that fails or never answers is said as that — never as a bad page, never a crash.
    readerDown = true;
    const down = await postPhotos(app, cookie, [{ bytes: pdf, mime: 'application/pdf' }]);
    readerDown = false;
    expect(down.statusCode).toBe(400);   // phase 6: the add page again, the sentence under the photo field
    expect(down.body).toContain(t('en', 'product.photo.refused.reader_failed'));
  });

  it('WHERE THE PROVIDER CANNOT READ A PDF, none is offered, and one sent is refused in plain words — nothing read', async () => {
    expect((await get(app, cookie, '/app/products/add')).body).toContain('accept="image/jpeg,image/png,image/webp,application/pdf"');
    expect((await get(bare, bareCookie, '/app/products/add')).body).toContain('accept="image/jpeg,image/png,image/webp"');
    const before = read.length;
    const r = await postPhotos(bare, bareCookie, [{ bytes: Buffer.from('%PDF-1.4\n% a price list\n'), mime: 'application/pdf' }]);
    expect(r.body).toContain(t('en', 'product.photo.refused.pdf_unreadable'));
    expect(read.length).toBe(before);
  });

  it('AN EXCEL WORKBOOK goes to the column mapping, as a CSV would', async () => {
    const parts: Record<string, string> = {
      'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Price</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Teapot</t></is></c><c r="B2"><v>30</v></c></row></sheetData></worksheet>',
    };
    const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
    for (const [name, text] of Object.entries(parts)) {
      const raw = Buffer.from(text); const data = deflateRawSync(raw); const n = Buffer.from(name);
      const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(n.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
      locals.push(l, n, data); centrals.push(c, n); offset += 30 + n.length + data.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(3, 8); end.writeUInt16LE(3, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    const xlsx = Buffer.concat([...locals, cd, end]);
    const body = Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="prices.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      xlsx, Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]);
    const r = await app.inject({ method: 'POST', url: '/app/products/add/file', headers: { cookie, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, payload: body });
    expect(r.statusCode).toBe(303);
    expect(String(r.headers['location'])).toMatch(/\/columns$/);
    expect((await get(app, cookie, String(r.headers['location']))).body).toContain('Teapot');
  });
});
