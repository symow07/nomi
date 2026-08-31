import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  DNS_RECORDS, DOMAIN_CHECK_TTL_MS, checkDkim, checkDmarc, checkDomain, checkSpf,
  mayUseDomain, recordHost, type DomainCheck,
} from '../../src/core/outreach/domain.js';
import { CHANNEL_REGISTRY, mayInitiate } from '../../src/core/channel/registry.js';
import { renderDomain, satisfiedRequirements } from '../../src/api/web/channels.js';
import type { SendingDomain } from '../../src/db/sendingDomain.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M40.1 — the domain her mail leaves as.
 *
 * A misconfigured sending domain does not fail loudly. The first few hundred
 * messages land in spam, the reputation of the address she has used with buyers
 * for years drops, and nobody notices until her ordinary mail is being filed as
 * junk. That is why this refuses rather than warns.
 */

const NOW = new Date('2026-08-31T02:00:00Z');
const SPF_OK = 'v=spf1 include:mail.example.net ~all';
const DKIM_OK = 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ==';
const DMARC_OK = 'v=DMARC1; p=quarantine; rua=mailto:d@example.com';
const INCLUDE = 'mail.example.net';

const check = (over: Partial<DomainCheck> = {}): DomainCheck =>
  ({ spf: 'ok', dkim: 'ok', dmarc: 'ok', ...over });

describe('M40.1 · what the records must actually say', () => {
  it('SPF that does not list our sender is UNAUTHORIZED, not merely malformed', () => {
    // The fix is different — one is a typo, the other is a missing line — and a
    // well-formed record that omits us is worse than none: it publishes a list
    // our mail is not on.
    expect(checkSpf([SPF_OK], INCLUDE)).toBe('ok');
    expect(checkSpf(['v=spf1 include:someone-else.net ~all'], INCLUDE)).toBe('unauthorized');
    expect(checkSpf([], INCLUDE)).toBe('missing');
    expect(checkSpf(['v=spf1 include:mail.example.net'], INCLUDE)).toBe('malformed');
  });

  it('WITHOUT A PROVIDER TO REQUIRE, SPF CANNOT BE CONFIRMED — and says so', () => {
    // Absence of a confirmation is not a confirmation. Until a sending provider
    // is configured there is no `include:` to look for, so the shape alone
    // proves nothing and the check refuses.
    expect(checkSpf([SPF_OK], null)).not.toBe('ok');
  });

  it('a DKIM key that was revoked parses, and means the opposite of ready', () => {
    expect(checkDkim([DKIM_OK])).toBe('ok');
    expect(checkDkim(['v=DKIM1; k=rsa; p='])).toBe('malformed');
    expect(checkDkim([])).toBe('missing');
  });

  it('a long DKIM key split across TXT chunks is read as one record', () => {
    // The resolver joins chunks; a check that did not would call a valid key
    // malformed on exactly the domains that configured it properly.
    const long = `v=DKIM1; k=rsa; p=${'A'.repeat(400)}`;
    expect(checkDkim([long])).toBe('ok');
  });

  it('any published DMARC policy counts — including p=none', () => {
    // Requiring quarantine or reject would be this product inventing a stricter
    // rule than receivers apply, and refusing domains that deliver perfectly.
    for (const p of ['none', 'quarantine', 'reject']) {
      expect(checkDmarc([`v=DMARC1; p=${p}`]), p).toBe('ok');
    }
    expect(checkDmarc(['v=DMARC1; rua=mailto:x@y.z'])).toBe('malformed');
    expect(checkDmarc([])).toBe('missing');
  });

  it('and each record is looked for at the host she is told to create', () => {
    expect(recordHost('spf', 'yiwuhf.com', 'nomi')).toBe('yiwuhf.com');
    expect(recordHost('dkim', 'yiwuhf.com', 'k1')).toBe('k1._domainkey.yiwuhf.com');
    expect(recordHost('dmarc', 'yiwuhf.com', 'nomi')).toBe('_dmarc.yiwuhf.com');
  });
});

describe('M40.1 · it fails closed in three directions', () => {
  it('never checked is not verified', () => {
    const r = mayUseDomain({ check: null, checkedAt: null }, NOW);
    expect(r.ok === false && r.error.kind).toBe('never_checked');
  });

  it('CHECKED TOO LONG AGO IS NOT VERIFIED EITHER', () => {
    // A check that never goes stale is a claim about the past wearing the
    // clothes of the present. Records get removed.
    const old = new Date(NOW.getTime() - DOMAIN_CHECK_TTL_MS - 1);
    const r = mayUseDomain({ check: check(), checkedAt: old }, NOW);
    expect(r.ok === false && r.error.kind).toBe('stale');
    const fresh = new Date(NOW.getTime() - DOMAIN_CHECK_TTL_MS + 1000);
    expect(mayUseDomain({ check: check(), checkedAt: fresh }, NOW).ok).toBe(true);
  });

  it('and any record short of ok refuses, naming which', () => {
    for (const kind of DNS_RECORDS) {
      const r = mayUseDomain({ check: check({ [kind]: 'missing' }), checkedAt: NOW }, NOW);
      expect(r.ok, kind).toBe(false);
      expect(r.ok === false && r.error.kind === 'incomplete' && [...r.error.missing]).toEqual([kind]);
    }
  });

  it('a lookup that failed is empty, and empty reads as missing', async () => {
    // Every failure mode of DNS means the same thing: we did not see it.
    expect(checkDomain({ spf: [], dkim: [], dmarc: [] }, INCLUDE))
      .toEqual({ spf: 'missing', dkim: 'missing', dmarc: 'missing' });
    const src = await readFile(new URL('../../src/outbound/dns.ts', import.meta.url), 'utf8');
    expect(src).toContain('return [];');
  });
});

describe('M40.1 · it is a requirement of the channel, not a fourth gate', () => {
  it('e-mail cannot carry a first message until the domain is verified', () => {
    // The same shape as WhatsApp's approved template: named by M39, answered
    // here, and rendered in the same list. A separate gate would be a second
    // place deciding whether e-mail may initiate.
    expect([...CHANNEL_REGISTRY.email.requires]).toEqual(['verified_sending_domain']);
    expect(mayInitiate('email', new Set()).ok).toBe(false);
    expect(mayInitiate('email', satisfiedRequirements('none', verified())).ok).toBe(true);
  });

  it('THE PAGE USES THE SAME PREDICATE, TTL AND ALL', () => {
    // A page reading the stored states directly would call a six-week-old pass
    // a pass, and the send path would refuse the message she was told to expect.
    const old = new Date(NOW.getTime() - DOMAIN_CHECK_TTL_MS - 1);
    expect(satisfiedRequirements('none', { ...verified(), checkedAt: old }, NOW)
      .has('verified_sending_domain')).toBe(false);
    expect(satisfiedRequirements('none', verified(), NOW)
      .has('verified_sending_domain')).toBe(true);
  });
});

const verified = (): SendingDomain => ({
  domain: 'yiwuhf.com', dkimSelector: 'nomi', check: check(),
  checkedAt: NOW, addedAt: NOW,
});

describe('M40.1 · what she reads', () => {
  it('with no domain, it says so and asks for one', () => {
    const html = renderDomain('en', null, NOW);
    expect(html).toContain(t('en', 'domain.none'));
    expect(html).toContain('/app/channels/domain');
  });

  it('it names the exact host to create, per record', () => {
    const html = renderDomain('en', { ...verified(), check: null, checkedAt: null }, NOW);
    expect(html).toContain('_dmarc.yiwuhf.com');
    expect(html).toContain('nomi._domainkey.yiwuhf.com');
    expect(html).toContain(t('en', 'domain.neverChecked'));
  });

  it('a record that is there but does not list us says exactly that', () => {
    const html = renderDomain('en', { ...verified(), check: check({ spf: 'unauthorized' }) }, NOW);
    expect(html).toContain(t('en', 'domain.state.unauthorized'));
    expect(html).toContain(t('en', 'domain.incomplete'));
  });

  it('and a stale pass is shown as stale, not as ready', () => {
    const old = new Date(NOW.getTime() - DOMAIN_CHECK_TTL_MS - 1);
    const html = renderDomain('en', { ...verified(), checkedAt: old }, NOW);
    expect(html).not.toContain(t('en', 'domain.ready'));
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'domain.none', 'domain.intro', 'domain.ready', 'domain.neverChecked',
      'domain.stale', 'domain.incomplete', 'domain.check', 'domain.save',
      'domain.field.domain', 'domain.field.selector', 'domain.flash.saved',
      'domain.flash.checked', 'domain.flash.invalid', 'domain.flash.failed',
      'reach.req.verified_sending_domain',
      ...DNS_RECORDS.map((k) => `domain.record.${k}` as MessageKey),
      ...(['missing', 'malformed', 'unauthorized', 'ok'] as const)
        .map((k) => `domain.state.${k}` as MessageKey),
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { date: 'yesterday' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });

  it('WHAT THIS PRODUCT CANNOT DO IS SAID BEFORE THE WORK IT ASKS FOR', async () => {
    // The card put "not set up here yet — she cannot send on this one" AFTER
    // the whole DNS form, so a page of work read as available and the line
    // saying it was not landed under the Save button.
    const { renderReach } = await import('../../src/api/web/channels.js');
    const html = renderReach('en', new Set(), new Map(), verified());
    const card = html.slice(html.indexOf(t('en', 'reach.channel.email')));
    const email = card.slice(0, card.indexOf('class="card reach"'));
    expect(email.indexOf(t('en', 'reach.notHere')))
      .toBeLessThan(email.indexOf(t('en', 'domain.intro')));
  });

  it('it is registered, owner-only, and reachable from the e-mail card', async () => {
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    for (const r of ["app.post('/app/channels/domain'", "app.post('/app/channels/domain/check'"]) {
      const at = app.indexOf(r);
      expect(at, r).toBeGreaterThan(-1);
      expect(app.slice(at, at + 400), `${r} is not owner-gated`).toContain("ownerOnly(req, reply, 'outreach'");
    }
    const ch = await readFile(new URL('../../src/api/web/channels.ts', import.meta.url), 'utf8');
    expect(ch).toContain("channel === 'email' ? renderDomain(locale, domain) : ''");
  });
});
