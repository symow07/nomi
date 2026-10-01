import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { containExtracted, readFigure, figuresOn, parseExtractorAnswer, lessSure, LOW_CONFIDENCE, type ExtractedLine } from '../../src/core/onboard/extract.js';
import { needsTick, flagsOf, type ImportRow, type ReviewContext } from '../../src/core/onboard/importReview.js';
import { anthropicCatalogExtractor, anthropicPageTranscriber } from '../../src/llm/anthropic.js';

/**
 * EXT — the model extractor, contained: no figure exists that a line does not
 * hold, every row it reads waits for the owner's own tick, and a PDF is a page
 * the model only transcribes. No test reaches a model: the client is a fake.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sure = { name: 0.95, price: 0.95, unit: 0.9, moq: 0.9 };
const item = (over: Partial<ExtractedLine> = {}): ExtractedLine =>
  ({ line: 'Silk scarf — 24,50 each, min 12', name: 'Silk scarf', price: '24,50', unit: 'each', moq: 12, confidence: sure, ...over });

describe('EXT · figures as written', () => {
  it('either decimal mark, thousands both ways', () => {
    expect(readFigure('24,50')).toBe(24.5);
    expect(readFigure('24.50')).toBe(24.5);
    expect(readFigure('1,200')).toBe(1200);
    expect(readFigure('1.200,50')).toBe(1200.5);
    expect(readFigure('1,200.50')).toBe(1200.5);
    expect(readFigure('1.200.000')).toBe(1200000);
    expect(readFigure('abc')).toBeNull();
  });
  it('every number written on a line', () => {
    expect(figuresOn('Silk scarf — 24,50 each, min 12')).toEqual([24.5, 12]);
  });
});

describe('EXT · what a reading may become', () => {
  const LINES = ['Silk scarf — 24,50 each, min 12', 'Tote bag 39 | 2 colours', 'SPRING SALE'];
  it('a reading the line holds survives, with its confidence', () => {
    expect(containExtracted([item()], LINES)).toEqual([{ line: LINES[0], name: 'Silk scarf', price: 24.5, unit: 'each', moq: 12, confidence: sure }]);
  });
  it('a line it was not given, a name not on the line, a price or a minimum the line does not hold: nothing', () => {
    expect(containExtracted([item({ line: 'Silk scarf 24,50' })], LINES)).toEqual([]);
    expect(containExtracted([item({ name: 'Cashmere scarf' })], LINES)).toEqual([]);
    expect(containExtracted([item({ price: '25.00' })], LINES)).toEqual([]);
    expect(containExtracted([item({ moq: 10 })], LINES)).toEqual([]);
    expect(containExtracted([item({ price: '0' , line: LINES[2]!, name: 'SPRING SALE' })], LINES)).toEqual([]);
  });
  it('each line once; a price-less reading keeps no price; nonsense confidence reads as unsure', () => {
    const twice = containExtracted([item(), item()], LINES);
    expect(twice).toHaveLength(1);
    const noPrice = containExtracted([item({ line: LINES[1]!, name: 'Tote bag', price: null, moq: null, confidence: { name: 2, price: -1, unit: Number.NaN, moq: 0.5 } })], LINES)[0]!;
    expect(noPrice.price).toBeNull();
    expect(noPrice.confidence).toEqual({ name: 1, price: 0, unit: 0, moq: 0.5 });
  });
  it('less sure: only the fields read at all', () => {
    expect(lessSure({ name: 0.9, price: 0.5, unit: 0.9, moq: 0.2 }, { price: 10, moq: null })).toEqual(['price']);
    expect(LOW_CONFIDENCE).toBe(0.8);
  });
});

describe('EXT · the answer, read defensively', () => {
  it('JSON anywhere in the text; a field of the wrong shape drops that item', () => {
    const raw = `Here: {"products":[
      {"line":"A 1","name":"A","price":"1","unit":null,"moq":null,"confidence":{"name":0.9,"price":0.9,"unit":0,"moq":0}},
      {"line":"B 2","name":"B","price":{"x":2},"unit":null,"moq":null},
      {"line":"C 3","name":"C","price":3,"moq":"many"},
      {"name":"D"}]} thanks`;
    expect(parseExtractorAnswer(raw).map((x) => x.line)).toEqual(['A 1']);
    expect(parseExtractorAnswer('no json')).toEqual([]);
    expect(parseExtractorAnswer('{"products": "x"}')).toEqual([]);
  });
});

describe('EXT · the tick rule', () => {
  const ctx = { kind: 'paste', currency: 'USD', countryCurrency: null, country: null, defaultUnit: 'pcs' } as unknown as ReviewContext;
  const row = (over: Partial<ImportRow> = {}): ImportRow => ({
    key: 'l1', line: 'Silk scarf 24.50', photo: null, sku: null, name: 'Silk scarf', nameZh: null, price: 24.5, unit: 'pcs', moq: null,
    names: [], refused: null, removed: false, ticked: false, challenge: null, reopened: false, edited: false, ...over,
  });
  it('a row the extractor read always waits for its own tick, and is flagged when read less surely', () => {
    expect(needsTick(row(), [row()], ctx, false)).toBe(false);
    expect(needsTick(row({ confidence: sure }), [row()], ctx, false)).toBe(true);
    expect(flagsOf(row({ confidence: sure }), [row()], ctx)).not.toContain('low_confidence');
    expect(flagsOf(row({ confidence: { ...sure, price: 0.4 } }), [row()], ctx)).toContain('low_confidence');
  });
});

describe('EXT · the model, faked', () => {
  type Sent = { max_tokens: number; temperature: number; messages: { content: { type: string; source?: { media_type: string } }[] }[] };
  const client = (answer: string, sent: Sent[]) => ({
    messages: { create: async (req: Sent) => { sent.push(req); return { content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }; } },
  }) as unknown as Parameters<typeof anthropicPageTranscriber>[0];
  it('a PDF is a document the model only transcribes, with room for its pages', async () => {
    const sent: Sent[] = [];
    const r = await anthropicPageTranscriber(client('Silk scarf 24.50', sent)).transcribe({ imageBase64: 'JVBERi0=', mediaType: 'application/pdf' });
    expect(r.text).toBe('Silk scarf 24.50');
    expect(sent[0]!.messages[0]!.content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });
    expect(sent[0]!.max_tokens).toBe(8000);
    await anthropicPageTranscriber(client('x', sent)).transcribe({ imageBase64: 'x', mediaType: 'image/png' });
    expect(sent[1]!.messages[0]!.content[0]!.type).toBe('image');
  });
  it('the extractor: temperature 0, the lines as given, its answer parsed', async () => {
    const sent: Sent[] = [];
    const out = await anthropicCatalogExtractor(client('{"products":[{"line":"A 1","name":"A","price":"1","unit":null,"moq":null,"confidence":{"name":1,"price":1,"unit":0,"moq":0}}]}', sent))
      .extract({ lines: ['A 1'], currency: 'USD' });
    expect(sent[0]!.temperature).toBe(0);
    expect(out.items).toHaveLength(1);
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

describe('EXT · where it is asked', () => {
  it('the owner asks; what she had ticked is saved first; within the allowance; the spend recorded', () => {
    const app = src('src/api/web/app.ts');
    const route = app.slice(app.indexOf("app.post('/app/products/import/:importId/extract'"));
    expect(route.indexOf('saveReview(')).toBeLessThan(route.indexOf('extractRefused('));
    expect(route).toContain("spent: (u) => recordSpendAlone(deps.db, s.businessId, u, { turn: false }),");
    const flow = src('src/api/web/importFlow.ts');
    expect(flow).toContain("if (ask.used) return { kind: 'allowance_used' };");
    expect(flow).toContain('containExtracted(read.items, ask.lines)');
  });
  it('a PDF is accepted only when its own bytes say so', () => {
    expect(src('src/api/web/app.ts')).toContain("if (mt === 'application/pdf' && bytes.subarray(0, 5).toString('latin1') === '%PDF-')");
    expect(src('migrations/0118_ext.sql')).toContain("'application/pdf'");
  });
});
