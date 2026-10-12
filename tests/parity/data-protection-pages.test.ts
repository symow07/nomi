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
