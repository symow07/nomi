import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { readFile } from 'node:fs/promises';
import { renderProof, notFoundPage, mintToken, type ProofView } from '../../src/api/web/proof.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M35 — the proof link, and the one thing it must never do.
 *
 * "Show the buyer where every fact came from" reads, on its face, as "show the
 * pricing policy". That is the single kind of transparency that damages the
 * person we work for: a page reading `floor $0.35 · quoted $0.38` has told the
 * buyer exactly how far to push.
 *
 * These tests NAME the forbidden rows rather than checking a general property,
 * because the natural reading of "provenance" includes exactly the wrong ones
 * and the next person to touch this file will be trying to be helpful.
 */

const VIEW: ProofView = {
  seller: 'Yiwu Honghua Daily Goods',
  productName: 'Canvas tote bag',
  sku: 'ZX-100',
  quantity: 20000,
  unit: 'pcs',
  unitPrice: usd(0.38),
  total: usd(7600),
  tier: { minQty: 10000, maxQty: 50000 },
  moq: 1000,
  leadTimeDays: 25,
  certifications: ['BSCI', 'ISO 9001'],
  taught: [
    { label: 'Handle stitching', content: 'Double-stitched handles, reinforced at the base.' },
    { label: 'Printing', content: 'Up to four colours, screen printed.' },
  ],
  issuedAt: new Date('2026-08-12T02:00:00Z'),
  locale: 'en',
};

const visible = (html: string): string =>
  html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/* ── the exclusions, named ───────────────────────────────────────────────── */

describe('M35 · the buyer never sees the owner’s commercial rules', () => {
  /**
   * The concrete numbers a pricing_policy row holds for this fixture. If any of
   * them reaches the page, the owner has been sold out by their own tooling.
   */
  const FLOOR = '0.35';
  const MAX_DISCOUNT = '15';
  const APPROVAL_THRESHOLD = '10';

  it('no floor price, max discount or approval threshold, in any locale', () => {
    for (const locale of LOCALES) {
      const html = renderProof({ ...VIEW, locale });
      for (const forbidden of [FLOOR, MAX_DISCOUNT + '%', APPROVAL_THRESHOLD + '%']) {
        expect(html.includes(forbidden), `${locale}: "${forbidden}" reached the buyer`).toBe(false);
      }
    }
  });

  it('the loader never SELECTS the rows that hold them', async () => {
    // Structural, not a late filter: there must be no code path that has the
    // floor price in memory and declines to render it.
    const src = await readFile(new URL('../../src/api/web/proof.ts', import.meta.url), 'utf8');
    const sqlText = [...src.matchAll(/sql<[^>]*>`([\s\S]*?)`/g)].map((m) => m[1]).join('\n');
    expect(sqlText.length).toBeGreaterThan(0);
    for (const table of ['pricing_policy', 'negotiation_rules', 'autonomy_policy',
                         'drafts', 'capability_events', 'spot_checks', 'ops_flags',
                         'channel_credentials', 'pilot_allowlist', '_migrations']) {
      expect(sqlText.includes(table), `the proof loader must not read ${table}`).toBe(false);
    }
    // quotes.inputs is the jsonb snapshot of { tiers, policy, rules } — reading
    // the row is fine, reading THAT column brings the policy along with it.
    expect(sqlText).not.toMatch(/\binputs\b/);
    expect(sqlText).not.toMatch(/\bfloor_price_usd\b|\bmax_discount_pct\b|\bhuman_required_above_pct\b/);
  });

  it('shows no capability state, refusal, or draft status', () => {
    const html = visible(renderProof(VIEW)).toLowerCase();
    for (const word of ['draft', 'auto', 'capability', 'promoted', 'refused', 'refusal',
                        'handed off', 'approval', 'pending']) {
      expect(html.includes(word), `"${word}" is internal`).toBe(false);
    }
  });

  it('shows nothing about the build, the schema or the installation', () => {
    const html = renderProof(VIEW).toLowerCase();
    for (const word of ['schema', 'migration', 'version', 'commit', 'railway', 'postgres', 'nomi']) {
      expect(html.includes(word), `"${word}" is ours, not the buyer's`).toBe(false);
    }
  });

  it('carries no identifier a stranger could pivot on', () => {
    const html = renderProof(VIEW);
    // No UUIDs anywhere: not the tenant's, not the quote's, not the product's.
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('shows only THIS quote — no other buyer, no other price', () => {
    const html = visible(renderProof(VIEW));
    // The fixture's own figures appear; nothing resembling a second quote does.
    expect(html).toContain('7,600.00');
    expect((html.match(/\$/g) ?? []).length).toBeLessThanOrEqual(4);
  });
});

/* ── what it DOES show ───────────────────────────────────────────────────── */

describe('M35 · the facts that justify the quote, with their source', () => {
  it('price, tier, MOQ and lead time, each attributed', () => {
    const html = visible(renderProof(VIEW));
    expect(html).toContain('20,000 pcs');
    expect(html).toContain('$0.38');
    expect(html).toContain('$7,600.00');
    expect(html).toContain('10,000–50,000 pcs');
    expect(html).toContain('1,000 pcs');
    expect(html).toContain('25 days');
    expect(html).toContain("From the factory's product list");
  });

  it('certifications appear only as AUTHORISED, never as a bare claim', () => {
    const html = visible(renderProof(VIEW));
    expect(html).toContain('BSCI');
    expect(html).toContain('Authorised by the factory');
  });

  it('taught facts are shown in the second voice — a person said them', () => {
    const html = renderProof(VIEW);
    // <bdi> isolates the text from the page direction — see proof.ts.
    expect(html).toMatch(/<p class="voice"><bdi>Double-stitched handles/);
    expect(visible(html)).toContain('Confirmed by the factory');
  });

  it('a quote with no certifications and no taught facts renders neither section', () => {
    const bare = renderProof({ ...VIEW, certifications: [], taught: [] });
    expect(visible(bare)).not.toContain('Certifications');
    expect(visible(bare)).not.toContain('What this is based on');
    // and still shows the quote itself
    expect(visible(bare)).toContain('$0.38');
  });

  it('no invented numbers: every figure traces to a field on the view', () => {
    // DERIVED from the view, not a hand-listed set: a transcribed allowlist
    // drifts, and the first version of this test failed on the "100" inside the
    // SKU ZX-100 — a real field it had simply forgotten to list.
    const html = visible(renderProof(VIEW));
    const fromView = JSON.stringify(VIEW) + VIEW.issuedAt.toISOString();
    const numbers = (html.match(/[\d][\d,]*\.?\d*/g) ?? [])
      .map((n) => n.replace(/,/g, '').replace(/\.00$/, ''))
      .filter((n) => Number(n) >= 1);
    for (const n of numbers) {
      expect(fromView.includes(n), `figure "${n}" is on the page but in no field of the view`).toBe(true);
    }
  });
});

/* ── it is a page for a stranger, in their language ──────────────────────── */

describe('M35 · forwardable, and in the buyer’s language', () => {
  it('is a standalone document with no link back into the app', () => {
    const html = renderProof(VIEW);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta name="viewport"');
    expect(html).not.toContain('href="/app');
    expect(html).not.toContain('/login');
  });

  it('renders in every locale, and RTL is a document-level direction', () => {
    for (const locale of LOCALES) {
      const html = renderProof({ ...VIEW, locale });
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(locale === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
      expect(visible(html).length).toBeGreaterThan(120);
      // Placeholders in the COPY. The raw document contains '{' in its
      // stylesheet, which the first version of this assertion tripped over.
      expect(visible(html)).not.toContain('{');
    }
  });

  it('asks not to be indexed — a forwarded link is not a public listing', () => {
    expect(renderProof(VIEW)).toContain('noindex');
  });

  it('speaks no software jargon, exactly like every owner surface', () => {
    for (const locale of LOCALES) {
      const text = visible(renderProof({ ...VIEW, locale })).toLowerCase();
      for (const banned of BANNED_OWNER_TERMS) {
        const needle = banned.toLowerCase();
        const hit = /^[a-z ]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(text)
          : text.includes(needle);
        expect(hit, `${locale}: "${banned}"`).toBe(false);
      }
    }
  });

  it('every proof string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'proof.title', 'proof.quote.title', 'proof.fact.quantity', 'proof.fact.unitPrice',
      'proof.fact.total', 'proof.fact.tier', 'proof.fact.moq', 'proof.fact.leadTime',
      'proof.tier.from', 'proof.tier.band', 'proof.days', 'proof.certs.title',
      'proof.taught.title', 'proof.source.catalogue', 'proof.source.taught',
      'proof.source.authorised', 'proof.footer.explain', 'proof.footer.issued',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { seller: 'X', min: '1', max: '2', unit: 'pcs', n: 3, date: '2026-08-12' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(0);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});

/* ── security ────────────────────────────────────────────────────────────── */

describe('M35 · the link is the only credential, so it must be unguessable', () => {
  it('tokens are 32 bytes of randomness, url-safe, and never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const tk = mintToken();
      expect(tk).toMatch(/^[A-Za-z0-9_-]{43}$/);   // 32 bytes base64url
      expect(seen.has(tk)).toBe(false);
      seen.add(tk);
    }
  });

  it('the not-found page reveals nothing — not even that a link once existed', () => {
    const html = visible(notFoundPage()).toLowerCase();
    for (const word of ['revoked', 'expired', 'quote', 'factory', 'owner', 'permission', 'forbidden']) {
      expect(html.includes(word), `"${word}" is an oracle`).toBe(false);
    }
  });

  it('the route answers 404 and never 403', async () => {
    const src = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf("app.get('/p/:token'"), src.indexOf('// ── Auth'));
    expect(handler).toContain('reply.code(404)');
    expect(handler, 'a 403 confirms the quote exists').not.toContain('403');
  });

  it('a revoked link is resolved by the same query as one that never existed', async () => {
    const sqlText = await readFile(new URL('../../migrations/0028_quote_proofs.sql', import.meta.url), 'utf8');
    const fn = sqlText.slice(sqlText.indexOf('create or replace function resolve_quote_proof'));
    expect(fn).toContain('revoked_at is null');
    expect(fn).toContain('security definer');
    // It returns routing only — no quote data can leak through the bootstrap.
    expect(fn).toContain('returns table (business_id uuid, quote_id uuid, conversation_id uuid)');
  });
});
