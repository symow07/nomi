import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t, assistantName, withAssistantName, makeNameCache } from '../../src/api/web/say.js';
import { EMPLOYEE_NAME } from '../../src/core/owner/i18n/messages.js';
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
  it('outside any request it is the constant it always was, in every language', () => {
    for (const l of LOCALES) {
      expect(assistantName(l)).toBe(EMPLOYEE_NAME[l]);
      expect(t(l, 'nav.employee')).toBe(EMPLOYEE_NAME[l]);
    }
  });

  it('inside a request it is the business\'s own, in whatever language the page is', () => {
    withAssistantName('Sara', () => {
      for (const l of LOCALES) {
        expect(assistantName(l)).toBe('Sara');
        expect(t(l, 'samples.flash.saved')).toContain('Sara');
        expect(t(l, 'samples.flash.saved')).not.toContain(EMPLOYEE_NAME[l]);
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
    expect(assistantName('en')).toBe('Lily');
  });

  it('no name yet leaves everything as it was; a name passed by hand still wins', () => {
    expect(withAssistantName(null, () => assistantName('en'))).toBe('Lily');
    expect(withAssistantName('', () => assistantName('en'))).toBe('Lily');
    withAssistantName('Sara', () => expect(t('en', 'people.issued.title', { name: 'Xiao Chen' })).toContain('Xiao Chen'));
  });
});

describe('A5.2 · remembered for a minute, forgotten on a rename', () => {
  it('holds a name, holds "no row yet" too, expires, and can be told to forget', () => {
    const c = makeNameCache(1000);
    expect(c.get('b1', 0)).toBeUndefined();
    c.set('b1', 'Sara', 0); c.set('b2', null, 0);
    expect(c.get('b1', 999)).toBe('Sara');
    expect(c.get('b2', 999)).toBeNull();
    expect(c.get('b1', 1000)).toBeUndefined();
    c.set('b1', 'Sara', 2000); c.evict('b1');
    expect(c.get('b1', 2001)).toBeUndefined();
  });

  it('every assistants write that can change the main name forgets it', () => {
    const src = read('src/api/web/app.ts');
    expect(src.match(/names\.evict\(s\.businessId\)/g)?.length).toBe(2);
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

  it('only the module that NAMES a new main assistant still reads the constant', () => {
    const readers = files.filter((f) => readFileSync(WEB + f, 'utf8').includes('EMPLOYEE_NAME'));
    expect(readers).toEqual(['assistants.ts']);
  });

  it('no save message is handed the installation\'s one configured name', () => {
    expect(read('src/api/web/app.ts')).not.toMatch(/name: deps\.employeeName/);
  });

  it('the scope is opened on preHandler — after the body is read — and by callback', () => {
    const src = read('src/api/web/app.ts');
    expect(src).toMatch(/app\.addHook\('preHandler', \(req, _reply, done\) => \{/);
    expect(src).toMatch(/withAssistantName\(name, done\)/);
  });
});

describe('A5.2 · outside the owner\'s pages', () => {
  it('an alert to her phone names the assistant it is about', () => {
    expect(renderOwnerAlert('en', 'handoff', 'Noor')).toContain('Noor');
    expect(renderOwnerAlert('en', 'handoff', 'Noor')).not.toContain('Lily');
    expect(renderOwnerAlert('en', 'handoff')).toContain('Lily');
    expect(renderOwnerAlert('zh', 'handoff', null)).toContain('小雅');
  });

  it('the buyer\'s proof page is told the name rather than assuming it', () => {
    const src = read('src/api/web/proof.ts');
    expect(src).toMatch(/const name = v\.assistantName \?\? assistantName\(l\);/);
    expect(src).toMatch(/assistantNameOfConversation\(tx, bid\.value, r\.conversation_id\)/);
  });
});
