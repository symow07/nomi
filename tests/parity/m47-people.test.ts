import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  OWNER_ONLY, mayDo, heldByName, validatePerson, type Person,
} from '../../src/core/conversation/people.js';
import {
  ownershipOf, aiMaySpeak, canTransition, WAITING_HUMAN_AGENT, OWNER_AGENT,
} from '../../src/core/conversation/ownership.js';
import { newAccessCode, hashCode, renderPeople } from '../../src/api/web/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M47 — more than one human.
 *
 * The access code was a single owner, and `assigned_to` could say "a human
 * holds this" but not WHICH human — so nobody could see who was on what, and a
 * takeover could not be routed. It is the first thing that breaks when the
 * pilot succeeds.
 *
 * The point of these tests is mostly what did NOT change: there is still one
 * ownership model and one predicate deciding whether she may speak. That
 * predicate was unified across three gates in M34.11, and a milestone that
 * added a second answer would undo the most valuable thing about it.
 */

const owner: Person = { id: 'p-owner', name: 'Mei', isOwner: true };
const staff: Person = { id: 'p-1', name: 'Xiao Chen', isOwner: false };

describe('M47 · the ownership model is EXTENDED, not replaced', () => {
  it('ownershipOf is unchanged — a person id reads as OWNER_CONTROLLED', () => {
    // The column documented this before the milestone existed: "ANY other
    // non-null agent (owner sentinel or a future human id)". This is that id.
    expect(ownershipOf(null)).toBe('AI');
    expect(ownershipOf(WAITING_HUMAN_AGENT)).toBe('WAITING_HUMAN');
    expect(ownershipOf(OWNER_AGENT)).toBe('OWNER_CONTROLLED');
    expect(ownershipOf('p-1')).toBe('OWNER_CONTROLLED');
    expect(ownershipOf('9f1c0f52-0000-4000-8000-000000000001')).toBe('OWNER_CONTROLLED');
  });

  it('and so is the ONE predicate for "may she speak"', () => {
    expect(aiMaySpeak(ownershipOf(null))).toBe(true);
    for (const held of [OWNER_AGENT, WAITING_HUMAN_AGENT, 'p-1']) {
      expect(aiMaySpeak(ownershipOf(held)), held).toBe(false);
    }
  });

  it('the transitions are the same five', () => {
    expect(canTransition('AI', 'OWNER_CONTROLLED')).toBe(true);
    expect(canTransition('WAITING_HUMAN', 'OWNER_CONTROLLED')).toBe(true);
    expect(canTransition('OWNER_CONTROLLED', 'WAITING_HUMAN')).toBe(false);
  });

  it('NO SECOND ANSWER to "may she speak" was introduced', async () => {
    // Three gates were unified onto `aiMaySpeak` in M34.11. A milestone that
    // added a fourth copy would undo the most valuable thing about that work.
    const { execSync } = await import('node:child_process');
    const hits = execSync('grep -rn "assignedTo !== null\\|assigned_to !== null" src || true', {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
      // The module that OWNS the meaning is allowed to state it.
    }).split('\n').filter((l) => l.trim() !== '' && !l.startsWith('src/core/conversation/ownership.ts'));
    expect(hits, `a second ownership predicate appeared:\n${hits.join('\n')}`).toEqual([]);
  });
});

describe('M47 · one distinction, and it is named in code', () => {
  it('a handful of things belong to the owner, listed rather than matrixed', () => {
    // M42 added the fifth. The list is still a LIST — the point of M47 was that
    // one distinction (owner, or not) beats a permissions matrix, and adding an
    // entry is not the same as adding a role.
    expect([...OWNER_ONLY]).toEqual([
      'capability_grant', 'messaging_activation', 'price_rules', 'people',
      'outreach',
    ]);
  });

  it('the owner may do them and a sales assistant may not', () => {
    for (const action of OWNER_ONLY) {
      expect(mayDo(owner, action), action).toBe(true);
      expect(mayDo(staff, action), action).toBe(false);
    }
  });

  // G9a — "every owner-only route calls the gate" and "a sales assistant can
  // do the job" used to be source tests reading a fixed number of characters
  // after each route name: a comment mentioning `ownerOnly(` passed them, and
  // a longer handler failed them. Both are now a walk signed in as staff, over
  // every route and the two owner-only pages (tests/integration/people.test.ts).

  it('and NO OTHER route does — this is a list, not a creeping matrix', async () => {
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const gated = [...app.matchAll(/ownerOnly\(req, reply, '([a-z_]+)'/g)].map((m) => m[1]!);
    expect(new Set(gated)).toEqual(new Set(OWNER_ONLY));
  });

});

describe('M47 · who holds this conversation', () => {
  const people = [owner, staff];
  const words = { ai: 'Lily', waiting: 'Waiting for a person', owner: 'The owner', gone: 'Someone who has left' };

  it('names the person', () => {
    expect(heldByName('p-1', people, words)).toBe('Xiao Chen');
  });

  it('reads rows written BEFORE this milestone', () => {
    // 'owner' and 'unclaimed' still mean what they meant when they were
    // written, which is what keeps every historical row readable.
    expect(heldByName('owner', people, words)).toBe('The owner');
    expect(heldByName('unclaimed', people, words)).toBe('Waiting for a person');
    expect(heldByName(null, people, words)).toBe('Lily');
  });

  it('someone she removed reads as GONE, never as nobody and never as a uuid', () => {
    expect(heldByName('p-deleted', people, words)).toBe('Someone who has left');
  });
});

describe('M47 · the codes', () => {
  it('are readable aloud across a factory floor — no O/0, no I/l/1', () => {
    for (let i = 0; i < 50; i++) {
      const code = newAccessCode();
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(code).not.toMatch(/[OI01L]/);
    }
  });

  it('are not stored — the row holds an HMAC, keyed by the installation', () => {
    const a = hashCode('secret-one', 'ABCDE-FGHJK');
    const b = hashCode('secret-two', 'ABCDE-FGHJK');
    expect(a).not.toBe('ABCDE-FGHJK');
    expect(a).not.toBe(b);
    // Case and surrounding space do not make a different person.
    expect(hashCode('secret-one', ' abcde-fghjk ')).toBe(a);
  });

  it('the module says a code is shown ONCE', async () => {
    const src = await readFile(new URL('../../src/api/web/people.ts', import.meta.url), 'utf8');
    expect(src).toContain('A CODE IS SHOWN ONCE');
    // No column, no query, no render path gives one back.
    expect(src).not.toMatch(/select[^;]*\bcode\b(?!_hash)/i);
  });

  it('and the OWNER\'s way in is never a row', async () => {
    const src = await readFile(new URL('../../src/api/web/people.ts', import.meta.url), 'utf8');
    expect(src).toContain("The OWNER's own way in is unchanged");
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    // Her code is compared against the environment, first, before any query.
    expect(app).toMatch(/if \(codeMatches\(code, deps\.accessCode\)\) \{/);
    expect(app).toContain('HER LOGIN NEVER DEPENDS ON A QUERY');
    expect(app).toContain('ownerPerson(deps.db, deps.businessId).catch(() => null)');
  });

  it('a staff code fails CLOSED when it cannot be verified', async () => {
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('A STAFF CODE FAILS CLOSED');
    expect(app).toMatch(/personForCode\([^)]*\)\s*\n?\s*\.catch\(\(\) => null\)/);
  });
});

describe('M47 · the page', () => {
  const view = { people: [{ ...owner, addedAt: new Date('2026-01-01T00:00:00Z') },
    { ...staff, addedAt: new Date('2026-08-01T00:00:00Z') }], justIssued: null };

  it('lists everyone, marks the owner, and offers to remove only the others', () => {
    const html = renderPeople(view, 'en', null);
    expect(html).toContain('Mei');
    expect(html).toContain('Xiao Chen');
    expect(html).toContain('/app/settings/people/p-1/remove');
    expect(html).not.toContain('/app/settings/people/p-owner/remove');
  });

  it('shows a new code once, and says that is the only time', () => {
    const html = renderPeople({ ...view, justIssued: { name: 'Xiao Chen', code: 'ABCDE-FGHJK' } }, 'en', null);
    expect(html).toContain('ABCDE-FGHJK');
    expect(html).toContain(t('en', 'people.issued.once'));
  });

  it('states the four owner-only things ON THE PAGE, in every locale', () => {
    // Said in the product, not only in a commit message.
    for (const locale of LOCALES) {
      const html = renderPeople(view, locale, null);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      for (const a of OWNER_ONLY) {
        expect(visible, `${locale} ${a}`).toContain(t(locale, `people.ownerOnly.${a}` as MessageKey));
      }
      expect(visible, locale).toContain(t(locale, 'people.ownerOnly.rest'));
    }
  });

  it('a name is all that is asked for — no role, no email, no phone', () => {
    const html = renderPeople(view, 'en', null);
    const form = html.slice(html.indexOf('action="/app/settings/people"'));
    expect(form).toContain('name="name"');
    expect(form.slice(0, 400)).not.toMatch(/name="(role|email|phone|permission)"/);
  });

  it('what she typed wrong is refused', () => {
    expect(validatePerson('')).toEqual({ ok: false, error: 'name_missing' });
    expect(validatePerson('   ')).toEqual({ ok: false, error: 'name_missing' });
    expect(validatePerson('x'.repeat(61))).toEqual({ ok: false, error: 'name_too_long' });
    expect(validatePerson('  Xiao Chen ')).toEqual({ ok: true, value: 'Xiao Chen' });
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'people.title', 'people.intro', 'people.owner', 'people.remove', 'people.add.label',
      'people.add.placeholder', 'people.add.button', 'people.issued.title', 'people.issued.once',
      'people.ownerOnly.title', 'people.ownerOnly.intro', 'people.ownerOnly.rest',
      'people.flash.added', 'people.flash.removed', 'people.flash.name_missing',
      'people.flash.name_too_long', 'people.flash.failed', 'staff.notAllowed',
      'people.held.waiting', 'people.held.owner', 'people.held.gone', 'people.holding',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { name: 'Xiao Chen', who: 'Xiao Chen' });
        // 你 is a whole word: a one-character string is not an empty one.
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(0);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});
