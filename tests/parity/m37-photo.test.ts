import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parsePriceLines, validatePage } from '../../src/core/onboard/catalogImport.js';
import { renderPhotoRefusal, renderAddForm } from '../../src/api/web/products.js';
import { readPhotos } from '../../src/api/web/importFlow.js';
import { validateExtracted } from '../../src/core/onboard/catalogImport.js';
import { liveRows } from '../../src/core/onboard/importReview.js';
import { reviewPage } from './reviewPage.js';
import type { PageTranscriber } from '../../src/llm/ports.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M37 — she photographs the printed price list.
 *
 * The whole risk of this feature is one sentence: a model that reads a page can
 * also FINISH one. A blurred row completed from the rows around it, confirmed by
 * a tired owner at the end of a long import, becomes her catalogue and then her
 * quotes — and nothing downstream can tell it from a price she typed.
 *
 * So the split is the feature. The reader produces TEXT. `parsePriceLines`, a
 * deterministic parser with no model in it, produces PRODUCTS. And the line each
 * product came from is shown beside it, so what she confirms is a transcription
 * she can check against the paper in her hand rather than a list she must trust.
 */

const PAGE = [
  'Canvas tote bag  A-100   $1.05   MOQ 500',
  'Vacuum cup       B-220   $2.60   MOQ 1000',
].join('\n');

const reader = (over: Partial<Awaited<ReturnType<PageTranscriber['transcribe']>>> = {}): PageTranscriber => ({
  transcribe: async () => ({
    text: PAGE, unreadable: false, promptVersion: 'test', modelId: 'test',
    usage: { inputTokens: 1, outputTokens: 1 }, ...over,
  }),
});
const shot = [{ bytes: Buffer.from('hi'), mediaType: 'image/jpeg' as const }];
const read = (r: PageTranscriber) => readPhotos({ transcriber: r }, shot, 'USD', 'pcs');

describe('M37 · the model never produces a price the page does not contain', () => {
  it('every row\'s price appears verbatim in the transcribed text', async () => {
    const out = await read(reader());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const r of liveRows(out.rows)) {
      expect(r.price).not.toBeNull();
      expect(out.transcripts[0], `${r.name} priced at something no line says`).toContain(String(r.price));
    }
  });

  it('the rows come from the PARSER, not from the reader', async () => {
    // The deterministic parser over the transcribed text gives the same rows,
    // so there is no second extraction path where a model could add one.
    const out = await read(reader());
    if (!out.ok) throw new Error('unreachable');
    const byParser = validatePage(parsePriceLines(PAGE, 'USD')).accepted;
    expect(liveRows(out.rows).map((r) => [r.name, r.price, r.moq, r.line]))
      .toEqual(byParser.map((p) => [p.name, p.price!.amount, p.moq, p.sourceLine]));
  });

  it('WHAT IS ADDED IS WHAT THE REVIEW SHOWED: the rows are kept, never read again from text on the way', async () => {
    // K1 — the confirm writes the stored rows as they stand; it reads nothing
    // again. The letterhead and the footer are rows the review shows as not
    // added, and the writer's own list (`liveRows`) leaves them out.
    const out = await read(reader({ text: `TIANHE TEXTILE CO., LTD\n${PAGE}\nThank you for your order` }));
    if (!out.ok) throw new Error('unreachable');
    expect(out.rows).toHaveLength(4);
    expect(liveRows(out.rows).map((r) => r.name)).not.toContain('Thank you for your order');
    expect(out.rows.filter((r) => r.refused).map((r) => r.line)).toEqual(['TIANHE TEXTILE CO., LTD', 'Thank you for your order']);
  });

  it('a line with no price on it is SHOWN as not added, never silently dropped', async () => {
    const text = `TIANHE TEXTILE CO., LTD\n${PAGE}`;
    const html = reviewPage(text, 'en', { kind: 'photo' });
    expect(html).toContain('TIANHE TEXTILE CO., LTD');
    expect(html).toContain(t('en', 'product.reject.no_price_on_page'));
  });

  it('and the paste flow is UNCHANGED — a priceless line she typed is still hers', () => {
    // Two inputs, two rules, on purpose: a paste is what she chose to paste.
    const pasted = validateExtracted(parsePriceLines('Canvas tote bag', 'USD'));
    expect(pasted.accepted.map((p) => p.name)).toEqual(['Canvas tote bag']);
    expect(validatePage(parsePriceLines('Canvas tote bag', 'USD')).accepted).toEqual([]);
  });

  it('a reader that hallucinates a product still cannot price one unseen — the line is shown', async () => {
    // Suppose the page reader invents a whole line. It becomes a row, and that
    // is exactly why the LINE travels with it to the review: the owner checks a
    // transcription against paper, not a list — and K7 has her type prices
    // from the paper itself.
    const invented = 'Ghost lamp  X-999  $9.99  MOQ 100';
    const html = reviewPage(`${PAGE}\n${invented}`, 'en');
    expect(html).toContain('Ghost lamp  X-999  $9.99  MOQ 100');
    expect(html).toContain(t('en', 'product.review.fromLine'));
  });
});

describe('M37 · the source line, beside every product', () => {
  it('the parser keeps the line it read each product out of', () => {
    const [first] = parsePriceLines(PAGE, 'USD');
    expect(first!.sourceLine).toBe('Canvas tote bag  A-100   $1.05   MOQ 500');
  });

  it('the review renders it — for a PASTE too, not only a photo', () => {
    const html = reviewPage(PAGE, 'en');
    expect(html).toContain('class="rev-src');
    expect(html).toContain('Canvas tote bag  A-100');
    // isolated for RTL: an English price line inside an Arabic page must not
    // reorder around the digits.
    expect(html).toContain('<bdi>');
  });

  it('and the label exists in all three locales', () => {
    for (const locale of LOCALES) {
      expect(reviewPage(PAGE, locale), locale).toContain(t(locale, 'product.review.fromLine'));
    }
  });
});

describe('M37 · an unreadable page is refused WHOLE', () => {
  it('a page the reader could not read produces no products at all', async () => {
    const out = await read(reader({ text: '', unreadable: true }));
    expect(out).toEqual({ ok: false, reason: 'unreadable', photo: 1 });
    // No partial import exists as a value: the "ok" branch is the only one
    // carrying rows, so there is no half-page to accidentally confirm.
    expect('rows' in out).toBe(false);
  });

  it('text with nothing product-shaped in it is refused rather than shown as empty', async () => {
    const out = await read(reader({ text: 'INVOICE\nThank you for your order' }));
    expect(out).toEqual({ ok: false, reason: 'no_lines' });
  });

  it('NOT CONFIGURED is a legitimate state, and says so — it does not pretend', async () => {
    const out = await readPhotos({ transcriber: undefined }, shot, 'USD', 'pcs');
    expect(out).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('every refusal names the next action, in every locale', () => {
    const reasons = ['not_configured', 'unreadable', 'no_lines', 'too_large'] as const;
    for (const locale of LOCALES) {
      for (const reason of reasons) {
        const html = renderPhotoRefusal(reason, locale);
        const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
        expect(visible, `${locale} ${reason}`).toContain(t(locale, `product.photo.refused.${reason}` as MessageKey));
        // the way out is on the page, and it is a link she can tap — within the add page now (phase 6)
        expect(html, `${locale} ${reason}`).toMatch(/href="\/app\/products\/add#(?:paste|photo)"/);
        expect(visible).toContain(t(locale, reason === 'not_configured'
          ? 'product.photo.pasteInstead' : 'product.photo.retake'));
      }
    }
  });

  it('the refusal page never shows a partial list', () => {
    const html = renderPhotoRefusal('unreadable', 'en');
    expect(html).not.toContain('class="rev"');
    expect(html).toContain(t('en', 'product.photo.allOrNothing'));
  });
});

describe('M37 · it is a SEPARATE PORT from the image describer', () => {
  /**
   * Describing a photo for catalogue matching and transcribing a page are
   * different jobs with OPPOSITE containment rules: describe must never name a
   * product, transcribe must never invent a line. One interface serving two
   * contracts is how those leak into each other.
   */
  it('PageTranscriber and VisionDescriber are distinct interfaces', async () => {
    const src = await readFile(new URL('../../src/llm/ports.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/export interface PageTranscriber \{/);
    expect(src).toMatch(/export interface VisionDescriber \{/);
    // and the describer gained no transcription method
    const describer = src.slice(src.indexOf('interface VisionDescriber'));
    expect(describer.slice(0, describer.indexOf('}'))).not.toContain('transcribe');
  });

  it('the transcriber prompt forbids completing what it cannot read', async () => {
    const src = await readFile(new URL('../../src/llm/anthropic.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('anthropicPageTranscriber'));
    expect(fn).toContain('never guess it from the other rows');
    expect(fn).toContain('UNREADABLE');
    // it transcribes; it does not summarise, translate, or correct
    expect(fn).toMatch(/Do NOT summarise, reformat, translate, correct/);
  });
});

describe('M37 · the owner can reach it', () => {
  it('the add page offers the camera, in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderAddForm(locale);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible, locale).toContain(t(locale, 'product.add.photoButton'));
      expect(html).toContain('action="/app/products/add/photo"');
      expect(html).toContain('enctype="multipart/form-data"');
      // and she is told the all-or-nothing rule BEFORE she takes the photo
      expect(visible).toContain(t(locale, 'product.photo.allOrNothing'));
    }
  });

  it('the route is registered, and the parser has explicit limits', async () => {
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain("app.post('/app/products/add/photo'");
    // Unbounded parts and unbounded file size are the two defaults that matter.
    expect(app).toMatch(/limits: \{[\s\S]{0,400}fileSize: 8 \* 1024 \* 1024/);
    expect(app).toMatch(/limits: \{[\s\S]{0,400}files: 1/);
    // K1 — the photo route raises files and parts together, for ten photos and the question.
    expect(app).toContain('req.parts({ limits: { files: MAX_PHOTOS, parts: MAX_PHOTOS + 4 } })');
    expect(app).toMatch(/limits: \{[\s\S]{0,400}parts: 6/);
    expect(app).toMatch(/limits: \{[\s\S]{0,400}fields: 4/);
  });

  it('THE PRODUCTION ENTRYPOINT constructs the port — tests passing is not built', async () => {
    const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('anthropicPageTranscriber');
    expect(main).toMatch(/registerWebApp\(a, \{[\s\S]{0,80}pageTranscriber/);
  });
});
