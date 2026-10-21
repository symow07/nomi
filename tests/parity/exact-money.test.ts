import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A1 (Phase 5) — NO FLOATING POINT TOUCHES A MONEY VALUE IN `src`. The types do most of it: an amount is a `Decimal`
 * (text), so `a.amount * 2` does not compile. What the types cannot see, this scan does:
 *
 *   · arithmetic or ordering on `.amount` — `<` on two Decimals COMPILES and compares them as text ("10" < "9"); the
 *     first run of this scan found exactly that on the price-limits page (A1.5, 2026-10-22);
 *   · `Number(…)`, `Math.…(…)`, `toFixed` on an amount, and `Number(…)` of a stored price, total, floor, sum or rate
 *     column — the road the defect took (docs/PHASE-5.md §2.1);
 *   · `parseFloat` anywhere.
 *
 * Exact arithmetic lives in src/core/types/decimal.ts and src/core/types/money.ts, and leaves them only by name:
 * `numeralOf` / `numeralOfDecimal` (a figure to MATCH in text) and `percentNumber` (a percentage, as the rules hold it).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HOME = new Set(['src/core/types/money.ts', 'src/core/types/decimal.ts']);

/**
 * Allowed, each with its reason. A line is matched by file and by its own text, so a new hit in the same file is not
 * excused by an old one.
 */
const ALLOWED: readonly { readonly file: string; readonly text: string; readonly why: string }[] = [
  { file: 'src/db/providerState.ts', text: 'total: Number(r.total)',
    why: "the operator's own model-provider balance (the DeepSeek account), read for the days-left estimate of an alert: not a shop's money, never shown to a buyer, never in the books" },
  { file: 'src/core/ops/providerWatch.ts', text: 'Math.max(0, line.total / perDay)',
    why: 'the same balance: days left at the current spend, an estimate for the operator\'s alert' },
];

const RULES: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: 'arithmetic or ordering after .amount', re: /\.amount\b\s*(?:[-+*/%](?![-+=>])|[<>]=?)/ },
  { name: 'arithmetic or ordering before .amount', re: /(?<![=\-])(?:[-+*/%]|[<>]=?)\s*[\w.!?()[\]]*\.amount\b/ },
  { name: 'Number() of an amount', re: /\bNumber\([^)]*\.amount\b/ },
  { name: 'Math on an amount', re: /\bMath\.\w+\([^)]*\.amount\b/ },
  { name: 'Math on a money column', re: /\bMath\.\w+\([^)]*\b\w+\.(?:sum|total|\w*price\w*|\w+_usd|amount|spent)\b/ },
  { name: 'toFixed on an amount', re: /\.amount\.(?:toFixed|toPrecision|toLocaleString)\b/ },
  { name: 'parseFloat', re: /\bparseFloat\(/ },
  { name: 'Number() of a money column',
    re: /\bNumber\(\s*[\w!?]*\.(?:\w*price\w*|\w*total\w*|\w+_usd|floor\w*|spent|val|sum|amount|rate|expected|quoted)\s*\)/ },
  { name: 'Number() of a decimal result', re: /\bNumber\(\s*(?:roundDecimal|divDecimal|mulDecimal|addDecimal|subDecimal|ceilDecimal)\(/ },
];

/** Comments out, line breaks kept (so a hit names its real line). */
function code(text: string): string[] {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlocks.split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function scan(file: string, text: string): string[] {
  const hits: string[] = [];
  code(text).forEach((line, i) => {
    for (const r of RULES) {
      if (!r.re.test(line)) continue;
      if (ALLOWED.some((a) => a.file === file && line.includes(a.text))) continue;
      hits.push(`${file}:${i + 1} — ${r.name}: ${line.trim()}`);
    }
  });
  return hits;
}

describe('A1 · no floating point touches money in src', () => {
  it('the scan of every source file finds nothing outside money.ts and decimal.ts', () => {
    const hits = filesUnder(join(ROOT, 'src'))
      .map((p) => relative(ROOT, p).split('\\').join('/'))
      .filter((f) => !HOME.has(f))
      .flatMap((f) => scan(f, readFileSync(join(ROOT, f), 'utf8')));
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('every allowance still names a real line — a fixed one is removed, not kept as a blank cheque', () => {
    for (const a of ALLOWED) expect(readFileSync(join(ROOT, a.file), 'utf8'), a.file).toContain(a.text);
  });

  it('THE SCAN CAN FAIL: the lines A1 replaced are each caught', () => {
    // From the build before A1 (main at 14d0891a), and the one A1.2 introduced that this scan found.
    const before = [
      "    amount: (inputTokens * p.input.amount + outputTokens * p.output.amount) / 1_000_000,",
      "    const total: Money = { amount: Math.round(unitPrice.amount * input.quantity * 100) / 100, currency: unitPrice.currency };",
      "    const unitPrice = moneyFromRow(Number(r.unit_price_usd), r.currency);",
      "  }).sort((a, b) => (b.spent?.amount ?? 0) - (a.spent?.amount ?? 0)",
      "      const avg = moneyOr(ctx, Math.round((r.sum / r.n) * 100) / 100, r.currency);",
      "    const price = Number(n.toFixed(4));",
      "    && (p.listPrice.currency !== v.businessDefault.floor.currency || p.listPrice.amount < v.businessDefault.floor.amount);",
      "      maxDiscountPct: Number(roundDecimal(max as Decimal, 2)),",
      "  const n = parseFloat(raw);",
    ];
    const caught = before.filter((l) => scan('src/fixture.ts', l).length > 0);
    // `Number(n.toFixed(4))` is the one the types catch instead: `n` is a Decimal, with no toFixed.
    expect(before.length - caught.length).toBe(1);
    expect(caught).not.toContain("    const price = Number(n.toFixed(4));");
  });

  it('and an allowance excuses only its own line', () => {
    expect(scan('src/db/providerState.ts', '  return rows.map((r) => ({ total: Number(r.total) }));')).toEqual([]);
    expect(scan('src/db/providerState.ts', '  const x = Number(r.unit_price_usd);')).toHaveLength(1);
    expect(scan('src/db/other.ts', '  return rows.map((r) => ({ total: Number(r.total) }));')).toHaveLength(1);
  });
});
