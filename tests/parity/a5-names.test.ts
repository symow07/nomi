import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t, assistantName, withAssistantName, makeNameCache } from '../../src/api/web/say.js';
import { ASSISTANT_FALLBACK } from '../../src/core/owner/i18n/messages.js';
import { renderOwnerAlert } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * A5.2 — her name is a fact about the request, not a constant.
 *
 * A business names its own assistants, so every sentence that says `{name}`
 * has to say the right one: the main assistant's on a page about the whole
 * business, the conversation's own on a page about one conversation. And an
 * account that never renamed anyone must read exactly as it did.
 */

const WEB = fileURLToPath(new URL('../../src/api/web/', import.meta.url));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('A5.2 · the name in force', () => {
  // 2026-09-23 — it used to be a product constant (Lily / 小雅 / ياسمين): a name
  // nobody chose. With no name in force it is now "your assistant", as a label.
  it('outside any request it is "your assistant", in every language', () => {
    for (const l of LOCALES) {
      const label = ASSISTANT_FALLBACK[l].charAt(0).toLocaleUpperCase() + ASSISTANT_FALLBACK[l].slice(1);
      expect(assistantName(l)).toBe(label);
      expect(t(l, 'nav.employee')).toBe(label);
    }
  });

  it('inside a request it is the business\'s own, in whatever language the page is', () => {
    withAssistantName('Sara', () => {
      for (const l of LOCALES) {
        expect(assistantName(l)).toBe('Sara');
        expect(t(l, 'samples.flash.saved')).toContain('Sara');
        expect(t(l, 'samples.flash.saved').toLocaleLowerCase()).not.toContain(ASSISTANT_FALLBACK[l]);
      }
    });
  });

  it('a page about one conversation narrows it, and only for that page', () => {
    withAssistantName('Sara', () => {
      expect(withAssistantName('Noor', () => assistantName('en'))).toBe('Noor');
      expect(assistantName('en')).toBe('Sara');
    });
  });

  it('survives an await, which is what a route handler is', async () => {
    await withAssistantName('Sara', async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(assistantName('en')).toBe('Sara');
    });
    expect(assistantName('en')).toBe('Your assistant');
  });

  it('no name yet says "your assistant"; a name passed by hand still wins', () => {
    expect(withAssistantName(null, () => assistantName('en'))).toBe('Your assistant');
    expect(withAssistantName('', () => assistantName('en'))).toBe('Your assistant');
    withAssistantName('Sara', () => expect(t('en', 'people.issued.title', { name: 'Xiao Chen' })).toContain('Xiao Chen'));
  });
});

describe('A5.2 · remembered for a minute, forgotten on a rename', () => {
  it('holds a name, holds "no row yet" too, expires, and can be told to forget', () => {
    // A5 — it holds HOW MANY as well as who, because the nav asks both and
    // one look-up answers them.
    const c = makeNameCache(1000);
    expect(c.get('b1', 0)).toBeUndefined();
    c.set('b1', { name: 'Sara', several: true }, 0);
    c.set('b2', { name: null, several: false }, 0);
    expect(c.get('b1', 999)).toEqual({ name: 'Sara', several: true });
    expect(c.get('b2', 999)).toEqual({ name: null, several: false });
    expect(c.get('b1', 1000)).toBeUndefined();
    c.set('b1', { name: 'Sara', several: false }, 2000); c.evict('b1');
    expect(c.get('b1', 2001)).toBeUndefined();
  });

  it('every assistants write that can change the main name forgets it', () => {
    const src = read('src/api/web/app.ts');
    // Three for the name: the team page's add and edit, and Getting ready's
    // confirmation — which, since 2026-09-23, is what makes a default name
    // shown at all. D — six more for the setup count the same cache carries:
    // the profile saved, a product priced (edit and import), WhatsApp
    // connected, a Page chosen, and the first reply approved. Phase 4b — four
    // more, because any channel now completes the setup step: Instagram or
    // Messenger connected (C9), a mailbox connected, and a mailbox or a Page
    // disconnected (which can un-complete it).
    expect(src.match(/facts\.evict\(s\.businessId\)/g)?.length).toBe(13);
  });
});

describe('A5.2 · nothing on the owner\'s pages goes round it', () => {
  const files = readdirSync(WEB).filter((f) => f.endsWith('.ts') && f !== 'say.ts');

  it('no page takes `t` straight from the catalogue', () => {
    for (const f of files) {
      const imp = /import \{([^}]*)\} from '\.\.\/\.\.\/core\/owner\/i18n\/messages\.js';/.exec(readFileSync(WEB + f, 'utf8'));
      const names = (imp?.[1] ?? '').split(',').map((n) => n.trim());
      expect(names.includes('t'), `${f} imports t from the catalogue, so its {name} is the constant`).toBe(false);
    }
  });

  it('NOTHING on the owner\'s pages reads the constant any more', () => {
    // It used to be `assistants.ts`, which named a new main assistant from the
    // constant for the READER's page language — so who opened the team page
    // first decided what a business's assistant was called. Naming moved to
    // `db/assistants.ts`, which can see the business's own signup locale, and
    // the web layer stopped having an opinion about it.
    const readers = files.filter((f) => /EMPLOYEE_NAME\s*[[,}]/.test(readFileSync(WEB + f, 'utf8')));
    expect(readers).toEqual([]);
  });

  it('no save message is handed the installation\'s one configured name', () => {
    expect(read('src/api/web/app.ts')).not.toMatch(/name: deps\.employeeName/);
  });

  it('the scope is opened on preHandler — after the body is read — and by callback', () => {
    const src = read('src/api/web/app.ts');
    expect(src).toMatch(/app\.addHook\('preHandler', \(req, _reply, done\) => \{/);
    // A5 — the scope carries HOW MANY as well as who, because the nav entry
    // reads as her name at one assistant and "Team" at several.
    // D — the same look-up now carries the outreach flag and setup progress too.
    expect(src).toMatch(/withWorkspace\(f, done\)/);
  });
});

describe('A5.2 · outside the owner\'s pages', () => {
  it('an alert to her phone names the assistant it is about', () => {
    expect(renderOwnerAlert('en', 'handoff', 'Noor')).toContain('Noor');
    expect(renderOwnerAlert('en', 'handoff', 'Noor')).not.toContain('Lily');
    // No confirmed name: the alert says "your assistant", never a default name.
    expect(renderOwnerAlert('en', 'handoff')).toContain('Your assistant');
    expect(renderOwnerAlert('en', 'handoff')).not.toContain('Lily');
    expect(renderOwnerAlert('zh', 'handoff', null)).toContain(ASSISTANT_FALLBACK.zh);
  });

  it('the buyer\'s proof page is told the name rather than assuming it', () => {
    const src = read('src/api/web/proof.ts');
    expect(src).toMatch(/const name = v\.assistantName \?\? assistantName\(l\);/);
    expect(src).toMatch(/assistantNameOfConversation\(tx, bid\.value, r\.conversation_id\)/);
  });
});
