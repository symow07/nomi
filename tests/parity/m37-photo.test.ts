import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parsePriceLines, validatePage } from '../../src/core/onboard/catalogImport.js';
import { importFromPhoto, renderReview, reviewImport, renderPhotoRefusal, renderAddForm } from '../../src/api/web/products.js';
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
const shot = { imageBase64: 'aGk=', mediaType: 'image/jpeg' as const };

describe('M37 · the model never produces a price the page does not contain', () => {
  it('every accepted price appears verbatim in the transcribed text', async () => {
    const out = await importFromPhoto({ transcriber: reader() }, shot);
    expect(out.kind).toBe('read');
    if (out.kind !== 'read') return;
    for (const p of out.review.accepted) {
      expect(p.price).not.toBeNull();
      expect(out.text, `${p.name} priced at something no line says`)
        .toContain(String(p.price!.amount));
    }
  });

  it('the products come from the PARSER, not from the reader', async () => {
    // The deterministic parser over the transcribed text gives the same result,
    // so there is no second extraction path where a model could add a row.
    const out = await importFromPhoto({ transcriber: reader() }, shot);
    if (out.kind !== 'read') throw new Error('unreachable');
    expect(out.review).toEqual(validatePage(parsePriceLines(PAGE)));
  });

  it('WHAT CONFIRM WRITES IS WHAT THE REVIEW SHOWED', async () => {
    // The staged text round-trips through a hidden field and confirmImport
    // re-parses it with the PASTE rule. If staging carried the whole page, the
    // page rule and the paste rule would disagree and confirm would write rows
    // she never saw — two paths deriving one list by different rules, which is
    // this repo's recurring bug.
    const out = await importFromPhoto({ transcriber: reader({ text: `TIANHE TEXTILE CO., LTD\n${PAGE}\nThank you for your order` }) }, shot);
    if (out.kind !== 'read') throw new Error('unreachable');
    expect(reviewImport(out.text).accepted).toEqual(out.review.accepted);
    expect(out.text).not.toContain('Thank you for your order');
  });

  it('a line with no price on it is SHOWN as skipped, never silently dropped', async () => {
    const out = await importFromPhoto({ transcriber: reader({ text: `TIANHE TEXTILE CO., LTD\n${PAGE}` }) }, shot);
    if (out.kind !== 'read') throw new Error('unreachable');
    const skipped = out.review.rejected.map((r) => r.product.name);
    expect(skipped).toContain('TIANHE TEXTILE CO., LTD');
    const html = renderReview(out.review, out.text, 'en');
    expect(html).toContain(t('en', 'product.reject.no_price_on_page'));
  });

  it('and the paste flow is UNCHANGED — a priceless line she typed is still hers', () => {
    // Two inputs, two rules, on purpose: a paste is what she chose to paste.
    const pasted = reviewImport('Canvas tote bag');
    expect(pasted.accepted.map((p) => p.name)).toEqual(['Canvas tote bag']);
    expect(validatePage(parsePriceLines('Canvas tote bag')).accepted).toEqual([]);
  });

  it('a reader that hallucinates a product still cannot price one — the line is shown', async () => {
    // Suppose the page reader invents a whole line. It becomes a product, and
    // that is exactly why the LINE travels with it to the review screen: the
    // owner is checking a transcription against paper, not approving a list.
    const invented = 'Ghost lamp  X-999  $9.99  MOQ 100';
    const out = await importFromPhoto({ transcriber: reader({ text: `${PAGE}\n${invented}` }) }, shot);
    if (out.kind !== 'read') throw new Error('unreachable');
    const html = renderReview(out.review, out.text, 'en');
    expect(html).toContain('Ghost lamp  X-999  $9.99  MOQ 100');
    expect(html).toContain(t('en', 'product.review.fromLine'));
  });
});

describe('M37 · the source line, beside every product', () => {
  it('the parser keeps the line it read each product out of', () => {
    const [first] = parsePriceLines(PAGE);
    expect(first!.sourceLine).toBe('Canvas tote bag  A-100   $1.05   MOQ 500');
  });

  it('the review renders it — for a PASTE too, not only a photo', () => {
    const html = renderReview(reviewImport(PAGE), PAGE, 'en');
    expect(html).toContain('class="rev-src');
    expect(html).toContain('Canvas tote bag  A-100');
    // isolated for RTL: an English price line inside an Arabic page must not
    // reorder around the digits.
    expect(html).toContain('<bdi>');
  });

  it('and the label exists in all three locales', () => {
    for (const locale of LOCALES) {
      const html = renderReview(reviewImport(PAGE), PAGE, locale);
      expect(html, locale).toContain(t(locale, 'product.review.fromLine'));
    }
  });
});

describe('M37 · an unreadable page is refused WHOLE', () => {
  it('a page the reader could not read produces no products at all', async () => {
    const out = await importFromPhoto({ transcriber: reader({ text: '', unreadable: true }) }, shot);
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') return;
    expect(out.reason).toBe('unreadable');
    // No partial import exists as a value: the "read" branch is the only one
    // carrying products, so there is no half-page to accidentally confirm.
    expect('review' in out).toBe(false);
  });

  it('text with nothing product-shaped in it is refused rather than shown as empty', async () => {
    const out = await importFromPhoto({ transcriber: reader({ text: 'INVOICE\nThank you for your order' }) }, shot);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.reason).toBe('no_lines');
  });

  it('NOT CONFIGURED is a legitimate state, and says so — it does not pretend', async () => {
    const out = await importFromPhoto({ transcriber: undefined }, shot);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.reason).toBe('not_configured');
  });

  it('every refusal names the next action, in every locale', () => {
    const reasons = ['not_configured', 'unreadable', 'no_lines', 'too_large'] as const;
    for (const locale of LOCALES) {
      for (const reason of reasons) {
        const html = renderPhotoRefusal(reason, locale);
        const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
        expect(visible, `${locale} ${reason}`).toContain(t(locale, `product.photo.refused.${reason}` as MessageKey));
        // the way out is on the page, and it is a link she can tap
        expect(html, `${locale} ${reason}`).toContain('href="/app/products/add"');
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
    expect(app).toMatch(/limits: \{[\s\S]{0,400}parts: 6/);
    expect(app).toMatch(/limits: \{[\s\S]{0,400}fields: 4/);
  });

  it('THE PRODUCTION ENTRYPOINT constructs the port — tests passing is not built', async () => {
    const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('anthropicPageTranscriber');
    expect(main).toMatch(/registerWebApp\(a, \{[\s\S]{0,80}pageTranscriber/);
  });
});
