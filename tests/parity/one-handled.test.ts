import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { renderPrivacy } from '../../src/api/web/legal.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * THE ADVISOR BATCH (2026-10-06), the fixes the owner ordered with it:
 *   3. "the advisor uses Home's meaning (readHandled). AND fix Results to use the same definition in THIS
 *      batch — Home and Results disagreeing in production is a bug, not a later change. One definition,
 *      both pages."
 *   4. "fix Home and Results to also exclude practice and owner_testing conversations in this batch —
 *      same reason: the advisor shouldn't be the only honest page."
 *   PRIVACY. "the privacy page must state that to phrase an answer, the question and its query result —
 *      customer names, amounts, dates — are sent to the same model provider the assistant uses (DeepSeek)."
 */

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const sources = (dir: string): { f: string; src: string }[] => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const p = join(dir, n);
  return statSync(join(ROOT, p)).isDirectory() ? sources(p) : p.endsWith('.ts') ? [{ f: p, src: read(p) }] : [];
});
/** The SQL subqueries of one query, each from its `(select` to the matching `)`. */
const subqueries = (sqlText: string): string[] => {
  const out: string[] = [];
  for (let at = sqlText.indexOf('(select '); at >= 0; at = sqlText.indexOf('(select ', at + 1)) {
    let depth = 0; let j = at;
    for (; j < sqlText.length; j++) { if (sqlText[j] === '(') depth++; else if (sqlText[j] === ')' && --depth === 0) break; }
    out.push(sqlText.slice(at, j + 1));
  }
  return out;
};

describe('the advisor batch · "handled" is ONE definition, on every page', () => {
  it('it lives in src/db/handled.ts, and nowhere else counts it', () => {
    const defs = sources('src').filter(({ src }) => /async function (readHandled|handledCount)\b/.test(src)).map(({ f }) => relative(ROOT, join(ROOT, f)));
    expect(defs).toEqual(['src/db/handled.ts']);
    // Results counted drafts approved or edited; that reading is gone from every page
    for (const { f, src } of sources('src/api')) {
      expect(src.includes("status in ('approved','edited') and decided_at >= ${cutoff}) as handled"), f).toBe(false);
    }
  });

  it('Home, Results and the assistant\'s month read it', () => {
    expect(read('src/api/web/today.ts')).toContain("from '../../db/handled.js'");
    expect(read('src/api/web/today.ts')).toMatch(/await readHandled\(tx, B, start\)/);
    const results = read('src/api/web/analytics.ts');
    expect(results).toContain('const handled = await handledCount(tx, bid.value, cutoff);');
    expect(results).toMatch(/employee: \{\n\s+handled, waiting/);
    expect(read('src/api/web/operations.ts')).toContain('handled: await handledCount(tx, B, cutoff)');
  });

  it('Results says it in Home\'s words, in every language: conversations — never replies sent from drafts', () => {
    for (const l of LOCALES) {
      for (const f of ['zero', 'one', 'two', 'few', 'many', 'other']) {
        const v = (messages[l] as Record<string, string>)[`analytics.n.handled.${f}`]!;
        expect(v, `${l} ${f}`).toBeTruthy();
        expect(v, `${l} ${f}`).not.toMatch(/draft|起草|صياغة|que enviaste|envoyée? par vous/);
      }
    }
    expect(messages.en['analytics.n.handled.other']).toBe('conversations {name} handled');
  });
});

describe('the advisor batch · nothing that is not business counts, on Home or Results', () => {
  it('every query of the shared figures leaves out the owner\'s own test conversations', () => {
    const shared = read('src/db/handled.ts');
    for (const fn of ['lastWinDay', 'readHandled', 'handledCount']) {
      const body = shared.slice(shared.indexOf(`export async function ${fn}`), shared.indexOf('\n}\n', shared.indexOf(`export async function ${fn}`)));
      expect(body, fn).toContain("notOwnerTesting('o.conversation_id')");
    }
    const tally = shared.slice(shared.indexOf('export async function readTally'));
    expect(subqueries(tally).filter((q) => q.startsWith('(select count'))).toHaveLength(3);
    for (const q of subqueries(tally).filter((x) => x.startsWith('(select count'))) expect(q).toMatch(/notOwnerTesting\('[a-z]\.conversation_id'\)/);
  });

  it('every figure on Results does too — each count, the deals, the totals, the answer paths — and the customers in touch', () => {
    const src = read('src/api/web/analytics.ts');
    const load = src.slice(src.indexOf('export async function loadAnalytics'), src.indexOf('/** ── Renderer'));
    const counts = subqueries(load).filter((q) => q.startsWith('(select count(*)::int from') && !q.includes('from talked'));
    // quotes, orders, inbound, replied, waiting, edits (handled is the shared count, above)
    expect(counts).toHaveLength(6);
    for (const q of counts) expect(q, q.slice(0, 80)).toMatch(/\$\{testing\('[a-z]\.conversation_id'\)\}/);
    expect(load).toContain('and cv.client_id is not null and not cv.owner_testing');
    expect(load.match(/from orders o where[\s\S]*?\$\{testing\('o\.conversation_id'\)\}/g)?.length).toBeGreaterThanOrEqual(3);
    expect(load).toMatch(/from turns t[\s\S]*?\$\{testing\('t\.conversation_id'\)\}/);
  });

  it('a practice copy is a business row of its own: no figure needs to name it, row security keeps it out', () => {
    expect(read('src/db/practice.ts')).toContain('practice_of');
    expect(read('src/db/handled.ts')).toContain('row security keeps its conversations out');
  });
});

describe('the advisor batch · the privacy page says where the advisor\'s answers are phrased, before it goes live', () => {
  for (const l of LOCALES) {
    it(`${l} · the same provider the assistant uses, named; the question and the records that answer it; the date moved`, () => {
      const html = renderPrivacy(l, 'privacy@example.test', { processor: { name: 'DeepSeek', country: 'CN' }, hosting: { name: 'Railway', country: 'US' } });
      const items = [...html.matchAll(/<li>([^<]*?)<\/li>/g)].map((m) => m[1]!);
      // the provider as the page names it (with its country), first for drafting, then — the next line — for the advisor
      const named = items.map((x, i) => [x, i] as const).filter(([x]) => x.startsWith('DeepSeek'));
      expect(named.map(([, i]) => i), l).toHaveLength(2);
      const [ai, advisor] = named.map(([, i]) => i) as [number, number];
      expect(advisor, l).toBe(ai + 1);
      expect(items[ai], l).toContain(esc(t(l, 'legal.privacy.who.ai', { processor: '@@' })).split('@@')[1]!.slice(0, 10));
      expect(items[advisor], l).toContain(({ en: 'advisor', zh: '顾问', ar: 'مستشار', es: 'Asesoría', fr: 'Conseil' } as const)[l]);
      expect(html, l).toContain(esc(t(l, 'legal.updated.privacy')));
      // the day the page changed, whole (a bare 6 would be found in 2026)
      expect(t(l, 'legal.updated.privacy').replace(/[\u2066-\u2069]/g, ''), l).toContain(({ en: '6 October 2026', zh: '2026 年 10 月 6 日', ar: '6 أكتوبر 2026', es: '6 de octubre de 2026', fr: '6 octobre 2026' } as const)[l]);
    });
  }

  it('it names what goes: the question, and customers\' names, amounts and dates — in every language', () => {
    const WORDS = {
      en: ['question', 'names', 'amounts', 'dates'], zh: ['问题', '姓名', '金额', '日期'], ar: ['السؤال', 'أسماء', 'المبالغ', 'التواريخ'],
      es: ['pregunta', 'nombres', 'importes', 'fechas'], fr: ['question', 'noms', 'montants', 'dates'],
    } as const;
    for (const l of LOCALES) for (const w of WORDS[l]) expect(messages[l]['legal.privacy.who.advisor'], `${l}: ${w}`).toContain(w);
  });
});
