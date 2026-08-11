import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { decideImageIntake, seeImage } from '../../src/pipeline/imageIntake.js';
import type { ImageInquiryResult, ImageTurnDeps } from '../../src/pipeline/imageTurn.js';
import type { RetrievedProduct } from '../../src/retrieval/ports.js';
import { product } from './fixtures.js';

/**
 * M4.5 — the picture path is REACHED.
 *
 * M4 built `computeImageInquiry`, tested it thoroughly, and never called it.
 * `m4-image-wow.test.ts` proves the function WORKS; nothing proved it was
 * REACHED, and for months a buyer's photo was answered from its caption or from
 * nothing at all. This file tests the half that was missing — and the checker
 * that makes the whole class of bug impossible to ship again.
 */

const usage = { llmCalls: 1, inputTokens: 10, outputTokens: 5 };

/**
 * Typed fixtures, per M22. Casting a whole object literal with `as never`
 * disables every check the compiler could make about it — which is how
 * `refusals.test.ts` once asserted against a SendPlan action that does not
 * exist, passing while testing a state that cannot occur.
 */
/** Only the ports a given test actually exercises; the rest throw if reached. */
const partialDeps = (over: Partial<ImageTurnDeps>): ImageTurnDeps => ({
  media: () => { throw new Error('media not expected'); },
  vision: { describe: () => { throw new Error('vision not expected'); } },
  retriever: { byImageDescription: () => { throw new Error('retrieval not expected'); } },
  loadQuoteInputs: () => { throw new Error('quote inputs not expected'); },
  ...over,
});

const candidate = (over: Partial<RetrievedProduct> = {}): RetrievedProduct => ({
  productId: product().id, sku: 'ZX-1', name: 'Canvas Tote Bag', category: 'bags',
  moq: 500, relevance: 0.6, matchedVia: 'both', ...over,
});

/* ── the structural guarantee ────────────────────────────────────────────── */

describe('M4.5 · nothing in the pipeline is dead code claiming to be a feature', () => {
  /**
   * The point of the checker is that it FAILS. A guard nobody has watched fail
   * is a guard nobody knows works — so this runs the real tool against a tree
   * where a pipeline module has no production caller, and requires a non-zero
   * exit naming it.
   */
  it('the reachability checker exits non-zero and names an unreachable module', () => {
    const probe = `
      import { readFileSync, writeFileSync } from 'node:fs';
      let s = readFileSync('tools/check-reachable.mjs', 'utf8');
      s = s.replace(/const ENTRYPOINTS = \\[[^\\]]*\\]/, "const ENTRYPOINTS = ['tools/.probe-entry.ts']");
      writeFileSync('tools/.probe-check.mjs', s);
      writeFileSync('tools/.probe-entry.ts', 'export const nothing = 1;\\n');
    `;
    execFileSync(process.execPath, ['--input-type=module', '-e', probe]);
    let code = 0; let out = '';
    try {
      out = execFileSync(process.execPath, ['tools/.probe-check.mjs'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      code = err.status; out = `${err.stdout}${err.stderr}`;
    } finally {
      execFileSync(process.execPath, ['--input-type=module', '-e',
        `import {rmSync} from 'node:fs'; rmSync('tools/.probe-check.mjs',{force:true}); rmSync('tools/.probe-entry.ts',{force:true});`]);
    }
    expect(code, 'an unreachable pipeline module must fail the build').not.toBe(0);
    expect(out).toMatch(/imageTurn\.ts|imageIntake\.ts|voiceTurn\.ts/);
    expect(out).toContain('reachable only from tests');
  });

  it('it passes on the real tree — every pipeline module is now called', () => {
    const out = execFileSync(process.execPath, ['tools/check-reachable.mjs'], { encoding: 'utf8' });
    expect(out).toContain('is reached from production');
  });

  it('every declared gap carries a reason someone can act on', async () => {
    const src = await readFile(new URL('../../tools/check-reachable.mjs', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('const DECLARED_UNWIRED'), src.indexOf('const isTs'));
    const entries = [...block.matchAll(/'([^']+\.ts)':\s*\n?\s*'([^']*)'/g)];
    expect(entries.length, 'the exemption list should be short enough to read').toBeLessThanOrEqual(5);
    for (const [, file, reason] of entries) {
      expect(reason!.length, `${file} needs a real reason, not a shrug`).toBeGreaterThan(40);
    }
    expect(block, 'imageTurn must never be exempted — it is wired').not.toContain('imageTurn');
  });
});

/* ── the worker actually branches on a photo ─────────────────────────────── */

describe('M4.5 · the worker calls the picture path', () => {
  it('branches on image alongside audio, and routes through imageTurn', async () => {
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/messageType === 'image'/);
    expect(src).toContain('seeImage');
    expect(src, 'a photo she could not read must not reach computeTurn').toMatch(/if \(seen\?\.kind === 'refused'\)/);
    expect(src, 'and must tell the owner').toMatch(/kind: 'low_confidence_image'/);
  });

  it('the description becomes the turn text — one pipeline, as with a transcript', async () => {
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/seen\?\.kind === 'words' \? seen\.text/);
  });

  it('download and vision run OUTSIDE the tenant transaction', async () => {
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    const seeAt = src.indexOf('await seeImage(');
    const txAt = src.indexOf('await withTenantTx(db, businessId.value');
    expect(seeAt).toBeGreaterThan(0);
    // Holding a conversation lock across a media download and a vision call
    // would serialise every other buyer behind one slow provider — the same
    // reason M34 hears a voice note before opening the transaction.
    expect(seeAt, 'the photo is seen before the transaction opens').toBeLessThan(txAt);
  });

  it('no transaction is held across the network inside the deps either', async () => {
    const src = await readFile(new URL('../../src/pipeline/imageIntake.ts', import.meta.url), 'utf8');
    // Each database call opens its OWN short transaction; the media and vision
    // ports take none. That is what let imageTurn stay untouched.
    expect(src).toMatch(/byImageDescription: \(query, k\) =>\s*\n?\s*withTenantTx/);
    expect(src).toMatch(/loadQuoteInputs: \(productId\) =>\s*\n?\s*withTenantTx/);
  });
});

/* ── fail closed, and never a silent third outcome ───────────────────────── */

describe('M4.5 · an unreadable photo is refused, never answered from its caption', () => {
  const cases: readonly [string, ImageInquiryResult, 'refused' | 'words'][] = [
    ['media never arrived', { kind: 'media_failed', retryable: true, usage }, 'refused'],
    ['vision saw nothing in it', { kind: 'media_failed', retryable: false, usage }, 'refused'],
    ['two products within a hair', {
      kind: 'ambiguous',
      candidates: [candidate({ relevance: 0.5 }), candidate({ name: 'B', relevance: 0.49 })],
      usage,
    }, 'refused'],
    ['nothing close in her catalogue', { kind: 'no_match', searchText: 'a blue kettle', usage }, 'words'],
  ];

  for (const [name, result, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(decideImageIntake(result, null).kind).toBe(expected);
    });
  }

  it('a photo with no media id refuses without calling vision', async () => {
    let called = false;
    const out = await seeImage(
      { image: partialDeps({ media: async () => { called = true; return { ok: false, retryable: false, error: 'x' }; } }) },
      { mediaId: null, caption: 'how much?' },
    );
    expect(out.kind).toBe('refused');
    expect(called).toBe(false);
  });

  it('no vision configured refuses rather than answering from the caption', async () => {
    const out = await seeImage({ image: undefined }, { mediaId: 'm1', caption: '20000 pcs?' });
    expect(out.kind).toBe('refused');
  });

  it('an ambiguous match is refused even though BOTH candidates are hers', () => {
    // Containment is not the question here — both products are in her
    // catalogue. MATCH_MIN_MARGIN exists so she does not pick between them,
    // and a second retrieval pass downstream must not overrule the first.
    const out = decideImageIntake({
      kind: 'ambiguous',
      candidates: [candidate({ relevance: 0.6 }), candidate({ name: 'B', relevance: 0.58 })],
      usage,
    }, 'this one, 5000 pcs');
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.reason).toBe('ambiguous');
  });
});

/* ── what reaches the model is a description, not invented buyer speech ──── */

describe('M4.5 · a photo becomes words without putting words in the buyer\'s mouth', () => {
  it('carries the caption as his, and the description marked as a photo', () => {
    const out = decideImageIntake(
      { kind: 'matched', product: candidate(), quote: null,
        quantityFromCaption: false, visionAttributes: ['canvas bag', 'beige', 'handles'], usage },
      'how much for 5000?',
    );
    expect(out.kind).toBe('words');
    if (out.kind !== 'words') return;
    expect(out.text).toContain('how much for 5000?');
    expect(out.text).toMatch(/\[photo: .*canvas bag/);
    // The matched product's NAME must not appear: vision describes, retrieval
    // matches, and handing the model a conclusion would break the containment
    // rule that makes photo answers safe.
    expect(out.text, 'never hand the model the catalogue answer').not.toContain('Canvas Tote Bag');
  });

  it('a caption-less photo still becomes something she can act on', () => {
    const out = decideImageIntake(
      { kind: 'matched', product: candidate({ name: 'Bottle' }), quote: null, quantityFromCaption: false,
        visionAttributes: ['stainless steel bottle'], usage },
      null,
    );
    expect(out.kind === 'words' && out.text).toBe('[photo: stainless steel bottle]');
  });
});

/* ── the M4 suite still passes, unchanged ────────────────────────────────── */

describe('M4.5 · imageTurn itself was not redesigned', () => {
  it('m4-image-wow.test.ts is still present and still imports imageTurn', async () => {
    const files = await readdir(new URL('./', import.meta.url));
    expect(files).toContain('m4-image-wow.test.ts');
    const src = await readFile(new URL('./m4-image-wow.test.ts', import.meta.url), 'utf8');
    expect(src).toContain("from '../../src/pipeline/imageTurn.js'");
  });

  it('imageTurn.ts has no database import — the ports stayed ports', async () => {
    const src = await readFile(new URL('../../src/pipeline/imageTurn.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('withTenantTx');
    expect(src).not.toContain("from '../db/");
  });
});
