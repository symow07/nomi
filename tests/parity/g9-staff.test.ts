import { describe, it, expect } from 'vitest';
import { mintIssuedCode, readIssuedCode, ISSUED_TTL_MS } from '../../src/api/web/people.js';
import { makeSessionCodec } from '../../src/api/web/session.js';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { OWNER_VIEW, actorName, type Person } from '../../src/core/conversation/people.js';

/**
 * G9a — staff access is safe.
 *
 * The walk signed in as staff is tests/integration/people.test.ts; this is the
 * token that replaced a code in a URL, and the renderers' side of hiding a
 * control that could only refuse.
 */

const SECRET = 'a-test-session-secret-of-sufficient-length';
const NOW = Date.parse('2026-09-11T08:00:00Z');
const issued = { name: 'Xiao Chen', code: 'ABCDE-FGH23' };

describe('G9a · the issued code rides a signed token, not a URL', () => {
  it('reads back what was minted, until it expires', () => {
    const token = mintIssuedCode(SECRET, issued, NOW);
    expect(readIssuedCode(SECRET, token, NOW)).toEqual(issued);
    expect(readIssuedCode(SECRET, token, NOW + ISSUED_TTL_MS - 1)).toEqual(issued);
    expect(readIssuedCode(SECRET, token, NOW + ISSUED_TTL_MS + 1)).toBeNull();
    expect(ISSUED_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('a forged, truncated or foreign token is nothing', () => {
    const token = mintIssuedCode(SECRET, issued, NOW);
    const [payload] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify(['Mallory', 'ZZZZZ-ZZZZZ', NOW + 60_000])).toString('base64url')}.${token.split('.')[1]}`;
    for (const bad of [undefined, '', 'x', payload!, forged, mintIssuedCode('another-secret-entirely-000000', issued, NOW)]) {
      expect(readIssuedCode(SECRET, bad, NOW), String(bad)).toBeNull();
    }
  });

  it('PURPOSE-BOUND: a session is not a code token, and a code token is not a session', () => {
    // The session codec signs ANY payload and reads a person-less session as
    // the OWNER. Were the code signed by it, the cookie that shows her a new
    // colleague's code would verify as her own session.
    const codec = makeSessionCodec(SECRET);
    const session = codec.sign({ businessId: 'b1', exp: NOW + 60_000 });
    expect(readIssuedCode(SECRET, session, NOW)).toBeNull();
    expect(codec.verify(mintIssuedCode(SECRET, issued, NOW), NOW)).toBeNull();
  });
});

describe('G9a · a staff member is not shown the controls that only refuse', () => {
  const profile: EmployeeProfile = {
    hireDate: null, knows: 0, stage: 'probation', canDo: ['qualify'], needConfirm: ['quote'],
    capabilities: [
      { capability: 'quote', mode: 'draft', promotable: true },
      { capability: 'qualify', mode: 'auto', promotable: true },
    ],
    growth: [], promoted: false, conditions: [], spotChecks: [],
  };

  it('Your employee: the owner gets the grant and revoke buttons; staff get the reason', () => {
    const owner = renderEmployee(profile, 'en', null, undefined, OWNER_VIEW);
    expect(owner).toContain('/app/employee/capability/quote/promote');
    expect(owner).toContain('/app/employee/capability/qualify/revoke');
    const staff = renderEmployee(profile, 'en', null, undefined, { isOwner: false });
    expect(staff).not.toContain('/app/employee/capability/');
    expect(staff).toContain(t('en', 'staff.ownerDecides'));
  });
});

describe('G9b · who did it, in words', () => {
  const owner: Person = { id: 'p-owner', name: 'Mrs Wang', isOwner: true };
  const staff: Person = { id: 'p-chen', name: 'Xiao Chen', isOwner: false };
  const people = [owner, staff];
  const words = { you: 'you', owner: 'the owner', gone: 'someone who has left' };
  const asOwner = { id: owner.id, isOwner: true };
  const asStaff = { id: staff.id, isOwner: false };

  it('the reader is "you"; a colleague is named', () => {
    expect(actorName(staff.id, people, asOwner, words)).toBe('Xiao Chen');
    expect(actorName(staff.id, people, asStaff, words)).toBe('you');
    expect(actorName(owner.id, people, asOwner, words)).toBe('you');
    expect(actorName(owner.id, people, asStaff, words)).toBe('Mrs Wang');
  });

  it('the old sentinel meant her, so it is "you" to her and "the owner" to staff', () => {
    expect(actorName('owner', people, asOwner, words)).toBe('you');
    expect(actorName('owner', people, asStaff, words)).toBe('the owner');
    expect(actorName(null, people, OWNER_VIEW, words)).toBe('you');
  });

  it('an id that no longer resolves is someone who has left — never the raw id', () => {
    expect(actorName('0f8e-gone', people, asOwner, words)).toBe('someone who has left');
  });
});

