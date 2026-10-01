#!/usr/bin/env node
/**
 * EXT — the two new things asked of the model this installation really uses:
 * reading a PDF price list (the page reader, given a document) and the closer
 * reading of lines the parser could not make products of (the extractor).
 *
 * WHY IT EXISTS. No test may reach a model (`offlineModels()`), so only this
 * run can show that the provider accepts a PDF at all, and that the extractor
 * copies what a line holds — and that containment (`containExtracted`) keeps
 * what the line does not hold out of the catalogue either way.
 *
 * WHAT IT ASKS. A one-page PDF, made here, whose text is two priced lines; and
 * six lines a parser refuses (a bare price, a decimal comma, a minimum, a
 * heading, two products at once, a line with no price). It prints what came
 * back and what containment kept. It touches no database and prints no
 * secret: only the provider's kind and the model's name.
 *
 * EXIT 0 when the PDF is read with both prices, every kept reading is one the
 * line holds, and the heading and the two-product line are not products.
 *
 *   npm run build && railway run --service nomi -- node tools/check-ext.mjs
 */
const { llmProviderFrom, llmClient, requestExtrasFor } = await import('../dist/llm/provider.js');
const { anthropicPageTranscriber, anthropicCatalogExtractor } = await import('../dist/llm/anthropic.js');
const { containExtracted } = await import('../dist/core/onboard/extract.js');

const provider = llmProviderFrom(process.env, process.env['ANTHROPIC_API_KEY'] ?? '');
if (!provider.apiKey) {
  console.error('No model key in this environment. Run it inside: railway run --service nomi -- …');
  process.exit(2);
}
const client = llmClient(provider);
console.log(`provider: ${provider.name} · model: ${provider.model}\n`);
let bad = 0;
/** One minute for any one call: a provider that never answers is a NO, never a hang. */
const capped = (p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('no answer within 60 s')), 60_000))]);

/** The smallest honest PDF: one page, Helvetica, two lines, a correct cross-reference table. */
function pdfOf(lines) {
  const text = lines.map((l, i) => `BT /F1 16 Tf 24 ${110 - i * 26} Td (${l.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n');
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${Buffer.byteLength(text)}>>\nstream\n${text}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// 1 · the PDF
try {
  const r = await capped(anthropicPageTranscriber(client, provider.model, requestExtrasFor(provider))
    .transcribe({ imageBase64: pdfOf(['Silk scarf  $24.50', 'Wool hat  $15.00']).toString('base64'), mediaType: 'application/pdf' }));
  const ok = !r.unreadable && /24\.50/.test(r.text) && /15\.00/.test(r.text);
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'NO '} PDF read${r.cutOff ? ' (CUT OFF)' : ''}\n  →  ${JSON.stringify(r.text)}\n`);
} catch (e) {
  bad++;
  console.log(`NO  PDF: the provider refused it — ${e instanceof Error ? e.message.slice(0, 200) : String(e)}\n`);
}

// 2 · the extractor
const LINES = [
  'Tote bag 39 | 2 colours | 3 sizes',
  'Silk scarf 24,50 each',
  'Linen apron — 18 each, min 12',
  'SPRING SALE — EVERYTHING MUST GO',
  'Mug 8 or bowl 12',
  'Teapot (price on request)',
];
try {
  const r = await capped(anthropicCatalogExtractor(client, provider.model, requestExtrasFor(provider)).extract({ lines: LINES, currency: 'USD' }));
  const kept = containExtracted(r.items, LINES);
  console.log(`extractor: ${r.items.length} read, ${kept.length} kept by containment`);
  for (const it of r.items) {
    const k = kept.find((x) => x.line === it.line.trim());
    console.log(`  ${k ? 'kept' : 'DROP'}  ${JSON.stringify(it.line)} → ${JSON.stringify({ name: it.name, price: it.price, moq: it.moq, confidence: it.confidence })}`);
  }
  const named = (line) => kept.some((x) => x.line === line);
  if (named('SPRING SALE — EVERYTHING MUST GO') || named('Mug 8 or bowl 12')) { bad++; console.log('NO  a heading or a two-product line became a product'); }
  if (!named('Silk scarf 24,50 each')) { bad++; console.log('NO  the plainest line was not read'); }
} catch (e) {
  bad++;
  console.log(`NO  extractor failed — ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
}
console.log(bad === 0 ? '\nall as intended' : `\n${bad} not as intended`);
process.exit(bad === 0 ? 0 : 1);
