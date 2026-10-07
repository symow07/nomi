import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { renderAdvisor, advisorRoutes, ADVISOR_MAX, type AdvisorIO } from '../../src/api/web/advisor.js';
import type { AdvisorAnswer } from '../../src/advisor/answer.js';
import { CATALOGUE, entryOf } from '../../src/advisor/catalogue.js';
import { READS } from '../../src/advisor/reads.js';
import { checkPhrasing, type CheckInput } from '../../src/advisor/check.js';
import type { AdvisorModel } from '../../src/llm/ports.js';
import type { Db } from '../../src/db/client.js';
import { NAV, esc } from '../../src/api/web/layout.js';
import { t } from '../../src/api/web/say.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * THE ADVISOR BATCH (2026-10-06; docs/ADVISOR-GROUNDING.md, approved). The owner:
 *   "Hard rule, enforced by test: every factual answer comes from a read-only query in src/advisor/reads.ts;
 *   the model only phrases it; missing data returns its fixed sentence and NEVER a figure. Keep the wall —
 *   reads.ts only, each in its own read-only tenant transaction, no sender/queue/setting/pipeline reachable."
 * This file holds the code's side of it; tests/integration/advisor-build.test.ts holds the database's.
 */

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

/** The VALUE imports a module reaches, transitively (a type-only import is erased); `stop` is not descended. */
function reached(entry: string, stop: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const stack = [resolve(ROOT, entry)];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (stop.includes(relative(ROOT, f))) continue;
    const src = readFileSync(f, 'utf8');
    const specs = [
      ...[...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'";]*?from\s*['"](\.[^'"]+)['"]/gm)].map((m) => m[1]!),
      ...[...src.matchAll(/^\s*import\s+['"](\.[^'"]+)['"]/gm)].map((m) => m[1]!),
      ...[...src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((m) => m[1]!),
    ];
    for (const s of specs) {
      const ts = resolve(dirname(f), s).replace(/\.js$/, '.ts');
      if (existsSync(ts)) stack.push(ts);
    }
  }
  return [...seen].map((f) => relative(ROOT, f)).sort();
}

/** What the advisor may never reach: sending, the queue, the worker, a model, the pipeline, pricing, and the pages that save. */
const FORBIDDEN = /^src\/(pipeline|outbound|channels|connectors|queue|worker|llm|conversations|prospects|billing|trust|core\/pricing)\/|^src\/api\/web\/(app|settings|employee|factory|operations|inbox|today|pilot|products|insights|orders|business|sandbox|onboarding)\.ts$/;

/** Every name reads.ts imports as a value, as `module: name` (a namespace import is `module: * as name`). */
function valueImports(file: string): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s+'([^']+)';/gms)) {
    const [, what, from] = m as unknown as [string, string, string];
    const ns = /^\*\s+as\s+(\w+)$/.exec(what.trim());
    if (ns) { out.push(`${from}: * as ${ns[1]}`); continue; }
    const names = /\{([^}]*)\}/.exec(what)?.[1] ?? '';
    for (const n of names.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!n.startsWith('type ')) out.push(`${from}: ${n}`);
    }
  }
  return out.sort();
}

/** A function's name that says it changes something: the verb, then the next word ("stopAssistant", "stampRungs"). */
const WRITER = /^(save|insert|update|delete|set|stop|start|stamp|clear|record|write|mark|create|enqueue|send|upsert|erase|archive|apply|commit|hand|keep|spend|claim|resolve|release|promote|demote|queue|notify|deliver|schedule|close|cancel|reset|grant|revoke|add|remove|toggle|turn|enable|disable)(?=[A-Z]|$)/;
/** SQL that changes something, or reopens a transaction for writing. */
const WRITE_SQL = /\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|\btruncate\b|\bmerge\s+into\b|\b(alter|drop|create)\s+(table|index|function|role|policy|view)\b|\bgrant\b|\bnextval\b|\bsetval\b|\bfor\s+(no\s+key\s+)?update\b|\block\s+table\b|\bnotify\b|\bread\s+write\b|default_transaction_read_only|pg_advisory/i;

describe('the wall · the advisor reaches no send, queue, model, pipeline or setting, and the database only through reads.ts', () => {
  it('the check can fail: the assistant\'s settings module reaches the pipeline and a writer (the control)', () => {
    const control = reached('src/api/web/employee.ts');
    expect(control.filter((f) => FORBIDDEN.test(f)).length).toBeGreaterThan(0);
  });

  it('its whole import graph reaches nothing that sends, queues, calls a model, prices or saves', () => {
    const graph = reached('src/api/web/advisor.ts');
    expect(graph).toContain('src/advisor/reads.ts');
    expect(graph.filter((f) => FORBIDDEN.test(f))).toEqual([]);
  });

  it('the database is reached only through src/advisor/reads.ts: everything else of the advisor reaches none of it', () => {
    const outside = reached('src/api/web/advisor.ts', ['src/advisor/reads.ts']);
    expect(outside).toContain('src/advisor/answer.ts');
    expect(outside).toContain('src/advisor/check.ts');
    expect(outside.filter((f) => f.startsWith('src/db/') || /^src\/api\/web\/(analytics|calendar|knowledge-insights)\.ts$/.test(f))).toEqual([]);
    // and the model is never imported: it is handed in (AdvisorIO), typed only
    for (const f of ['src/api/web/advisor.ts', 'src/advisor/answer.ts', 'src/advisor/reads.ts', 'src/advisor/check.ts', 'src/advisor/catalogue.ts']) {
      expect(read(f), f).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+'[^']*\/llm\//m);
    }
  });

  it('reads.ts imports read functions only — this exact list; a new one is a decision, made here', () => {
    expect(valueImports('src/advisor/reads.ts')).toEqual([
      '../api/web/analytics.js: loadAnalytics',
      '../api/web/calendar.js: isDone',
      '../api/web/knowledge-insights.js: loadKnowledgeOps',
      '../api/web/say.js: assistantName',
      '../api/web/say.js: t',
      '../api/web/values.js: * as show',
      '../core/conversation/aloneNow.js: aloneNow',
      '../core/conversation/autonomyLevel.js: levelOf',
      '../core/conversation/disclosure.js: autonomyReleased',
      '../core/owner/i18n/format.js: addDays',
      '../core/owner/i18n/format.js: dayKey',
      '../core/owner/i18n/messages.js: messages',
      '../core/owner/i18n/messages.js: orderStatusName',
      '../core/scoring/signals.js: PROBLEM_SIGNAL_KINDS',
      '../core/types/money.js: moneyFromRow',
      '../db/assistantStop.js: assistantHold',
      '../db/assistantStop.js: assistantStopped',
      '../db/buyersList.js: DELETION_WAITING',
      '../db/buyersList.js: IS_BLOCKED',
      '../db/buyersList.js: needsOwnerFor',
      '../db/calendar.js: loadCalendar',
      '../db/client.js: withTenantTx',
      '../db/currency.js: ratePairOf',
      '../db/customerCard.js: loadCustomerCard',
      '../db/customerValue.js: SPEND_STATUSES',
      '../db/customerValue.js: customerValues',
      '../db/handled.js: handledCount',
      '../db/handled.js: notOwnerTesting',
      '../db/inboxAttention.js: readAttention',
      '../db/opsFlags.js: loadKillSwitches',
      '../db/ramp.js: rampState',
      '../db/zone.js: zoneOf',
      'kysely: sql',
    ]);
  });

  it('none of those names changes anything — and the name check can fail (the same modules export writers)', () => {
    // what comes from the database and page modules (src/core is pure: the boundaries check keeps I/O out of it)
    const names = valueImports('src/advisor/reads.ts').filter((x) => /^\.\.\/(db|api)\//.test(x)).map((x) => x.split(': ')[1]!);
    expect(names.length).toBeGreaterThan(15);
    expect(names.filter((n) => WRITER.test(n))).toEqual([]);
    // the control: assistantStop.ts and ramp.ts, both imported, also export what writes — never imported
    const exported = (f: string) => [...read(f).matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((m) => m[1]!);
    expect(exported('src/db/assistantStop.ts').filter((n) => WRITER.test(n)).length).toBeGreaterThan(0);
    expect(exported('src/db/ramp.ts').filter((n) => WRITER.test(n)).length).toBeGreaterThan(0);
  });

  it('no SQL in the advisor writes, locks or reopens a transaction for writing — and the scan can fail (the rate page inserts)', () => {
    expect(read('src/api/web/settings.ts')).toMatch(WRITE_SQL);
    for (const f of readdirSync(join(ROOT, 'src/advisor'))) {
      // 0130 — the one exception, held below: the memory writes the advisor's own history, and nothing else.
      if (f === 'memory.ts') continue;
      expect(read(`src/advisor/${f}`).replace(/^\s*(\/\/|\*).*$/gm, ''), f).not.toMatch(WRITE_SQL);
    }
    expect(read('src/api/web/advisor.ts')).not.toMatch(/\bsql`|withTenantTx|\bdeps\b|createDb/);
  });

  it('0130 · the memory writes only the advisor\'s own history — its four tables and its own functions — and the page holds it as a type', () => {
    const src = read('src/advisor/memory.ts').replace(/^\s*(\/\/|\*).*$/gm, '');
    const writes = [...src.matchAll(/\b(insert\s+into\s+\w+|update\s+\w+\s+set|delete\s+from\s+\w+)/gi)].map((m) => m[1]!.replace(/\s+/g, ' ').toLowerCase());
    expect(writes.length).toBeGreaterThan(4);
    for (const w of writes) expect(w, w).toMatch(/^(insert into|update|delete from) advisor_(consents|threads|turns|turn_subjects)\b/);
    expect(src).not.toMatch(/\bdelete\s+from\b/i);                          // deleting is the database's own functions'
    const functions = [...new Set([...src.matchAll(/select (advisor_\w+)\(/g)].map((m) => m[1]!))].sort();
    expect(functions).toEqual(['advisor_forget', 'advisor_history_set']);
    // the advisor's page never holds a pool or the memory's code: a type, and the port app.ts hands it
    expect(read('src/api/web/advisor.ts')).toMatch(/^import type \{[^}]*AdvisorMemory[^}]*\} from '\.\.\/\.\.\/advisor\/memory\.js';$/m);
    expect(reached('src/api/web/advisor.ts')).not.toContain('src/advisor/memory.ts');
  });

  it('each read runs in a tenant transaction opened `read only`, on the advisor\'s own pool — or in a page loader handed that pool', () => {
    const src = read('src/advisor/reads.ts');
    // the one place a transaction is opened, and the first thing it does
    expect(src.match(/withTenantTx\(/g)).toHaveLength(1);
    expect(src).toMatch(/return withTenantTx\(ctx\.db, ctx\.businessId, async \(tx\) => \{\s+await sql`set transaction read only`\.execute\(tx\);/);
    // the pool is used only there, and by three of the product's page loaders (each opens its own tenant transaction on it)
    expect([...new Set([...src.matchAll(/(\w+)\(ctx\.db\b/g)].map((m) => m[1]))].sort())
      .toEqual(['loadAnalytics', 'loadCalendar', 'loadKnowledgeOps', 'withTenantTx']);
    // the pool: read-only at the server, for every transaction it opens
    const client = read('src/db/client.ts');
    const pool = client.slice(client.indexOf('export function createReadOnlyDb'), client.indexOf('export function createReadOnlyDb') + 600);
    expect(pool).toContain('-c default_transaction_read_only=on');
    const main = read('src/main.ts');
    expect(main).toContain('const advisorDb = createReadOnlyDb(cfg.DATABASE_URL);');
    expect(main).toMatch(/\n\s+advisorDb,\n\s+advisorModel,\n/);
  });

  it('these routes, and only these; app.ts hands them who asks, the language, the shell, the read-only pool, the model — and (0130) the memory\'s port and the notice', () => {
    const routes: string[] = [];
    const fake = { get: (p: string) => { routes.push(`GET ${p}`); }, post: (p: string) => { routes.push(`POST ${p}`); } };
    advisorRoutes(fake as unknown as FastifyInstance, { viewer: () => null, locale: () => 'en', page: (_r, o) => o.bodyHtml, db: null, model: null,
      memory: null, processor: () => 'DeepSeek', provider: null, flashTo: (reply) => reply, takeFlash: () => null });
    // 0130 — a kept conversation opened; the card's answer; one conversation deleted.
    // the redesign — earlier conversations on a page of their own.
    expect(routes).toEqual(['GET /app/advisor', 'GET /app/advisor/earlier', 'GET /app/advisor/c/:id', 'POST /app/advisor', 'POST /app/advisor/consent', 'POST /app/advisor/c/:id/delete']);
    const app = read('src/api/web/app.ts');
    const at = app.indexOf('advisorRoutes(app, {');
    const call = app.slice(at, app.indexOf('\n  });', at) + 5);
    expect([...call.matchAll(/^ {4}([a-zA-Z]+): /gm)].map((m) => m[1]))
      .toEqual(['viewer', 'locale', 'page', 'db', 'model', 'memory', 'processor', 'provider', 'flashTo', 'takeFlash']);
    expect(call).toContain('db: deps.advisorDb ?? null,');
    expect(call).toContain('model: deps.advisorModel ?? null,');
    expect(call).not.toMatch(/deps\.db\b|send|enqueue|save|price|boss/i);
    // nothing else in the app answers at the advisor's address
    expect(app.match(/['"`]\/app\/advisor/g) ?? []).toEqual([]);
  });
});

describe('the catalogue · every question has a read or a fixed sentence; opinions stand only on facts', () => {
  const kinds = (k: string) => CATALOGUE.filter((e) => e.kind === k).map((e) => e.id);

  it('the approved shape: 37 grounded and 3 split (built as grounded), 8 new, 2 metrics, 9 not stored, 7 opinions — 66 entries, 50 reads', () => {
    expect(new Set(CATALOGUE.map((e) => e.id)).size).toBe(CATALOGUE.length);
    expect(kinds('grounded')).toHaveLength(40);
    expect(kinds('new')).toHaveLength(8);
    expect(kinds('metric')).toEqual(['B8', 'D8']);
    expect(kinds('notStored')).toEqual(['A9', 'B6', 'C5', 'D6', 'D9', 'D10', 'F5', 'F6', 'H2n']);
    expect(kinds('opinion')).toEqual(['G9', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6']);
    expect(Object.keys(READS)).toHaveLength(50);
    expect(Object.keys(READS).sort()).toEqual([...kinds('grounded'), ...kinds('new'), ...kinds('metric')].sort());
  });

  it('a fact is a read; a "not stored" and an opinion never run one of their own', () => {
    for (const e of CATALOGUE) {
      if (e.kind === 'notStored') {
        expect(READS[e.id], e.id).toBeUndefined();
        expect(e.says, e.id).toMatch(/^advisor\.notStored\./);
      } else if (e.kind === 'opinion') {
        expect(READS[e.id], e.id).toBeUndefined();
      } else {
        expect(typeof READS[e.id], e.id).toBe('function');
        expect(e.says, e.id).toBeUndefined();
      }
    }
  });

  it('the conversion / win rate stays "Nomi doesn\'t calculate that" — the owner\'s NO', () => {
    expect(entryOf('D6')).toMatchObject({ kind: 'notStored', says: 'advisor.notStored.winRate' });
    expect(t('en', 'advisor.notStored.winRate')).toMatch(/^Nomi doesn't calculate that\./);
  });

  it('an opinion cites only facts — entries with a read — and the one with nothing to stand on says so', () => {
    for (const e of CATALOGUE.filter((x) => x.kind === 'opinion')) {
      for (const c of e.cites ?? []) {
        expect(READS[c], `${e.id} cites ${c}`).toBeDefined();
        expect(['grounded', 'new', 'metric'], `${e.id} cites ${c}`).toContain(entryOf(c)?.kind);
        for (const l of LOCALES) expect(messages[l][`advisor.title.${c}` as MessageKey], `${l} advisor.title.${c}`).toBeTruthy();
      }
      expect((e.cites ?? []).length > 0 || e.says !== undefined, e.id).toBe(true);
    }
    expect(entryOf('I6')).toMatchObject({ cites: [], says: 'advisor.opinion.competitors' });
  });

  it('missing data is a fixed sentence and NEVER a figure: no digit, numeral or number word in any of them, in any language', () => {
    const fixed = Object.keys(messages.en).filter((k) => /^advisor\.(none|notStored|opinion|unknown|failed|unavailable|hello)/.test(k)) as MessageKey[];
    expect(fixed.length).toBeGreaterThan(60);
    const words: Partial<Record<Locale, RegExp>> = {
      en: /\b(one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|thousand)\b/i,
      es: /\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|cien|mil)\b/i,
      fr: /\b(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|cent|mille)\b/i,
      zh: /[二三四五六七八九十百千万亿两]/,
      ar: /(?:^|\s)(اثنان|ثلاثة|ثلاث|أربعة|خمسة|ستة|سبعة|ثمانية|تسعة|عشرة|مئة|ألف)(?:\s|$)/,
    };
    for (const l of LOCALES) {
      for (const k of fixed) {
        const s = messages[l][k];
        expect(s, `${l} ${k}`).toBeTruthy();
        expect(s, `${l} ${k}`).not.toMatch(/[0-9٠-٩۰-۹]/);
        expect(s, `${l} ${k}`).not.toMatch(words[l]!);
      }
    }
  });

  it('every advisor sentence exists in all five languages, and none calls anything "AI" or gives the advisor or the assistant a pronoun', () => {
    const keys = Object.keys(messages.en).filter((k) => k.startsWith('advisor.')) as MessageKey[];
    expect(keys.length).toBeGreaterThan(200);
    for (const l of LOCALES) for (const k of keys) expect(messages[l][k], `${l} ${k}`).toBeTruthy();
    for (const k of keys) expect(messages.en[k], k).not.toMatch(/\bAI\b|\b(she|her|he|his|it's)\b/);
  });
});

describe('rule 4 · the model\'s sentence is checked against the facts it was given', () => {
  const base = (o: Partial<CheckInput> = {}): CheckInput => ({
    facts: ['This month, since Oct 1', 'Confirmed orders: 3', 'Confirmed sales: US$1,250.00'],
    names: ['Acme Trading'], known: ['Acme Trading', 'Blue Harbor Textiles', 'Canvas tote'], locale: 'en', ...o,
  });

  it('a faithful sentence passes', () => {
    expect(checkPhrasing('Since Oct 1 you confirmed 3 orders, worth US$1,250.00, including Acme Trading.', base())).toEqual({ ok: true });
  });
  it('a figure the facts do not carry is thrown away', () => {
    expect(checkPhrasing('You confirmed 4 orders worth US$1,250.00.', base()).ok).toBe(false);
    expect(checkPhrasing('You confirmed 3 orders worth US$1,350.00.', base()).ok).toBe(false);
  });
  it('a percentage, ever', () => {
    expect(checkPhrasing('Sales are 3% of US$1,250.00.', base()).ok).toBe(false);
    expect(checkPhrasing('That is three per cent.', base()).ok).toBe(false);
  });
  it('a number written as a word, or a numeral the facts do not say', () => {
    expect(checkPhrasing('You confirmed three orders.', base()).ok).toBe(false);
    expect(checkPhrasing('你确认了三个订单。', base({ facts: ['已确认订单：3'], locale: 'zh' })).ok).toBe(false);
    expect(checkPhrasing('你确认了3个订单。', base({ facts: ['已确认订单：3'], locale: 'zh' }))).toEqual({ ok: true });
    expect(checkPhrasing('تم تأكيد ثلاثة طلبات.', base({ facts: ['الطلبات المؤكَّدة: ٣'], locale: 'ar' })).ok).toBe(false);
  });
  it('digits in any script are the same figure; a different one is not', () => {
    expect(checkPhrasing('الطلبات: 3', base({ facts: ['الطلبات المؤكَّدة: ٣'], locale: 'ar' }))).toEqual({ ok: true });
    expect(checkPhrasing('الطلبات: ٤', base({ facts: ['الطلبات المؤكَّدة: ٣'], locale: 'ar' })).ok).toBe(false);
  });
  it('a month, a currency or a customer\'s name the facts do not carry', () => {
    expect(checkPhrasing('Sales since September were US$1,250.00.', base()).ok).toBe(false);
    expect(checkPhrasing('Sales were €1,250.00.', base()).ok).toBe(false);
    expect(checkPhrasing('Blue Harbor Textiles ordered 3 times.', base()).ok).toBe(false);
  });
  it('nobody gendered (rule 6): a customer is their name, repeated — never he or she, in any language', () => {
    expect(checkPhrasing('Acme Trading confirmed 3 orders; she spent US$1,250.00.', base()).ok).toBe(false);
    expect(checkPhrasing('Write to Acme Trading first: his last order was 3.', base()).ok).toBe(false);
    expect(checkPhrasing('先跟进Acme Trading，她已确认3个订单。', base({ locale: 'zh' })).ok).toBe(false);
    expect(checkPhrasing('Escribe primero a Acme Trading: ella confirmó 3 pedidos.', base({ locale: 'es' })).ok).toBe(false);
    expect(checkPhrasing('Relancez Acme Trading : elle a confirmé 3 commandes.', base({ locale: 'fr' })).ok).toBe(false);
    expect(checkPhrasing('الأولى بالمتابعة هي Acme Trading.', base({ locale: 'ar', facts: ['Acme Trading'] })).ok).toBe(false);
    expect(checkPhrasing('أما Acme Trading فهو عميل دائم.', base({ locale: 'ar', facts: ['Acme Trading'] })).ok).toBe(false);
    // and nothing of the instructions reaches the owner
    expect(checkPhrasing('Acme Trading confirmed 3 orders; the FACTS say nothing else.', base()).ok).toBe(false);
    // the Arabic copula about a figure, where no one is named, is no one's gender (strict where a customer is:
    // a false alarm costs a plainer answer, never a wrong one); French "il y a" is no one's either
    expect(checkPhrasing('عدد الطلبات هو 3.', base({ locale: 'ar', names: [] }))).toEqual({ ok: true });
    expect(checkPhrasing('عدد الطلبات هو 3.', base({ locale: 'ar' })).ok).toBe(false);
    expect(checkPhrasing('Il y a 3 commandes confirmées.', base({ locale: 'fr' }))).toEqual({ ok: true });
    expect(checkPhrasing('Write to Acme Trading first: 3 orders, US$1,250.00.', base())).toEqual({ ok: true });
  });

  it('reply times: the median, the replies measured and the messages still unanswered — together, or not at all', () => {
    const b8 = base({
      facts: ['This week, since Oct 5', 'Median time to reply: 2 hours, 5 minutes', 'Replies measured: 14', 'Customer messages in the period still unanswered: 6'],
      names: [], must: ['2 hours, 5 minutes', '14', '6'],
    });
    expect(checkPhrasing('This week the median reply took 2 hours, 5 minutes over 14 replies; 6 messages are still unanswered.', b8)).toEqual({ ok: true });
    expect(checkPhrasing('This week the median reply took 2 hours, 5 minutes over 14 replies.', b8).ok).toBe(false);
    expect(checkPhrasing('6 messages are still unanswered.', b8).ok).toBe(false);
  });
});

describe('the page · a fact, a fixed sentence, advice under its label, and the page that shows the same thing', () => {
  const fact = (o: Partial<Extract<AdvisorAnswer, { kind: 'fact' }>> = {}): AdvisorAnswer =>
    ({ kind: 'fact', text: 'You have 12 customers.', lines: ['Customers: 12'], phrased: true, door: { href: '/app/inbox', label: 'nav.inbox' }, ...o });

  for (const l of LOCALES) {
    it(`${l} · at rest (the redesign): the greeting, one box, one button — no intro, no list, no door, link or form to anywhere else`, () => {
      const html = renderAdvisor(l);
      // the page's name is for a screen reader; the eye sees the orb and the greeting
      expect(html).toContain(`<h1 class="sr">${esc(t(l, 'nav.advisor'))}</h1>`);
      expect(html).toContain(`<p class="adv-hello" dir="auto">${esc(t(l, 'advisor.greeting.plain'))}</p>`);
      expect(renderAdvisor(l, null, {}, { name: 'Lena Park' })).toContain(`<p class="adv-hello" dir="auto">${esc(t(l, 'advisor.greeting', { name: 'Lena Park' }))}</p>`);
      expect(html).not.toContain(esc(t(l, 'advisor.hello')));
      expect(html).not.toMatch(/<li\b|<ul\b/);
      // the three questions are the empty box's placeholder, typed out one at a time — never its text
      expect(html).toContain(`placeholder="${esc(t(l, 'advisor.example.1'))}"`);
      expect(html).toContain(`data-adv-suggest="${esc(['advisor.example.1', 'advisor.example.2', 'advisor.example.3'].map((k) => t(l, k as MessageKey)).join('\n'))}"`);
      expect(html).toContain(`<label class="sr" for="advisor-q">${esc(t(l, 'advisor.label'))}</label>`);
      expect(html.match(/<form\b/g)).toHaveLength(1);
      // the form names the orb (tests/parity/advisor-orb.test.ts holds the rest)
      expect(html).toMatch(/<form method="post" action="\/app\/advisor" class="adv-bar" data-orb="\/assets\/orb\.[0-9a-f]{16}\.js" data-orb-state="composing" data-orb-glow="orb-glow"\s+data-adv-suggest=/);
      expect(html.match(/<textarea\b/g)).toHaveLength(1);
      expect(html.match(/<button\b/g)).toHaveLength(1);
      expect(html.match(/<input\b/g) ?? []).toEqual([]);
      expect(html).not.toMatch(/<a\s|href=|formaction|data-confirm/);
      // its plain voice: the light magenta is the assistant's, and the advisor is not the assistant
      expect(html).not.toContain('by-as');
      expect(html).not.toContain('data-mark="agent"');
    });

    it(`${l} · an answer: the sentence, or — when the sentence failed its check — the facts themselves, and its one door`, () => {
      const said = renderAdvisor(l, { asked: 'how many customers', answer: fact() });
      expect(said).toContain('<p><bdi>You have 12 customers.</bdi></p>');
      expect(said).not.toContain('adv-facts"><li><bdi>Customers: 12');
      // its one door, and the redesign's small link at the top: a new conversation
      expect(said.match(/<a class="deeper"/g)).toHaveLength(1);
      expect(said).toContain(`<a class="deeper" href="/app/inbox">${esc(t(l, 'nav.inbox'))}`);
      expect(said.match(/<a\s/g)).toHaveLength(2);
      expect(said).toContain(`<a class="adv-link" href="/app/advisor?new=1">${esc(t(l, 'advisor.thread.new'))}</a>`);
      // talking, the box asks plainly; the typed questions are the empty page's alone
      expect(said).toContain(`placeholder="${esc(t(l, 'advisor.label'))}"`);
      expect(said).not.toContain('data-adv-suggest');
      const plain = renderAdvisor(l, { asked: 'how many customers', answer: fact({ phrased: false, text: '' }) });
      expect(plain).toContain(`<p><bdi>${esc(t(l, 'advisor.fallback.head'))}</bdi></p><ul class="adv-facts"><li><bdi>Customers: 12</bdi></li></ul>`);
      expect(plain).not.toContain('You have 12 customers.');
      expect(plain).not.toContain('adv-label');
    });

    it(`${l} · advice is always under "${messages[l]['advisor.opinion.label']}", with what it stands on; a fact never is`, () => {
      const html = renderAdvisor(l, { asked: 'what should I do', answer: { kind: 'opinion', text: 'Write to them first.', lines: ['x'], phrased: true, based: ['who has gone quiet'] } });
      const label = html.indexOf(`<p class="adv-label">${esc(t(l, 'advisor.opinion.label'))}</p>`);
      expect(label).toBeGreaterThan(0);
      expect(label).toBeLessThan(html.indexOf('Write to them first.'));
      expect(html).toContain(esc(t(l, 'advisor.opinion.based', { list: 'who has gone quiet' })));
      expect(renderAdvisor(l, { asked: 'q', answer: fact() })).not.toContain('adv-label');
    });
  }
});

describe('the routes · signed in only; a fixed sentence asks the database and the model nothing', () => {
  /** A database that fails the test if anything touches it. */
  const untouchable = new Proxy({}, { get: (_t, p) => { throw new Error(`the database was touched: ${String(p)}`); } }) as unknown as Db;
  const model = (recognised: Awaited<ReturnType<AdvisorModel['recognise']>> | Error, calls: string[] = []): AdvisorModel => ({
    recognise: async () => { calls.push('recognise'); if (recognised instanceof Error) throw recognised; return recognised; },
    phrase: async () => { calls.push('phrase'); return 'PHRASED'; },
  });
  const io = (o: Partial<AdvisorIO> = {}, signedIn = true): AdvisorIO => ({
    viewer: () => (signedIn ? { businessId: '00000000-0000-4000-8000-000000000001', viewerId: 'p1' } : null),
    locale: () => 'en', page: (_r, x) => x.bodyHtml, db: untouchable, model: model(null),
    memory: null, processor: () => 'DeepSeek', provider: null, flashTo: (reply, path) => reply.redirect(path), takeFlash: () => null, ...o,
  });

  const ask = async (method: 'GET' | 'POST', with_: AdvisorIO, body?: Record<string, unknown>) => {
    const handlers: Record<string, { opts: { logLevel?: string }; h: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> }> = {};
    const fake = {
      get: (p: string, opts: { logLevel?: string }, h: typeof handlers[string]['h']) => { handlers[`GET ${p}`] = { opts, h }; },
      post: (p: string, opts: { logLevel?: string }, h: typeof handlers[string]['h']) => { handlers[`POST ${p}`] = { opts, h }; },
    };
    let drawn: { title: string; active: string; bodyHtml: string } | null = null;
    advisorRoutes(fake as unknown as FastifyInstance, { ...with_, page: (_r, o) => { drawn = { ...o }; return 'PAGE'; } });
    const out: { redirect?: string } = {};
    const reply = { redirect: (to: string) => { out.redirect = to; return reply; }, type: () => reply, send: () => reply };
    const route = handlers[`${method} /app/advisor`]!;
    await route.h({ body } as FastifyRequest, reply as unknown as FastifyReply);
    return { ...out, logLevel: route.opts.logLevel, drawn: drawn as { title: string; active: string; bodyHtml: string } | null };
  };

  it('signed out — a customer, anyone without the account\'s login — is sent to sign in; nothing is drawn or asked', async () => {
    const calls: string[] = [];
    for (const m of ['GET', 'POST'] as const) {
      const r = await ask(m, io({ model: model({ id: 'A1', period: null, customer: null, product: null, reference: null }, calls) }, false), { q: 'How are sales?' });
      expect(r.redirect).toBe('/login');
      expect(r.drawn).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it('signed in: the page, under the advisor\'s own entry; the routes log quietly (a question is the owner\'s words)', async () => {
    const r = await ask('GET', io());
    expect(r.drawn?.active).toBe('advisor');
    expect(r.drawn?.title).toBe('Advisor');
    expect(r.logLevel).toBe('warn');
    expect((await ask('POST', io(), { q: 'x' })).logLevel).toBe('warn');
    expect(NAV.find((n) => n.id === 'advisor')?.href).toBe('/app/advisor');
  });

  for (const id of ['A9', 'B6', 'C5', 'D6', 'D9', 'D10', 'F5', 'F6', 'H2n']) {
    it(`${id} · not stored: its fixed sentence — the database is not touched, and the model words nothing`, async () => {
      const calls: string[] = [];
      const r = await ask('POST', io({ model: model({ id, period: null, customer: null, product: null, reference: null }, calls) }), { q: 'anything' });
      expect(r.drawn!.bodyHtml).toContain(`<p><bdi>${esc(t('en', entryOf(id)!.says!))}</bdi></p>`);
      expect(calls).toEqual(['recognise']);
    });
  }

  it('competitors: the opinion with nothing to stand on says so, under the label — nothing read, nothing worded', async () => {
    const calls: string[] = [];
    const r = await ask('POST', io({ model: model({ id: 'I6', period: null, customer: null, product: null, reference: null }, calls) }), { q: 'what are my competitors doing' });
    expect(r.drawn!.bodyHtml).toContain(esc(t('en', 'advisor.opinion.competitors')));
    expect(r.drawn!.bodyHtml).toContain('<p class="adv-label">');
    expect(calls).toEqual(['recognise']);
  });

  it('a question it does not know: says so, and what can be asked; one the model fails on: says that — never a guess', async () => {
    const unknown = await ask('POST', io({ model: model(null) }), { q: 'what is the meaning of life' });
    expect(unknown.drawn!.bodyHtml).toContain(esc(t('en', 'advisor.unknown')));
    expect(unknown.drawn!.bodyHtml).toContain(esc(t('en', 'advisor.example.5')));
    const made = await ask('POST', io({ model: model({ id: 'Z9', period: null, customer: null, product: null, reference: null }) }), { q: 'x' });
    expect(made.drawn!.bodyHtml).toContain(esc(t('en', 'advisor.unknown')));
    const failed = await ask('POST', io({ model: model(new Error('timeout')) }), { q: 'how are sales' });
    expect(failed.drawn!.bodyHtml).toContain(esc(t('en', 'advisor.failed')));
  });

  it('an installation without the pool or the model says it cannot answer yet', async () => {
    for (const o of [{ db: null }, { model: null }] as const) {
      const r = await ask('POST', io(o), { q: 'how are sales' });
      expect(r.drawn!.bodyHtml).toContain(esc(t('en', 'advisor.unavailable')));
    }
  });

  it('the question comes back once, escaped and cut to the box; a blank one is the page at rest', async () => {
    const r = await ask('POST', io({ model: model(null) }), { q: '<script>alert(1)</script> How much did we sell?' });
    expect(r.drawn!.bodyHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt; How much did we sell?');
    expect(r.drawn!.bodyHtml).not.toContain('<script>');
    const long = await ask('POST', io({ model: model(null) }), { q: 'x'.repeat(ADVISOR_MAX + 50) });
    expect(long.drawn!.bodyHtml).toContain(`<bdi>${'x'.repeat(ADVISOR_MAX)}</bdi>`);
    expect(long.drawn!.bodyHtml).not.toContain('x'.repeat(ADVISOR_MAX + 1));
    const blank = await ask('POST', io(), { q: '   ' });
    expect(blank.drawn!.bodyHtml).toBe(renderAdvisor('en'));
  });
});
