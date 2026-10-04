import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery } from 'kysely';
import { registerWebApp, type WebDeps } from '../../src/api/web/app.js';
import { makeSessionCodec } from '../../src/api/web/session.js';

/**
 * THE WARMTH RUN, PHASE 9 — the fix wave, area settings-a (docs/UI-AUDIT.md §8).
 *
 * Routes are asked through the real app, with a database that answers every
 * question with nothing — except the rail's count, which says three customers
 * wait. Nothing is written; no Postgres is needed.
 */
const SECRET = 'x'.repeat(64);
const PILOT = 'de300000-0000-4000-8000-0000000000b1';
const OTHER = 'de300000-0000-4000-8000-0000000000c2';

/**
 * A database that answers the rail's count with 3; a question that is one row
 * of yes/no figures (setup's steps, the channels connected) with "no" for each;
 * and everything else with no rows.
 */
const answer = (q: string): unknown[] => {
  if (/ as waiting,/.test(q)) return [{ waiting: 3, blocked: 0, mine: 0, deletion: 0, channels: 1 }];
  if (/^\s*select\s+(exists\(|coalesce\(\(|\(exists)/.test(q)) return [Object.fromEntries([...q.matchAll(/\) as (\w+)/g)].map((m) => [m[1], false]))];
  return [];
};
const quietDb = (): Kysely<never> => new Kysely<never>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (d) => new PostgresIntrospector(d),
    createQueryCompiler: () => new PostgresQueryCompiler(),
    createDriver: () => ({
      init: async () => {}, destroy: async () => {},
      acquireConnection: async () => ({
        executeQuery: async (q: CompiledQuery) => ({
          rows: answer(q.sql) as never[],
        }),
        // eslint-disable-next-line require-yield
        streamQuery: async function* () { return; },
      }),
      beginTransaction: async () => {}, commitTransaction: async () => {}, rollbackTransaction: async () => {},
      releaseConnection: async () => {},
    }),
  },
});

const appWith = (over: Partial<WebDeps> = {}) => {
  const a = Fastify({ logger: false });
  registerWebApp(a, {
    db: quietDb() as never, sessionSecret: SECRET, accessCode: 'let-me-in',
    businessId: PILOT, employeeName: 'Lily', avatar: '', provider: 'disabled',
    secureCookie: false, kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    ...over,
  });
  return a;
};
const cookieFor = (businessId: string) =>
  `yf_session=${makeSessionCodec(SECRET).sign({ businessId, exp: Date.now() + 3_600_000 })}`;
const HTML = { accept: 'text/html' };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

describe('w4-settings-a-24 · a form sent back keeps the rail: its waiting count and its live check', () => {
  it('the page drawn for a GET has them (the baseline the sent-back page must match)', async () => {
    const a = appWith();
    const r = await a.inject({ method: 'GET', url: '/app/settings/closures', headers: { ...HTML, cookie: cookieFor(PILOT) } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/data-rail="\/app\/live\/rail\?since=3\.[0-9]+"/);   // the count, and when the latest began to wait (w4-whole-03)
  });

  for (const [what, url, payload] of [
    ['a closure whose last day is before its first', '/app/settings/closures', 'label=Holiday&from=2026-12-20&to=2026-12-10'],
    ['a forbidden word of spaces only', '/app/settings/forbidden', 'term=%20%20%20'],
  ] as const) {
    it(`${what}: sent back with status 400, the rail still counts 3 and still asks`, async () => {
      const a = appWith();
      const r = await a.inject({ method: 'POST', url, payload, headers: { ...HTML, ...FORM, cookie: cookieFor(PILOT) } });
      expect(r.statusCode).toBe(400);
      expect(r.body).toContain('role="alert"');
      expect(r.body).toMatch(/data-rail="\/app\/live\/rail\?since=3\.[0-9]+"/);   // the count, and when the latest began to wait (w4-whole-03)
      expect(r.body).toMatch(/data-nav="inbox"[^>]*aria-label="[^"]*3/);
    });
  }
});

describe('V1-006 (the gallery) · the component gallery is no owner\'s page on a normal installation', () => {
  it('without the switch: no page, for the installation\'s own workspace too — the wrong-address page, in the workspace', async () => {
    const a = appWith();
    for (const who of [PILOT, OTHER]) {
      const r = await a.inject({ method: 'GET', url: '/app/settings/components', headers: { ...HTML, cookie: cookieFor(who) } });
      expect(r.statusCode, who).toBe(404);
      expect(r.body, who).not.toContain('Rest');
    }
  });
  it('with the switch (a local instance, COMPONENT_GALLERY=on): the screenshots tool still walks it, as the installation\'s workspace only', async () => {
    const a = appWith({ componentGallery: true });
    const own = await a.inject({ method: 'GET', url: '/app/settings/components', headers: { ...HTML, cookie: cookieFor(PILOT) } });
    expect(own.statusCode).toBe(200);
    expect(own.body).toContain('<h1 class="page">');
    expect((await a.inject({ method: 'GET', url: '/app/settings/components', headers: { ...HTML, cookie: cookieFor(OTHER) } })).statusCode).toBe(404);
  });
  it('the switch is read from the environment by name, documented, and set only by the local smoke script', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    expect(read('src/main.ts')).toContain("componentGallery: process.env['COMPONENT_GALLERY'] === 'on',");
    expect(read('.claude/skills/run-nomi/smoke.sh')).toContain('COMPONENT_GALLERY=on');
    expect(read('docs/env-checklist.md')).toContain('| `COMPONENT_GALLERY` |');
  });
});

describe('V1-008 · a closure\'s dates are drawn in the owner\'s language, not the browser\'s "yyyy/mm/dd"', () => {
  const view = { closures: [] };
  const order = (html: string, name: string) => [...html.matchAll(new RegExp(`name="${name}_([dmy])"`, 'g'))].map((m) => m[1]).join('');
  it('ar and zh: no browser date control; the parts in the order the language writes a date; the months by their names', async () => {
    const { renderClosures } = await import('../../src/api/web/settings.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const ar = renderClosures(view, 'ar', null);
    const zh = renderClosures(view, 'zh', null);
    for (const [l, html] of [['ar', ar], ['zh', zh]] as const) {
      expect(html, l).not.toContain('type="date"');
      expect(html, l).toContain(`<div class="dparts" role="group" aria-label="${t(l, 'closures.add.from')}">`);
      expect(html, l).toContain(`<span class="dpart-n">${t(l, 'closures.date.day')}</span>`);
      expect(html, l).toContain(`<span class="dpart-n">${t(l, 'closures.date.year')}</span>`);
    }
    expect(order(ar, 'from')).toBe('dmy');      // 5 فبراير 2026
    expect(order(zh, 'from')).toBe('ymd');      // 2026年2月5日
    expect(ar).toContain('<option value="02">فبراير</option>');
    expect(zh).toContain('<option value="02">2月</option>');
    expect(ar).not.toMatch(/yyyy|mm\/dd/i);
  });

  it('the server puts the parts back together, with any digits a keyboard types, and validates as before', async () => {
    const { closureDateField } = await import('../../src/api/web/settings.js');
    expect(closureDateField({ from_d: '5', from_m: '02', from_y: '2027' }, 'from')).toBe('2027-02-05');
    expect(closureDateField({ to_d: '٢١', to_m: '02', to_y: '٢٠٢٧' }, 'to')).toBe('2027-02-21');
    expect(closureDateField({ from_d: '５', from_m: '2', from_y: '２０２７' }, 'from')).toBe('2027-02-05');
    expect(closureDateField({ from: '2027-02-05' }, 'from')).toBe('2027-02-05');          // a date posted whole, as before
    expect(closureDateField({}, 'from')).toBeNull();                                       // nothing: missing
    expect(closureDateField({ from_d: '5', from_m: '', from_y: '2027' }, 'from')).toBe('not-a-date');
  });

  it('one form, one save: the parts post to the same route, which adds the closure or sends the form back with the parts kept', async () => {
    const a = appWith();
    const ok = await a.inject({ method: 'POST', url: '/app/settings/closures', headers: { ...HTML, ...FORM, cookie: cookieFor(PILOT) },
      payload: 'label=Eid&from_d=5&from_m=02&from_y=2027&to_d=21&to_m=02&to_y=2027' });
    expect(ok.statusCode).toBe(302);
    const back = await a.inject({ method: 'POST', url: '/app/settings/closures', headers: { ...HTML, ...FORM, cookie: cookieFor(PILOT) },
      payload: 'label=Eid&from_d=21&from_m=02&from_y=2027&to_d=5&to_m=02&to_y=2027' });
    expect(back.statusCode).toBe(400);
    expect(back.body).toContain('id="cl-to-err"');
    expect(back.body).toContain('name="to_d" inputmode="numeric" autocomplete="off" required maxlength="2" value="5"');
    expect(back.body).toContain('<option value="02" selected>');
  });
});

describe('w4-settings-a-22 · Your sign-in says what to do when the code or the password is lost', () => {
  it('in every language: with a code, who gives a new one; with a password, the door\'s link where it can e-mail one, else whom to ask', async () => {
    const { renderAccount } = await import('../../src/api/web/account.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { esc } = await import('../../src/api/web/layout.js');
    const { LOCALES } = await import('../../src/core/owner/i18n/locale.js');
    for (const l of LOCALES) {
      expect(renderAccount({ email: null, passwordMin: 10 }, l, null, 'Setup'), l).toContain(esc(t(l, 'account.lost.code')));
      const mailed = renderAccount({ email: 'a@example.test', passwordMin: 10, recovery: true }, l, null, 'Setup');
      expect(mailed, l).toContain(`${esc(t(l, 'account.lost.password'))} <a href="/login/forgot">${esc(t(l, 'login.forgot'))}</a>`);
      const asked = renderAccount({ email: 'a@example.test', passwordMin: 10 }, l, null, 'Setup');
      expect(asked, l).toContain(esc(t(l, 'account.lost.passwordAsk')));
      expect(asked, l).not.toContain('/login/forgot');
    }
  });
});

describe('w4-settings-a-11 · a refused business answer is sent back with all three kept, the wrong one marked', () => {
  for (const [what, payload, field, keep] of [
    ['a website that is not one', 'kind=manufacturer&country=CN&website=my%20shop', 'website', ['<option value="manufacturer" selected>', '<option value="CN" selected>', 'value="my shop"']],
    ['no kind chosen', 'kind=&country=CN&website=example.com', 'kind', ['<option value="CN" selected>', 'value="example.com"']],
    ['no country chosen', 'kind=retail&country=&website=', 'country', ['<option value="retail" selected>']],
  ] as const) {
    it(`${what}: 400, the field's own sentence under it, the cursor there, the rest as typed`, async () => {
      const { t } = await import('../../src/core/owner/i18n/messages.js');
      const a = appWith();
      const r = await a.inject({ method: 'POST', url: '/app/settings/business', payload, headers: { ...HTML, ...FORM, cookie: cookieFor(PILOT) } });
      expect(r.statusCode).toBe(400);
      expect(r.body).toContain(`<span class="fielderr" role="alert" id="bk-${field}-err">${t('en', `business.kind.bad.${field}`)}</span>`);
      expect(r.body).toMatch(new RegExp(`id="bk-${field}"[^>]*aria-invalid="true" aria-describedby="bk-${field}-err" autofocus`));
      for (const k of keep) expect(r.body, k).toContain(k);
      expect(r.body).toMatch(/data-rail="\/app\/live\/rail\?since=3\.[0-9]+"/);   // the count, and when the latest began to wait (w4-whole-03)
    });
  }
});

describe('w4-settings-a-19 · how a word is matched is shown with an example in each language, and the example is true', () => {
  it('es and fr name a word of their own; the shorter word does not catch the longer one, and stands caught alone', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { findForbidden, effectiveForbidden } = await import('../../src/core/safety/forbiddenWords.js');
    for (const [l, word, longer] of [['es', 'caro', 'caroteno'], ['fr', 'nul', 'annuler']] as const) {
      const s = t(l, 'forbidden.howMatched');
      expect(s, l).not.toContain('liar');
      expect(s, l).toContain(word); expect(s, l).toContain(longer);
      expect(findForbidden(longer, effectiveForbidden([word])).map((x) => x.term), l).not.toContain(word);
      expect(findForbidden(word, effectiveForbidden([word])).map((x) => x.term), l).toContain(word);
    }
  });
  it('the languages in the fold are labels, capitalised where the script has case', async () => {
    const { renderForbidden } = await import('../../src/api/web/settings.js');
    const fr = renderForbidden({ own: [], floor: ['idiot'] }, 'fr', null);
    expect(fr).toContain('<dt>Anglais</dt>');
    expect(fr).not.toContain('<dt>anglais</dt>');
    expect(renderForbidden({ own: [], floor: [] }, 'es', null)).toContain('<dt>Inglés</dt>');
  });
});

describe('settings-a-new-09 · w4-settings-a-20 · closures and forbidden words: one width for the intro, and room above the fixed list', () => {
  it('the second intro paragraph keeps the lede\'s measure; the fixed list is set apart from the empty panel', async () => {
    const { renderClosures, renderForbidden } = await import('../../src/api/web/settings.js');
    const { stylesheetAt, shell } = await import('../../src/api/web/layout.js');
    expect(renderClosures({ closures: [] }, 'en', null)).toContain('<p class="muted small closure-said measure-prose">');
    expect(renderForbidden({ own: [], floor: [] }, 'en', null)).toMatch(/<p class="muted small measure-prose">[^<]*familiar/);
    const sheet = /href="\/assets\/(app\.[0-9a-f]+\.css)"/.exec(shell({ title: 'T', active: 'settings', locale: 'en', path: '/app', bodyHtml: '' }))![1]!;
    expect(stylesheetAt(sheet)!.css).toContain('.block.floor { margin-top:var(--space-24); }');
  });
});

describe('Your data · w4-settings-a-16, -17, -18', () => {
  const view = { businessName: 'Atlas', requests: [], buyers: [], contact: 'privacy@example.test' };
  it('the deletion list opens with one short paragraph; how a request in a message is listed is folded under it', async () => {
    const { renderDataRights } = await import('../../src/api/web/dataRights.js');
    const { OWNER_VIEW } = await import('../../src/core/conversation/people.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { esc } = await import('../../src/api/web/layout.js');
    const { LOCALES } = await import('../../src/core/owner/i18n/locale.js');
    const { withoutIsolates } = await import('./isolates.js');
    for (const l of LOCALES) {
      const h = withoutIsolates(renderDataRights(view as never, l, null, OWNER_VIEW, 'Setup'));
      expect(h, l).toContain(`<p class="lede">${esc(withoutIsolates(t(l, 'data.buyers.lead')))}</p>`);
      expect(h, l).toMatch(new RegExp(`<details class="data-more"><summary>${esc(t(l, 'data.buyers.fromChatTitle'))}</summary>`));
      expect(h, l).not.toContain(`${esc(t(l, 'data.buyers.lead'))} ${esc(t(l, 'data.buyers.fromChat'))}`);
      // a file is saved, not opened: no door's chevron on Download
      expect(h, l).not.toMatch(/class="deeper" href="\/app\/settings\/data\//);
    }
    // Chinese runs two sentences on after 。 — no stray space (three places)
    const zh = renderDataRights(view as never, 'zh', null, OWNER_VIEW, 'Setup');
    expect(zh).not.toMatch(/。 /);
    expect(zh).toContain(`${t('zh', 'data.deletion.lead')}${t('zh', 'data.deletion.now')}`);
  });
  it('the download cards span the column like the page\'s other cards', async () => {
    const { stylesheetAt, shell } = await import('../../src/api/web/layout.js');
    const sheet = /href="\/assets\/(app\.[0-9a-f]+\.css)"/.exec(shell({ title: 'T', active: 'settings', locale: 'en', path: '/app', bodyHtml: '' }))![1]!;
    expect(stylesheetAt(sheet)!.css).not.toContain('.dl-files { max-width');
  });
});

describe('w4-settings-a-23 · Billing says "nothing is charged" once, in its row', () => {
  it('the lede says payments are off; the row says what is charged', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { LOCALES } = await import('../../src/core/owner/i18n/locale.js');
    for (const l of LOCALES) expect(t(l, 'billing.notConfigured'), l).not.toMatch(/charged|收费|رسم|cobra|factur/i);
  });
});

describe('w4-settings-a-21 · V1-487 · the gallery (a developer\'s page now) shows this run\'s parts, in the product\'s own words', () => {
  it('faces in five sizes, menu rows, the small card, and the assistant\'s reply on its wash with ✦ and the name', async () => {
    const { renderComponents } = await import('../../src/api/web/components.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { LOCALES } = await import('../../src/core/owner/i18n/locale.js');
    for (const l of LOCALES) {
      const h = renderComponents(l);
      for (const size of ['xs', 's', 'm', 'l', 'xl']) expect(h, `${l} ${size}`).toContain(`class="face face-${size} t`);
      expect(h, l).toContain('class="srow sr-menu sr-two"');
      expect(h, l).toContain('<a class="toast" href="/app/inbox">');
      expect(h, l).toMatch(/class="bubble by-as"><bdi>[^<]+<\/bdi><\/div><div class="ts muted">[^<]+ · <span class="as">[^<]+<\/span>/);   // its name tag, no mark (the icons run)
      // no placeholder in every role: the notices and the empty panel say the product's own words
      expect(h, l).not.toContain(`class="empty">${t(l, 'components.empty')}`);
      // the chat samples carry a time, not the word for a button's resting state
      expect(h, l).not.toContain(`<div class="ts muted">${t(l, 'components.state.rest')}</div>`);
    }
  });
});

describe('Notifications · the phone button stays hidden until the script shows it (seen while fixing w4-settings-a-08)', () => {
  it('a button\'s own display does not undo hidden', async () => {
    const { stylesheetAt, shell } = await import('../../src/api/web/layout.js');
    const sheet = /href="\/assets\/(app\.[0-9a-f]+\.css)"/.exec(shell({ title: 'T', active: 'settings', locale: 'en', path: '/app', bodyHtml: '' }))![1]!;
    expect(stylesheetAt(sheet)!.css).toContain('.btn[data-push-key][hidden] { display:none; }');
  });
});
