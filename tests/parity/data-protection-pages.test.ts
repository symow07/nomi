import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { renderDataDeletion, renderPrivacy } from '../../src/api/web/legal.js';
import { aiProcessor, HOSTING, type Processor } from '../../src/core/legal/processors.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE DATA-PROTECTION AUDIT (2026-10-12) — the public pages say what the code
 * does. Each item is held where the code and the words meet, so a change to
 * one without the other fails here.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');

describe('D8 · the pictures a buyer sends go to the language service, and the page says so', () => {
  it('the model client is handed images', () => {
    // The vision describer sends the photo itself, as an image block (src/llm/anthropic.ts).
    expect(read('src/llm/anthropic.ts')).toMatch(/type: 'image', source: \{ type: 'base64'/);
  });
  it('so the page names pictures beside the text, in every language', () => {
    const picture = { en: /\bpicture/, zh: /图片/, ar: /صور/, es: /imagen/, fr: /image/ } as const;
    for (const l of LOCALES) {
      const line = t(l, 'legal.privacy.who.ai', { processor: 'X' });
      expect(line, l).toMatch(picture[l]);
    }
    expect(t('en', 'legal.privacy.who.ai', { processor: 'X' })).not.toMatch(/from the text of the conversation/);
  });
});

describe('D6 · the deletion page names every copy no deletion inside Nomi reaches', () => {
  const DEEPSEEK: { processor: Processor; hosting: Processor; transcriber: Processor | null } =
    { processor: aiProcessor('https://api.deepseek.com/anthropic'), hosting: HOSTING, transcriber: null };
  const page = (l: (typeof LOCALES)[number], email: string | null, facts = DEEPSEEK) => withoutIsolates(renderDataDeletion(l, email, facts));
  const items = (html: string) => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);

  it('the language service by its configured name, with what its own terms say — in every language', () => {
    for (const l of LOCALES) {
      const html = page(l, 'privacy@nomi.test');
      const said = items(html).find((x) => x.startsWith(esc(t(l, 'legal.deletion.kept.processor', { processor: '@@' })).split('@@')[0]!) && x.includes('DeepSeek'));
      expect(said, l).toBeTruthy();
      expect(said!, l).toContain(esc(t(l, 'legal.privacy.provider.deepseek', { provider: 'DeepSeek' })));
    }
  });
  it('the host’s logs, by the host’s name; WhatsApp in the Meta line', () => {
    const html = page('en', 'privacy@nomi.test');
    expect(html).toContain(esc(t('en', 'legal.deletion.kept.logs', { hosting: 'Railway (USA)' })));
    // WhatsApp twice in every language: among Meta's own copies, and among the business's own inboxes.
    for (const l of LOCALES) {
      const name = l === 'ar' ? 'واتساب' : 'WhatsApp';
      expect(t(l, 'legal.deletion.kept.meta').split(name).length - 1, l).toBe(2);
    }
    expect(t('en', 'legal.deletion.kept.meta')).toMatch(/only the business can delete/);
  });
  it('the transcriber only where one runs; our mailbox only where the page gives an address', () => {
    const plain = page('en', 'privacy@nomi.test');
    expect(plain).not.toContain(esc(t('en', 'legal.deletion.kept.transcriber', { transcriber: '@@' })).split('@@')[1]!);
    const heard = page('en', 'privacy@nomi.test', { ...DEEPSEEK, transcriber: { name: 'OpenAI', country: 'US' } });
    expect(heard).toContain(esc(t('en', 'legal.deletion.kept.transcriber', { transcriber: 'OpenAI (USA)' })));
    expect(plain).toContain(esc(t('en', 'legal.deletion.kept.mailbox')));
    expect(page('en', null)).not.toContain(esc(t('en', 'legal.deletion.kept.mailbox')));
  });
  it('in the kept list, after what the business keeps and before the backups', () => {
    const html = page('en', 'privacy@nomi.test');
    const at = (needle: string) => html.indexOf(needle);
    const order = [esc(t('en', 'legal.deletion.kept.elsewhere')), 'DeepSeek', esc(t('en', 'legal.deletion.kept.mailbox')), esc(t('en', 'legal.deletion.kept.backups'))]
      .map(at);
    expect(order.every((p) => p > -1), JSON.stringify(order)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('the live page is drawn with the configured facts, not the defaults', () => {
    expect(read('src/api/web/app.ts')).toMatch(/renderDataDeletion\(localeOf\(req\), deps\.legalContact \?\? null, legalFacts,/);
  });
});


describe('D15 · the deletion page says what D3’s stop line does', () => {
  it('a stop said as "remove me from your list" is answered with the stop line (src/pipeline/turn.ts)', () => {
    expect(read('src/pipeline/turn.ts')).toMatch(/asksOnlyOffAList\(req\.text\)/);
  });
  it('so step 3 says nothing about the deletion is sent, and names the one fixed line that confirms a stop', () => {
    const en = t('en', 'legal.deletion.step3');
    expect(en).toMatch(/^Nomi sends you nothing about the deletion\./);
    expect(en).toMatch(/one fixed line confirms that, and nothing more/);
    expect(en).not.toMatch(/does not write to you about it/);
    const said = { zh: '一句固定的话', ar: 'جملة واحدة ثابتة', es: 'una única frase fija', fr: 'une seule phrase fixe' } as const;
    for (const l of ['zh', 'ar', 'es', 'fr'] as const) expect(t(l, 'legal.deletion.step3'), l).toContain(said[l]);
  });
});

describe('D4 · until the owner sets a retention policy, the pages claim no end date and no deadline', () => {
  it('no timer erases a workspace (0126 retired the 90-day one), so "How long" names no end', () => {
    expect(read('src/queue/boss.ts')).toMatch(/RETIRED_QUEUES = \{ retention: 'ops\.retention' \}/);
    for (const l of LOCALES) expect(t(l, 'legal.privacy.howLong.body', { deletion: 'X' }), l).not.toMatch(/\b(30|60|90) (days|días|jours)\b/);
    expect(t('en', 'legal.privacy.howLong.body', { deletion: 'X' })).toMatch(/no set end/);
  });
  it('and the deletion page says how soon is the business’s, with no deadline from Nomi', () => {
    expect(t('en', 'legal.deletion.step2')).toMatch(/How soon is up to the business; Nomi deletes nothing on its own\./);
    const said = { zh: '什么时候删由商家决定', ar: 'وتوقيت الحذف بيد الشركة', es: 'Cuándo lo hace depende del negocio', fr: 'Le moment de la suppression dépend de l’entreprise' } as const;
    for (const l of ['zh', 'ar', 'es', 'fr'] as const) expect(t(l, 'legal.deletion.step2'), l).toContain(said[l]);
  });
});

describe('D20 · the wording items', () => {
  it('the cookie paragraph names every purpose the table lists — the access code, the age and the password link included', () => {
    const en = t('en', 'legal.privacy.cookies.body');
    for (const said of ['signed in', 'language', 'notice once', 'device you have confirmed', 'password-setting link', 'connection', 'access code once', 'minimum age']) {
      expect(en, said).toContain(said);
    }
  });
  it('the photo is refreshed only while the account stays connected; the last copy is kept, not updated', () => {
    expect(t('en', 'legal.privacy.kept.photo')).toMatch(/while the business’s Instagram or Messenger account stays connected to Nomi; if that account is disconnected, the last copy is kept, not updated/);
  });
  it('the bot check is named where the sign-up FORM is shown (it also comes back on /verify), not a page', () => {
    expect(t('en', 'legal.privacy.cookies.botCheck', { provider: 'X' })).toMatch(/^Only where the sign-up form is shown/);
    expect(t('en', 'legal.privacy.who.botCheck', { botCheck: 'X' })).toMatch(/sign-up form/);
  });
  it('the translations promise what English does', () => {
    expect(t('zh', 'legal.privacy.advisor.customers')).toContain('顾问对话中提到该客户的内容也会被删除');
    expect(t('zh', 'legal.privacy.ai')).not.toContain('有些回复');
    expect(t('ar', 'legal.privacy.ai')).not.toContain('بعض الردود');
    expect(t('ar', 'legal.privacy.who.advisorKept')).not.toContain('مسبق');
    expect(t('ar', 'legal.privacy.cookies.body')).toContain('لا يتتبّعك');
  });
});

describe('D5 · the privacy page has a statement for the people who use Nomi at a business', () => {
  const FACTS = { processor: aiProcessor('https://api.deepseek.com/anthropic'), hosting: HOSTING, transcriber: null, botCheck: null };
  const page = (l: (typeof LOCALES)[number], facts: Parameters<typeof renderPrivacy>[2] = FACTS) => withoutIsolates(renderPrivacy(l, 'privacy@nomi.test', facts));

  it('in every language: its own section, after the advisor’s and before the cookies, with every part', () => {
    for (const l of LOCALES) {
      const html = page(l);
      const at = (x: string) => html.indexOf(x);
      expect(at('id="business"'), l).toBeGreaterThan(at('id="advisor"'));
      expect(at('id="business"'), l).toBeLessThan(at('id="cookies"'));
      for (const k of ['title', 'what', 'staff', 'why', 'howLong'] as const) expect(html, `${l} ${k}`).toContain(esc(t(l, `legal.privacy.owner.${k}`)));
    }
  });
  it('names who receives it by name: Google for Nomi’s own mail (production’s system mailbox is Google’s, checked 2026-10-12), the configured language service and host', () => {
    const html = page('en');
    expect(t('en', 'legal.privacy.owner.who', { processor: 'X', hosting: 'Y' })).toMatch(/^Who receives it: Google, which carries Nomi’s own e-mail/);
    expect(html).toContain(esc(t('en', 'legal.privacy.owner.who', { processor: 'DeepSeek (China)', hosting: 'Railway (USA)' })));
    // The system mail is sent through the operator's own connected mailbox first (src/main.ts).
    expect(read('src/main.ts')).toMatch(/mailboxSystemMailer\(systemSmtp\.from/);
  });
  it('the bot check only where one runs', () => {
    const said = (h: string) => h.includes(esc(t('en', 'legal.privacy.owner.botCheck', { botCheck: '@@' })).split('@@')[1]!);
    expect(said(page('en'))).toBe(false);
    expect(said(page('en', { ...FACTS, botCheck: { name: 'Cloudflare Turnstile', country: 'US' } }))).toBe(true);
  });
  it('what it promises is what the code does: a password only as a hash, no age, an unfinished sign-up forgotten within a day (D1)', () => {
    const what = t('en', 'legal.privacy.owner.what');
    expect(what).toMatch(/your password, only as a one-way hash/);
    expect(what).toMatch(/not your age/);
    expect(t('en', 'legal.privacy.owner.howLong')).toMatch(/A sign-up never finished is forgotten within a day of its code expiring/);
    expect(read('migrations/0137_signup_records.sql')).toMatch(/create or replace function login_codes_forget\(\)/);
    expect(read('src/main.ts')).toMatch(/boss\.schedule\(QUEUES\.signupExpiry, '45 3 \* \* \*'/);
  });
  it('the intro points to it', () => {
    expect(t('en', 'legal.privacy.intro')).toMatch(/Further down, it says the same for the people who use Nomi at a business\./);
  });
});


describe('D2 · the pages say what the logs hold and for how long', () => {
  const week = { en: /for a week/, zh: /一周/, ar: /أسبوع/, es: /una semana/, fr: /une semaine/ } as const;
  const since = { en: /12 October 2026/, zh: /2026 年 10 月 12 日/, ar: /12 أكتوبر 2026/, es: /12 de octubre de 2026/, fr: /12 octobre 2026/ } as const;
  const days3 = { en: /at most three days/, zh: /最多保存三天/, ar: /ثلاثة أيام على الأكثر/, es: /tres días como máximo/, fr: /trois jours au plus/ } as const;
  it('every language: the host logs each visit, Nomi reads a week of it, the host may keep more', () => {
    for (const l of LOCALES) {
      const host = t(l, 'legal.privacy.who.hosting', { hosting: 'H' });
      const logs = t(l, 'legal.deletion.kept.logs', { hosting: 'H' });
      expect(host, l).toMatch(week[l]);
      expect(logs, l).toMatch(week[l]);
      expect(logs, l).toMatch(since[l]);
    }
  });
  it('the page leaves the query out because the app and the host both do (checked against the host on 2026-10-12)', () => {
    expect(t('en', 'legal.privacy.who.hosting', { hosting: 'H' })).toMatch(/without anything after a “\?”/);
    expect(read('src/api/requestLog.ts')).toMatch(/split\('\?'\)\[0\]/);
  });
  it('a sign-up’s address, hashed, for at most three days: two past its hour, and the daily job (0138)', () => {
    for (const l of LOCALES) expect(t(l, 'legal.privacy.owner.what'), l).toMatch(days3[l]);
    expect(read('migrations/0138_signup_callers.sql')).toMatch(/delete from signup_throttles where hour < now\(\) - interval '2 days'/);
    expect(read('src/main.ts')).toMatch(/boss\.schedule\(QUEUES\.signupExpiry, '45 3 \* \* \*'/);
  });
});

describe('D7 · the terms say what the download holds, not "in full"', () => {
  it('every language names the row limit the export keeps, and no longer promises everything', async () => {
    const { EXPORT_MAX_ROWS } = await import('../../src/api/web/dataExport.js');
    const full = { en: /in full/, zh: /完整导出/, ar: /كاملة/, es: /completos/, fr: /en totalité/ } as const;
    for (const l of LOCALES) {
      const line = t(l, 'legal.terms.fees.body');
      expect(line.replace(/[^\d]/g, ''), l).toContain(String(EXPORT_MAX_ROWS));
      expect(line, l).not.toMatch(full[l]);
    }
  });
  it('the buyer page offers the copy to the owner only, beside deleting', () => {
    const src = read('src/api/web/conversations.ts');
    expect(src).toMatch(/function copySection[\s\S]*?if \(!viewer\.isOwner\) return '';/);
    expect(src).toMatch(/\$\{copySection\(f, locale, viewer\)\}\s*\$\{deletionSection\(f, locale, viewer\)\}/);
    expect(read('src/api/web/app.ts')).toMatch(/app\.get\('\/app\/conversations\/:conversationId\/copy\.csv'[\s\S]{0,400}ownerOnly\(req, reply, 'data_rights'/);
  });
});

describe('D10 · what is kept after a deletion says it no longer describes them', () => {
  it('the contract clears what kept rows held, and the pages name it, in every language', () => {
    const sql = read('migrations/0140_kept_records.sql');
    for (const c of [`('orders', 'keep', array['client_email','shipping_address','notes','tracking_reference']`,
      `('order_updates', 'keep', array['note','tracking_reference']`, `('suppressions', 'keep', array['detail']`,
      `('opt_outs', 'keep-standing'`, `('deletion_requests', 'keep', array['subject_note']`]) expect(sql).toContain(c);
    const tracking = { en: /tracking number/, zh: /物流单号/, ar: /تتبّع الشحن/, es: /seguimiento/, fr: /suivi/ } as const;
    const tookBack = { en: /took back is deleted/, zh: /撤回/, ar: /سُحب/, es: /retiraste/, fr: /retirée/ } as const;
    for (const l of LOCALES) {
      expect(t(l, 'legal.deletion.kept.orders'), l).toMatch(tracking[l]);
      expect(t(l, 'legal.deletion.kept.doNotContact'), l).toMatch(tookBack[l]);
      expect(t(l, 'conv.deletion.kept'), l).toMatch(tracking[l]);
    }
  });
});

describe('D9 · the unsubscribe link stops everything until they write again, and the pages say so', () => {
  it('the link records the stop (0135) beside the suppression, in one transaction', () => {
    const src = read('src/api/web/unsubscribe.ts');
    expect(src).toMatch(/withTenantTx\(db, bid\.value, async \(tx\) => \{\s*await suppress\([\s\S]*?\);\s*await recordAddressStop\(tx, bid\.value/);
  });
  it('every language says nothing more goes unless they write to the business again', () => {
    const again = { en: /unless you write to the business again/, zh: /除非你再次写信给商家/, ar: /إلا إذا وصلت منه رسالة جديدة/, es: /salvo si vuelves a escribir al negocio/, fr: /sauf si vous écrivez de nouveau/ } as const;
    for (const l of LOCALES) {
      expect(t(l, 'unsub.body'), l).toMatch(again[l]);
      expect(t(l, 'unsub.done.body'), l).toMatch(again[l]);
    }
    expect(t('en', 'legal.privacy.choices.body', { deletion: 'X' })).toMatch(/stops anything more being sent to that address until you write to the business again/);
  });
});

describe('D12 · "carried out again before the service runs": every ledger line reaches the mailbox, and a Railway restore stops the app first', () => {
  it('the job mails what was not mailed, every fifteen minutes; the routes note what they mailed', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(/boss\.schedule\(QUEUES\.erasureMail, '\*\/15 \* \* \* \*'/);
    expect(main).toMatch(/mailUnmailedLedger\(db, systemMail, cfg\.LEGAL_CONTACT_EMAIL/);
    expect(read('src/api/web/app.ts').match(/await markLedgerMailed\(deps\.db, ledgerIds\(/g)?.length).toBe(2);
  });
  it('the runbook stops the app before a Railway restore, and says the mailbox holds every line since 0141', () => {
    const doc = read('docs/BACKUP-RESTORE.md');
    expect(doc).toMatch(/stop the `nomi` service/);
    expect(doc).toMatch(/since\s+0141 \(D12\) a job every fifteen minutes mails every line not yet mailed/);
  });
});

describe('D13 · settled: "Try it in Practice" copies nothing until the owner sends; then the erasure reaches it', () => {
  it('the link only fills the Practice box — the question rides in the address, which the logs no longer keep (D2)', () => {
    expect(read('src/api/web/knowledge-insights.ts')).toMatch(/const testHref = `\/app\/sandbox\?ask=\$\{encodeURIComponent\(g\.question\)\}#compose`/);
    expect(read('src/api/web/app.ts')).toMatch(/const prefill = typeof q\.ask === 'string' \? q\.ask : asked\[0\] \?\? '';/);
  });
  it('the erasure deletes a practice conversation that holds their words, twelve characters or more, word for word', () => {
    const sql = read('migrations/0142_practice_copies.sql');
    expect(sql).toMatch(/select 12/);
    expect(sql).toMatch(/v_n := practice_erase_conversations\(v_copy, v_convs\);/);
    expect(sql).toMatch(/return practice_erase_conversations\(p_copy, v_ids\);/);
  });
  it('the deletion page says so, in every language', () => {
    for (const l of LOCALES) expect(t(l, 'legal.deletion.erased.practice').length, l).toBeGreaterThan(20);
    expect(read('src/api/web/legal.ts')).toMatch(/'legal\.deletion\.erased\.advisor',[\s\S]{0,120}'legal\.deletion\.erased\.practice',/);
  });
});

describe('D14 · the erasure takes every queued job that names them, and the privacy page says how long the queue keeps one', () => {
  it('jobs with no conversation that name their account go too, in the database and in the tool', () => {
    expect(read('migrations/0143_queue_jobs.sql')).toMatch(/data->>'conversationId' is null and data->>'customer' = any\(\$2\)/);
    expect(read('tools/erase-buyer.mjs')).toMatch(/data->>'conversationId' is null and data->>'customer' = any\(\$3::text\[\]\)/);
  });
  it('every language states the queue\'s week', () => {
    const week = { en: /about a week after the work is done/, zh: /约一周/, ar: /نحو أسبوع/, es: /una semana/, fr: /une semaine/ } as const;
    for (const l of LOCALES) expect(t(l, 'legal.privacy.howLong.body', { deletion: 'X' }), l).toMatch(week[l]);
  });
});

describe('D19 · every business table is decided, so none escapes the erasure by its column names', () => {
  it('the tool and the database name the same tables unrelated, and the tool refuses a business table it has not decided', async () => {
    // @ts-expect-error — the operator tools, plain JS on purpose.
    const { RULES, coverage } = await import('../../tools/erase-buyer.mjs');
    const sql = read('migrations/0144_every_table.sql');
    const inSql = [...sql.matchAll(/\('([a-z_.]+)', 'unrelated'/g)].map((m) => m[1]).sort();
    const inTool = Object.entries(RULES as Record<string, { do: string }>).filter(([, r]) => r.do === 'unrelated').map(([t]) => t).sort();
    expect(inSql).toEqual(inTool);
    expect(inSql.length).toBeGreaterThanOrEqual(57);
    for (const t of ['app_errors', 'calendar_entries', 'organization_enrichments', 'pilot_log']) expect(inTool, t).toContain(t);
    const col = (names: string[]) => new Map(names.map((n) => [n, { type: 'text', notnull: false }]));
    const schema = {
      tables: new Set(['clients', 'new_notes']),
      columns: new Map([['clients', col(['id', 'business_id'])], ['new_notes', col(['id', 'business_id', 'note'])]]),
      pks: new Map([['clients', ['id']], ['new_notes', ['id']]]),
      fks: [],
    };
    expect(coverage(schema, { clients: RULES.clients }, []).unclassified).toEqual(['new_notes']);
    expect(coverage(schema, { clients: RULES.clients, new_notes: { do: 'unrelated' } }, []).unclassified).toEqual([]);
  });
  it('an error is kept without the values it quoted (a parser quotes the model\'s answer)', async () => {
    const { appErrorEntry } = await import('../../src/worker/appErrors.js');
    let thrown: unknown;
    try { JSON.parse('Sure! Your 500 bags ship Friday'); } catch (e) { thrown = e; }
    const entry = appErrorEntry(thrown, 'worker:message.inbound', {}, { root: '/x', knownSecrets: [] });
    expect(entry.message).toMatch(/is not valid JSON/);
    expect(entry.message).not.toMatch(/Sure|bags/);
  });
});

describe('D16 · the advisor: a title an erasure cleared, what is not encrypted, every way history is deleted', () => {
  it('a conversation whose title an erasure cleared shows by its date, never as unreadable', async () => {
    const { renderEarlier } = await import('../../src/api/web/advisor.js');
    const at = new Date('2026-10-01T10:00:00Z');
    const html = renderEarlier('en', [{ id: '00000000-0000-4000-8000-000000000001', startedAt: at, lastTurnAt: at, title: '' }]);
    expect(html).not.toContain(t('en', 'advisor.thread.unreadable'));
    expect(read('src/advisor/memory.ts')).toMatch(/const openTitle = \(c: string, w: string\) => \(c === '' \? \{ plain: '', stale: false \} : open\(c, w\)\);/);
  });
  it('every language says what is not encrypted, that a surviving conversation loses its title, and every way history goes', () => {
    const notEncrypted = { en: /What is not encrypted/, zh: /不加密的部分/, ar: /وما لا يُشفَّر/, es: /Lo que no se cifra/, fr: /Ce qui n’est pas chiffré/ } as const;
    const title = { en: /loses its title/, zh: /失去标题/, ar: /عنوانها/, es: /pierde su título/, fr: /perd son titre/ } as const;
    const team = { en: /when you leave the team/, zh: /你离开团队/, ar: /عند الخروج من الفريق/, es: /cuando sales del equipo/, fr: /quand vous quittez l’équipe/ } as const;
    for (const l of LOCALES) {
      expect(t(l, 'legal.privacy.advisor.nobody'), l).toMatch(notEncrypted[l]);
      expect(t(l, 'legal.privacy.advisor.customers'), l).toMatch(title[l]);
      expect(t(l, 'legal.privacy.advisor.basis'), l).toMatch(team[l]);
    }
  });
});

describe('D17 · staff and owner records: archiving clears them, and the page says what goes', () => {
  it('the four archives clear on the way, and a removed member takes their login and devices', () => {
    const sql = read('migrations/0146_staff_records.sql');
    for (const t of ['people_archived_forget', 'people_archived_cascade', 'logins_archived_forget', 'push_subscriptions_archived_forget', 'mail_accounts_archived_forget']) {
      expect(sql, t).toMatch(new RegExp(`create trigger ${t} `));
    }
  });
  it('every language says what goes when a member is removed, and what an old sign-in, device or mailbox keeps', () => {
    const goes = { en: /Everything else of theirs goes when they are removed/, zh: /成员被移除时/, ar: /وعند إزالة العضو/, es: /Todo lo demás se borra al quitarlo/, fr: /Tout le reste est supprimé au retrait/ } as const;
    for (const l of LOCALES) expect(t(l, 'legal.privacy.owner.howLong'), l).toMatch(goes[l]);
    // D5 already told a team member that the owner sees when they were last active (the audit's second D17 point).
    expect(t('en', 'legal.privacy.owner.staff')).toMatch(/when they were last active, which the owner sees/);
  });
});

describe('D18 · no service receives anyone\'s data before the privacy page names it', () => {
  it('each of the six, switched on, stops the boot; none switched on, nothing is said', async () => {
    const { unnamedRecipientProblems, OPTIONAL_RECIPIENTS } = await import('../../src/core/legal/recipients.js');
    expect(OPTIONAL_RECIPIENTS.map((r) => r.id).sort()).toEqual(['apollo', 'd360', 'httpsMail', 'smtp', 'stripe', 'webPush']);
    expect(unnamedRecipientProblems({})).toEqual([]);
    for (const [env, name] of [
      [{ STRIPE_SECRET_KEY: 'sk_test_x' }, 'Stripe'], [{ VAPID_PRIVATE_KEY: 'x' }, 'web push'], [{ MAIL_API_KEY: 'x' }, 'Resend or Postmark'],
      [{ WHATSAPP_PROVIDER: '360dialog' }, '360dialog'], [{ SMTP_HOST: 'smtp.example.test' }, 'SMTP server'],
    ] as const) {
      const p = unnamedRecipientProblems(env);
      expect(p, name).toHaveLength(1);
      expect(p[0], name).toContain(name);
    }
    // Named, it may be switched on.
    const named = OPTIONAL_RECIPIENTS.map((r) => ({ ...r, named: { key: 'legal.privacy.who.x' } }));
    expect(unnamedRecipientProblems({ STRIPE_SECRET_KEY: 'x', SMTP_HOST: 'y' }, named)).toEqual([]);
  });
  it('a service marked named has its line on the privacy page, in every language', async () => {
    const { OPTIONAL_RECIPIENTS } = await import('../../src/core/legal/recipients.js');
    for (const r of OPTIONAL_RECIPIENTS) {
      if (!r.named) continue;
      for (const l of LOCALES) expect(t(l, r.named.key as Parameters<typeof t>[1]).length, `${r.id} ${l}`).toBeGreaterThan(20);
    }
  });
  it('Apollo, switched on inside the product by a stored key, is not wired until named; the boot reads the list', () => {
    const main = read('src/main.ts');
    expect(main).toMatch(/\.\.\.\(recipientNamed\('apollo'\) \? \{ prospectSourceFor: /);
    expect(main).not.toMatch(/^\s*prospectSourceFor: \(apiKey: string\) => apolloSource/m);
    expect(main).toMatch(/const problems: string\[\] = \[\.\.\.unnamedRecipientProblems\(env, recipients\)\];/);
  });
});
